import { randomUUID } from "node:crypto";

import { ActClient } from "@/features/act-sync/act-client";
import { ActApiError } from "@/features/act-sync/act-errors";
import type {
  ActContactInput,
  RemoteActContact,
} from "@/features/act-sync/act-types";
import { contactSnapshotsEqual } from "@/features/act-sync/contact-snapshot";
import {
  DrizzleSyncRepository,
  LocalContactChangedAfterPreviewError,
  type ApplyOperationResult,
  type SyncApplyRepository,
  type SyncRepository,
  type SyncSummary,
} from "@/features/act-sync/sync-repository";
import {
  compareContactSets,
  syncComparisonCategories,
  type SyncDecision,
  type SyncComparisonRow,
} from "@/features/act-sync/sync-comparison";
import { getActEnvironment } from "@/lib/env";

export interface ActSyncClient {
  listContacts(): Promise<RemoteActContact[]>;
}

export interface ActSyncApplyClient extends ActSyncClient {
  getContact(contactId: string): Promise<RemoteActContact>;
  createContact(input: ActContactInput): Promise<RemoteActContact>;
  updateContact(
    contactId: string,
    input: ActContactInput,
  ): Promise<RemoteActContact>;
}

export type SyncApplyDecision = {
  rowId: string;
  decision: SyncDecision;
  localContactId?: string;
};

export type SyncApplyRowResult = {
  rowId: string;
  status: ApplyOperationResult["status"];
  error: string | null;
  retryable?: boolean;
};

export class ActSyncInterruptedError extends Error {
  readonly code: ActApiError["code"] | undefined;

  constructor(
    message: string,
    readonly row: SyncApplyRowResult,
    cause?: ActApiError,
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "ActSyncInterruptedError";
    this.code = cause?.code;
  }
}

export class ActSyncQueueChangedError extends Error {
  constructor() {
    super(
      "The saved sync queue changed in another page. Review the current selections and try again.",
    );
    this.name = "ActSyncQueueChangedError";
  }
}

class AmbiguousActCreateError extends Error {
  constructor(readonly originalError: unknown) {
    super(
      "A previous Act! create may have completed. Create a new preview before trying again.",
    );
    this.name = "AmbiguousActCreateError";
  }
}

function summarize(rows: readonly SyncComparisonRow[]): SyncSummary {
  const summary = Object.fromEntries(
    syncComparisonCategories.map((category) => [category, 0]),
  ) as SyncSummary;
  for (const row of rows) summary[row.category] += 1;
  return summary;
}

export class ActSyncService {
  constructor(
    private readonly client: ActSyncClient,
    private readonly repository: SyncRepository,
  ) {}

  async createPreview() {
    const [localContacts, remoteContacts] = await Promise.all([
      this.repository.listLocalContacts(),
      this.client.listContacts(),
    ]);
    const rows = compareContactSets(localContacts, remoteContacts);
    return this.repository.createPreview(rows, summarize(rows));
  }

  getPreview(runId: string) {
    return this.repository.getPreview(runId);
  }

  getLatestPreview() {
    return this.repository.getLatestPreview();
  }

  async stage(
    runId: string,
    decisions: readonly SyncApplyDecision[],
    replaceExisting = false,
    queueToken?: string,
  ): Promise<{ runId: string; queueToken: string }> {
    const preview = await this.repository.getPreview(runId);
    if (!preview) throw new Error("Act! sync preview was not found.");
    const rowsById = new Map(preview.rows.map((row) => [row.rowId, row]));
    const normalizedDecisions: SyncApplyDecision[] = [];
    for (const input of decisions) {
      const row = rowsById.get(input.rowId);
      if (!row || !row.allowedDecisions.includes(input.decision)) {
        throw new Error("Choose valid sync decisions.");
      }
      if (input.decision === "link") {
        const localContactId = input.localContactId ?? row.localContactId;
        if (
          !localContactId ||
          !row.candidateLocalContactIds.includes(localContactId)
        ) {
          throw new Error("Choose the local contact to link.");
        }
        normalizedDecisions.push({ ...input, localContactId });
      } else {
        normalizedDecisions.push({ ...input });
      }
    }
    const startsNewQueue = replaceExisting || !queueToken;
    const activeQueueToken = startsNewQueue ? randomUUID() : queueToken;
    await this.applyRepository().stageOperations(
      runId,
      normalizedDecisions,
      {
        replaceExisting: startsNewQueue,
        queueToken: activeQueueToken,
      },
    );
    return { runId, queueToken: activeQueueToken };
  }

  async clearStaged(
    runId: string,
    queueToken?: string,
  ): Promise<{ runId: string }> {
    const preview = await this.repository.getPreview(runId);
    if (!preview) throw new Error("Act! sync preview was not found.");
    await this.applyRepository().clearStagedOperations(runId, queueToken);
    return { runId };
  }

  async apply(
    runId: string,
    decisions: readonly SyncApplyDecision[],
    queueToken?: string,
  ): Promise<{ runId: string; rows: SyncApplyRowResult[] }> {
    const preview = await this.repository.getPreview(runId);
    if (!preview) throw new Error("Act! sync preview was not found.");
    const repository = this.applyRepository();
    const client = this.applyClient();
    const rowsById = new Map(preview.rows.map((row) => [row.rowId, row]));
    const results: SyncApplyRowResult[] = [];

    for (const input of decisions) {
      const row = rowsById.get(input.rowId);
      if (!row) {
        results.push({
          rowId: input.rowId,
          status: "failed",
          error: "This row is not part of the selected preview.",
          retryable: false,
        });
        continue;
      }
      if (!row.allowedDecisions.includes(input.decision)) {
        results.push({
          rowId: input.rowId,
          status: "failed",
          error: "Choose how to resolve this row before applying it.",
          retryable: false,
        });
        continue;
      }

      const claim = await repository.claimOperation(
        runId,
        row.rowId,
        input.decision,
        input.localContactId,
        queueToken,
      );
      if (claim === "superseded") {
        throw new ActSyncQueueChangedError();
      }
      if (claim === "missing") {
        results.push({
          rowId: row.rowId,
          status: "failed",
          error: "Stored sync operation is missing.",
          retryable: false,
        });
        continue;
      }
      if (claim === "in_progress") {
        results.push({
          rowId: row.rowId,
          status: "failed",
          error: "This row is already being applied.",
          retryable: true,
        });
        continue;
      }
      if (claim === "finished") {
        const operation = await repository.getOperation(runId, row.rowId);
        results.push({
          rowId: row.rowId,
          status:
            operation?.status === "skipped"
              ? "skipped"
              : operation?.status === "failed"
                ? "failed"
                : "completed",
          error: operation?.error ?? null,
          retryable: operation?.retryable ?? false,
        });
        continue;
      }

      let result: SyncApplyRowResult;
      try {
        result = await this.applyClaimedRow(
          repository,
          client,
          runId,
          row,
          input,
        );
      } catch (error) {
        if (error instanceof AmbiguousActCreateError) {
          const interruptedRow = {
            rowId: row.rowId,
            status: "failed" as const,
            error: error.message,
            retryable: false,
          };
          await repository.finishOperation(runId, row.rowId, {
            status: "failed",
            error: error.message,
            retryable: false,
          });
          await repository.finishRun(runId);
          const originalActError =
            error.originalError instanceof ActApiError
              ? error.originalError
              : undefined;
          throw new ActSyncInterruptedError(
            originalActError?.message ??
              "The approved Act! changes could not be applied.",
            interruptedRow,
            originalActError,
          );
        }
        if (error instanceof ActApiError) {
          const interruptedRow = {
            rowId: row.rowId,
            status: "failed" as const,
            error: error.message,
            retryable: error.retryable,
          };
          await repository.finishOperation(runId, row.rowId, {
            status: "failed",
            error: error.message,
            retryable: error.retryable,
          });
          await repository.finishRun(runId);
          throw new ActSyncInterruptedError(
            error.message,
            interruptedRow,
            error,
          );
        }
        result = {
          rowId: row.rowId,
          status: "failed",
          error:
            error instanceof LocalContactChangedAfterPreviewError
              ? error.message
              : "This row could not be synchronized. Try again.",
          retryable: !(error instanceof LocalContactChangedAfterPreviewError),
        };
      }
      await repository.finishOperation(runId, row.rowId, {
        status: result.status,
        error: result.error,
        retryable: result.retryable ?? true,
      });
      results.push(result);
    }

    await repository.finishRun(runId);
    return { runId, rows: results };
  }

  private async applyClaimedRow(
    repository: SyncApplyRepository,
    client: ActSyncApplyClient,
    runId: string,
    row: SyncComparisonRow,
    input: SyncApplyDecision,
  ): Promise<SyncApplyRowResult> {
    if (input.decision === "skip") {
      return { rowId: row.rowId, status: "skipped", error: null };
    }
    if (input.decision === "keep_separate") {
      return { rowId: row.rowId, status: "completed", error: null };
    }

    if (input.decision === "pull" || input.decision === "keep_act") {
      if (
        row.localContactId &&
        row.localSnapshot &&
        !(await repository.assertLocalContactUnchanged(row))
      ) {
        return {
          rowId: row.rowId,
          status: "failed",
          error:
            "Command Center changed after this preview. Create a new preview.",
          retryable: false,
        };
      }
      const remote =
        input.decision === "pull" && row.category === "new_in_act"
          ? this.reviewedNewActContact(row)
          : await this.currentRemote(client, row);
      if (!remote.ok) return remote.result;
      await repository.pullContact(row, remote.contact);
      return { rowId: row.rowId, status: "completed", error: null };
    }

    if (input.decision === "link") {
      const localContactId = input.localContactId ?? row.localContactId;
      if (
        !localContactId ||
        !row.candidateLocalContactIds.includes(localContactId)
      ) {
        return {
          rowId: row.rowId,
          status: "failed",
          error: "Choose the local contact to link.",
        };
      }
      const remote = await this.currentRemote(client, row);
      if (!remote.ok) return remote.result;
      await repository.linkContact(localContactId, remote.contact);
      return { rowId: row.rowId, status: "completed", error: null };
    }

    if (input.decision === "push" || input.decision === "keep_app") {
      if (!row.localSnapshot || !row.localContactId) {
        return {
          rowId: row.rowId,
          status: "failed",
          error: "The local contact snapshot is missing.",
          retryable: false,
        };
      }
      const push = await repository.withLockedLocalContact(row, async () => {
        if (row.actRecordId) {
          const current = await this.currentRemote(client, row);
          if (!current.ok) return current;
          return {
            ok: true as const,
            contact: await client.updateContact(
              row.actRecordId,
              row.localSnapshot!,
            ),
          };
        }
        const operation = await repository.getOperation(runId, row.rowId);
        if (operation?.actRecordId) {
          return {
            ok: true as const,
            contact: await client.getContact(operation.actRecordId),
          };
        } else {
          try {
            const remote = await client.createContact(row.localSnapshot!);
            await repository.rememberCreatedActId(
              runId,
              row.rowId,
              remote.id,
            );
            return { ok: true as const, contact: remote };
          } catch (error) {
            throw new AmbiguousActCreateError(error);
          }
        }
      });
      if (!push.ok) return push.result;
      await repository.completePush(row, push.contact);
      return { rowId: row.rowId, status: "completed", error: null };
    }

    return {
      rowId: row.rowId,
      status: "failed",
      error: "Choose how to resolve this row before applying it.",
    };
  }

  private reviewedNewActContact(
    row: SyncComparisonRow,
  ):
    | { ok: true; contact: RemoteActContact }
    | { ok: false; result: SyncApplyRowResult } {
    if (
      row.category !== "new_in_act" ||
      row.localContactId !== null ||
      !row.actRecordId ||
      !row.actSnapshot
    ) {
      return {
        ok: false,
        result: {
          rowId: row.rowId,
          status: "failed",
          error: "The reviewed Act! contact is incomplete. Create a new preview.",
          retryable: false,
        },
      };
    }
    return {
      ok: true,
      contact: {
        ...row.actSnapshot,
        id: row.actRecordId,
        editedAt: row.actEditedAt,
      },
    };
  }

  private async currentRemote(
    client: ActSyncApplyClient,
    row: SyncComparisonRow,
  ): Promise<
    | { ok: true; contact: RemoteActContact }
    | { ok: false; result: SyncApplyRowResult }
  > {
    if (!row.actRecordId) {
      return {
        ok: false,
        result: {
          rowId: row.rowId,
          status: "failed",
          error: "The Act! contact identifier is missing.",
          retryable: false,
        },
      };
    }
    const contact = await client.getContact(row.actRecordId);
    const editedChanged =
      row.actEditedAt !== null && contact.editedAt !== row.actEditedAt;
    const snapshotChanged =
      row.actSnapshot !== null &&
      !contactSnapshotsEqual(row.actSnapshot, contact);
    if (editedChanged || snapshotChanged) {
      return {
        ok: false,
        result: {
          rowId: row.rowId,
          status: "failed",
          error: "Act! changed after this preview. Create a new preview.",
          retryable: false,
        },
      };
    }
    return { ok: true, contact };
  }

  private applyClient() {
    const client = this.client as Partial<ActSyncApplyClient>;
    if (
      typeof client.getContact !== "function" ||
      typeof client.createContact !== "function" ||
      typeof client.updateContact !== "function"
    ) {
      throw new Error("Act! apply client is unavailable.");
    }
    return client as ActSyncApplyClient;
  }

  private applyRepository() {
    const repository = this.repository as Partial<SyncApplyRepository>;
    if (
      typeof repository.claimOperation !== "function" ||
      typeof repository.stageOperations !== "function" ||
      typeof repository.clearStagedOperations !== "function" ||
      typeof repository.assertLocalContactUnchanged !== "function" ||
      typeof repository.withLockedLocalContact !== "function" ||
      typeof repository.finishOperation !== "function" ||
      typeof repository.finishRun !== "function"
    ) {
      throw new Error("Act! apply repository is unavailable.");
    }
    return repository as SyncApplyRepository;
  }
}

export async function createDefaultActSyncService() {
  const environment = getActEnvironment();
  if (!environment.configured) {
    throw new ActApiError("not_configured", false);
  }
  const { db } = await import("@/db/client");
  return new ActSyncService(
    new ActClient(environment.config),
    new DrizzleSyncRepository(db),
  );
}
