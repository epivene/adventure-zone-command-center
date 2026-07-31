import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { db as database } from "@/db/client";
import {
  actContactSyncStates,
  actExternalLinks,
  actSyncOperations,
  actSyncRuns,
  auditEntries,
  contacts,
  organizations,
} from "@/db/schema";
import {
  canonicalContactSnapshot,
  contactSnapshotsEqual,
} from "@/features/act-sync/contact-snapshot";
import type { RemoteActContact } from "@/features/act-sync/act-types";
import { recordAuditEntry } from "@/features/audit/audit-service";
import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";
import { setContactPrimaryOrganization } from "@/features/relationships/relationship-writer";
import {
  syncComparisonCategories,
  type LocalSyncContact,
  type SyncComparisonCategory,
  type SyncComparisonRow,
  type SyncDecision,
} from "@/features/act-sync/sync-comparison";

type DrizzleDatabase = typeof database;
type OrganizationWriter = Pick<DrizzleDatabase, "select" | "insert">;
type SyncWriter = Pick<DrizzleDatabase, "select" | "insert" | "update">;

export type SyncSummary = Record<SyncComparisonCategory, number>;

export type SyncRunStatus =
  | "previewed"
  | "applying"
  | "partial"
  | "completed"
  | "failed";

export type StoredSyncOperation = {
  rowId: string;
  status: ApplyOperationStatus;
  decision: SyncDecision | null;
  localContactId: string | null;
  actRecordId: string | null;
  error: string | null;
  retryable: boolean;
  updatedAt: Date;
};

export type StoredSyncPreview = {
  id: string;
  status: SyncRunStatus;
  rows: SyncComparisonRow[];
  operations: StoredSyncOperation[];
  summary: SyncSummary;
  activeQueueToken: string | null;
  startedAt: Date;
  completedAt: Date | null;
};

export interface SyncRepository {
  listLocalContacts(): Promise<LocalSyncContact[]>;
  createPreview(
    rows: readonly SyncComparisonRow[],
    summary: SyncSummary,
  ): Promise<StoredSyncPreview>;
  getPreview(runId: string): Promise<StoredSyncPreview | null>;
  getLatestPreview(): Promise<StoredSyncPreview | null>;
}

export type ApplyOperationStatus =
  | "pending"
  | "approved"
  | "applying"
  | "completed"
  | "failed"
  | "skipped";

export type ApplyOperation = {
  runId: string;
  rowId: string;
  status: ApplyOperationStatus;
  decision: SyncDecision | null;
  localContactId: string | null;
  actRecordId: string | null;
  error: string | null;
  retryable: boolean;
  updatedAt: Date;
};

export type ApplyOperationResult = {
  status: Extract<ApplyOperationStatus, "completed" | "failed" | "skipped">;
  error: string | null;
  retryable?: boolean;
};

export type StagedSyncDecision = {
  rowId: string;
  decision: SyncDecision;
  localContactId?: string;
};

export type StageOperationsOptions = {
  replaceExisting: boolean;
  queueToken: string;
};

export class LocalContactChangedAfterPreviewError extends Error {
  constructor() {
    super("Command Center changed after this preview. Create a new preview.");
    this.name = "LocalContactChangedAfterPreviewError";
  }
}

export interface SyncApplyRepository extends SyncRepository {
  stageOperations(
    runId: string,
    decisions: readonly StagedSyncDecision[],
    options: StageOperationsOptions,
  ): Promise<void>;
  clearStagedOperations(runId: string, queueToken?: string): Promise<void>;
  claimOperation(
    runId: string,
    rowId: string,
    decision: SyncDecision,
    localContactId?: string,
    queueToken?: string,
  ): Promise<
    "claimed" | "finished" | "in_progress" | "missing" | "superseded"
  >;
  getOperation(runId: string, rowId: string): Promise<ApplyOperation | null>;
  rememberCreatedActId(
    runId: string,
    rowId: string,
    actRecordId: string,
  ): Promise<void>;
  assertLocalContactUnchanged(row: SyncComparisonRow): Promise<boolean>;
  assertActRecordWritable(row: SyncComparisonRow): Promise<boolean>;
  withLockedLocalContact<T>(
    row: SyncComparisonRow,
    action: () => Promise<T>,
  ): Promise<T>;
  pullContact(
    row: SyncComparisonRow,
    remote: RemoteActContact,
  ): Promise<string>;
  completePush(
    row: SyncComparisonRow,
    remote: RemoteActContact,
  ): Promise<void>;
  linkContact(
    localContactId: string,
    remote: RemoteActContact,
  ): Promise<void>;
  finishOperation(
    runId: string,
    rowId: string,
    result: ApplyOperationResult,
  ): Promise<void>;
  finishRun(runId: string): Promise<void>;
}

const contactSnapshotSchema = z
  .object({
    firstName: z.string(),
    lastName: z.string(),
    organizationName: z.string().nullable(),
    jobTitle: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    address1: z.string().nullable(),
    address2: z.string().nullable(),
    city: z.string().nullable(),
    region: z.string().nullable(),
    postalCode: z.string().nullable(),
  })
  .strict();

const nullableSnapshotSchema = contactSnapshotSchema.nullable();
const syncComparisonRowSchema = z
  .object({
    rowId: z.string().min(1),
    category: z.enum(syncComparisonCategories),
    matchReason: z.enum([
      "act_record_id",
      "email",
      "organization_contact",
      "none",
    ]),
    localContactId: z.string().nullable(),
    actRecordId: z.string().nullable(),
    candidateLocalContactIds: z.array(z.string()),
    candidateActRecordIds: z.array(z.string()),
    baseSnapshot: nullableSnapshotSchema,
    localSnapshot: nullableSnapshotSchema,
    actSnapshot: nullableSnapshotSchema,
    actEditedAt: z.string().nullable(),
    allowedDecisions: z.array(
      z.enum([
        "pull",
        "push",
        "keep_act",
        "keep_app",
        "link",
        "keep_separate",
        "skip",
      ]),
    ),
    messages: z.array(z.string()),
  })
  .strict();

const syncSummarySchema = z
  .object({
    new_in_act: z.number().int().nonnegative(),
    new_in_app: z.number().int().nonnegative(),
    changed_in_act: z.number().int().nonnegative(),
    changed_in_app: z.number().int().nonnegative(),
    changed_in_both: z.number().int().nonnegative(),
    possible_match: z.number().int().nonnegative(),
    already_matched: z.number().int().nonnegative(),
    missing_from_act: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
  })
  .strict();

const storedSummarySchema = z
  .object({
    counts: syncSummarySchema,
    rows: z.array(z.unknown()),
  })
  .strict();

const applyOperationStatuses = [
  "pending",
  "approved",
  "applying",
  "completed",
  "failed",
  "skipped",
] as const;

const syncRunStatuses = [
  "previewed",
  "applying",
  "partial",
  "completed",
  "failed",
] as const;

const syncDecisionSchema = z.enum([
  "pull",
  "push",
  "keep_act",
  "keep_app",
  "link",
  "keep_separate",
  "skip",
]);

function isSnapshot(value: unknown) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export const ACT_SYNC_OPERATION_LEASE_MS = 5 * 60 * 1_000;

export function parseStoredSyncRows(value: unknown): SyncComparisonRow[] {
  const parsed = z.array(syncComparisonRowSchema).safeParse(value);
  if (!parsed.success) {
    throw new Error("Stored Act! sync preview is malformed.");
  }
  return parsed.data;
}

export function deriveSyncRunStatus(
  operations: readonly Pick<ApplyOperation, "status">[],
): SyncRunStatus {
  if (operations.length === 0) return "previewed";
  if (operations.some(({ status }) => status === "applying")) {
    return "applying";
  }
  const pending = operations.some(
    ({ status }) => status === "pending" || status === "approved",
  );
  const settled = operations.some(
    ({ status }) => status !== "pending" && status !== "approved",
  );
  if (pending) return settled ? "partial" : "previewed";
  return operations.some(({ status }) => status === "failed")
    ? "failed"
    : "completed";
}

export function operationClaimDisposition(
  operation: Pick<
    ApplyOperation,
    "status" | "decision" | "actRecordId" | "retryable" | "updatedAt"
  >,
  now = new Date(),
): "finished" | "in_progress" | "reclaim" | "manual_review" {
  if (
    operation.status === "completed" ||
    operation.status === "skipped" ||
    (operation.status === "failed" && !operation.retryable)
  ) {
    return "finished";
  }
  if (operation.status !== "applying") return "reclaim";
  if (
    now.getTime() - operation.updatedAt.getTime() <
    ACT_SYNC_OPERATION_LEASE_MS
  ) {
    return "in_progress";
  }
  if (
    (operation.decision === "push" || operation.decision === "keep_app") &&
    operation.actRecordId === null
  ) {
    return "manual_review";
  }
  return "reclaim";
}

export function staleOperationRecovery(
  operation: Pick<
    ApplyOperation,
    "status" | "decision" | "actRecordId" | "retryable" | "updatedAt"
  >,
  now = new Date(),
): Pick<ApplyOperationResult, "status" | "error" | "retryable"> | null {
  const disposition = operationClaimDisposition(operation, now);
  if (disposition === "manual_review") {
    return {
      status: "failed",
      error:
        "A previous Act! create may have completed. Create a new preview before trying again.",
      retryable: false,
    };
  }
  if (
    operation.status === "applying" &&
    disposition === "reclaim"
  ) {
    return {
      status: "failed",
      error: "A previous sync attempt was interrupted. Retry this contact.",
      retryable: true,
    };
  }
  return null;
}

type StoredRunRecord = Pick<
  typeof actSyncRuns.$inferSelect,
  | "id"
  | "status"
  | "summary"
  | "activeQueueToken"
  | "startedAt"
  | "completedAt"
>;

type StoredOperationRecord = Pick<
  typeof actSyncOperations.$inferSelect,
  | "rowKey"
  | "status"
  | "decision"
  | "localContactId"
  | "actRecordId"
  | "error"
  | "retryable"
  | "updatedAt"
>;

export function buildStoredSyncPreview(
  run: StoredRunRecord,
  operationRecords: readonly StoredOperationRecord[],
): StoredSyncPreview {
  const summary = storedSummarySchema.safeParse(run.summary);
  if (!summary.success) {
    throw new Error("Stored Act! sync preview is malformed.");
  }
  const status = z.enum(syncRunStatuses).safeParse(run.status);
  const activeQueueToken =
    run.activeQueueToken === null
      ? { success: true as const, data: null }
      : z.uuid().safeParse(run.activeQueueToken);
  if (!status.success || !activeQueueToken.success) {
    throw new Error("Stored Act! sync run has an unsupported status.");
  }
  const rows = parseStoredSyncRows(summary.data.rows);
  const operations = new Map<string, StoredSyncOperation>();
  for (const record of operationRecords) {
    const operationStatus = z.enum(applyOperationStatuses).safeParse(
      record.status,
    );
    const decision =
      record.decision === null
        ? { success: true as const, data: null }
        : syncDecisionSchema.safeParse(record.decision);
    if (
      !operationStatus.success ||
      !decision.success ||
      typeof record.rowKey !== "string" ||
      record.rowKey.length === 0 ||
      (record.localContactId !== null &&
        typeof record.localContactId !== "string") ||
      (record.actRecordId !== null &&
        typeof record.actRecordId !== "string") ||
      (record.error !== null && typeof record.error !== "string") ||
      typeof record.retryable !== "boolean" ||
      !(record.updatedAt instanceof Date) ||
      Number.isNaN(record.updatedAt.getTime()) ||
      operations.has(record.rowKey)
    ) {
      throw new Error("Stored Act! sync operations are malformed.");
    }
    operations.set(record.rowKey, {
      rowId: record.rowKey,
      status: operationStatus.data,
      decision: decision.data,
      localContactId: record.localContactId,
      actRecordId: record.actRecordId,
      error: record.error,
      retryable: record.retryable,
      updatedAt: record.updatedAt,
    });
  }
  if (
    operations.size !== rows.length ||
    rows.some((row) => !operations.has(row.rowId))
  ) {
    throw new Error("Stored Act! sync operations are malformed.");
  }
  return {
    id: run.id,
    status: status.data,
    rows,
    operations: rows.map((row) => structuredClone(operations.get(row.rowId)!)),
    summary: summary.data.counts,
    activeQueueToken: activeQueueToken.data,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

export class DrizzleSyncRepository implements SyncApplyRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async listLocalContacts(): Promise<LocalSyncContact[]> {
    const records = await this.database
      .select({
        contact: contacts,
        organizationName: organizations.name,
        externalActRecordId: actExternalLinks.actRecordId,
        baseSnapshot: actContactSyncStates.baseSnapshot,
        actEditedAt: actContactSyncStates.actEditedAt,
      })
      .from(contacts)
      .leftJoin(
        organizations,
        eq(contacts.organizationId, organizations.id),
      )
      .leftJoin(
        actExternalLinks,
        and(
          eq(actExternalLinks.entityType, "contact"),
          eq(actExternalLinks.sourceEntityType, "contact"),
          eq(actExternalLinks.isPrimary, true),
          eq(actExternalLinks.syncMode, "two_way"),
          eq(actExternalLinks.entityId, contacts.id),
        ),
      )
      .leftJoin(
        actContactSyncStates,
        eq(contacts.id, actContactSyncStates.contactId),
      );

    const contactsById = new Map<string, LocalSyncContact>();
    for (const record of records) {
      const fields = {
        firstName: record.contact.firstName,
        lastName: record.contact.lastName,
        organizationName: record.organizationName,
        jobTitle: record.contact.jobTitle,
        email: record.contact.email,
        phone: record.contact.phone,
        address1: record.contact.address1,
        address2: record.contact.address2,
        city: record.contact.city,
        region: record.contact.region,
        postalCode: record.contact.postalCode,
      };
      const existing = contactsById.get(record.contact.id);
      contactsById.set(record.contact.id, {
        id: record.contact.id,
        actRecordId:
          existing?.actRecordId ??
          record.externalActRecordId ??
          record.contact.actRecordId,
        ...fields,
        baseSnapshot: isSnapshot(record.baseSnapshot)
          ? canonicalContactSnapshot(
              record.baseSnapshot as Parameters<
                typeof canonicalContactSnapshot
              >[0],
            )
          : null,
        actEditedAt:
          record.actEditedAt?.toISOString() ?? existing?.actEditedAt ?? null,
      });
    }
    return [...contactsById.values()];
  }

  async createPreview(
    rows: readonly SyncComparisonRow[],
    summary: SyncSummary,
  ): Promise<StoredSyncPreview> {
    return this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .insert(actSyncRuns)
        .values({
          status: "previewed",
          summary: { counts: summary, rows },
        })
        .returning();
      if (!run) throw new Error("Could not store Act! sync preview.");

      if (rows.length > 0) {
        await transaction.insert(actSyncOperations).values(
          rows.map((row) => ({
            runId: run.id,
            rowKey: row.rowId,
            localContactId: row.localContactId,
            actRecordId: row.actRecordId,
            category: row.category,
            status: "pending",
            baseSnapshot: row.baseSnapshot,
            localSnapshot: row.localSnapshot,
            actSnapshot: row.actSnapshot,
          })),
        );
      }

      return {
        id: run.id,
        status: "previewed",
        rows: structuredClone([...rows]),
        operations: rows.map((row) => ({
          rowId: row.rowId,
          status: "pending",
          decision: null,
          localContactId: row.localContactId,
          actRecordId: row.actRecordId,
          error: null,
          retryable: true,
          updatedAt: run.startedAt,
        })),
        summary: structuredClone(summary),
        activeQueueToken: null,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      };
    });
  }

  async getPreview(runId: string): Promise<StoredSyncPreview | null> {
    return this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select()
        .from(actSyncRuns)
        .where(eq(actSyncRuns.id, runId))
        .limit(1)
        .for("update");
      if (!run) return null;
      const operations = await transaction
        .select()
        .from(actSyncOperations)
        .where(eq(actSyncOperations.runId, runId))
        .for("update");
      const now = new Date();
      const reconciledOperations: (typeof actSyncOperations.$inferSelect)[] =
        [];
      for (const operation of operations) {
        const recovery = staleOperationRecovery(
          {
            status: operation.status as ApplyOperationStatus,
            decision: operation.decision as SyncDecision | null,
            actRecordId: operation.actRecordId,
            retryable: operation.retryable,
            updatedAt: operation.updatedAt,
          },
          now,
        );
        if (!recovery) {
          reconciledOperations.push(operation);
          continue;
        }
        const reconciled = {
          ...operation,
          ...recovery,
          updatedAt: now,
        };
        await transaction
          .update(actSyncOperations)
          .set({
            status: recovery.status,
            error: recovery.error,
            retryable: recovery.retryable,
            updatedAt: now,
          })
          .where(eq(actSyncOperations.id, operation.id));
        reconciledOperations.push(reconciled);
      }
      const status = deriveSyncRunStatus(
        reconciledOperations.map((operation) => ({
          status: operation.status as ApplyOperationStatus,
        })),
      );
      const finished = status === "completed" || status === "failed";
      const completedAt = finished ? (run.completedAt ?? now) : null;
      await transaction
        .update(actSyncRuns)
        .set({ status, completedAt })
        .where(eq(actSyncRuns.id, runId));
      return buildStoredSyncPreview(
        { ...run, status, completedAt },
        reconciledOperations,
      );
    });
  }

  async getLatestPreview(): Promise<StoredSyncPreview | null> {
    const [run] = await this.database
      .select({ id: actSyncRuns.id })
      .from(actSyncRuns)
      .orderBy(desc(actSyncRuns.startedAt))
      .limit(1);
    return run ? this.getPreview(run.id) : null;
  }

  async stageOperations(
    runId: string,
    decisions: readonly StagedSyncDecision[],
    options: StageOperationsOptions,
  ) {
    await this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select({
          id: actSyncRuns.id,
          activeQueueToken: actSyncRuns.activeQueueToken,
        })
        .from(actSyncRuns)
        .where(eq(actSyncRuns.id, runId))
        .limit(1)
        .for("update");
      if (!run) throw new Error("Act! sync preview was not found.");
      if (
        !options.replaceExisting &&
        run.activeQueueToken !== options.queueToken
      ) {
        throw new Error(
          "The saved sync queue changed in another page. Review the current selections and try again.",
        );
      }

      const operations = await transaction
        .select()
        .from(actSyncOperations)
        .where(eq(actSyncOperations.runId, runId))
        .for("update");
      const operationsByRowId = new Map(
        operations.map((operation) => [operation.rowKey, operation]),
      );
      const now = new Date();

      if (options.replaceExisting) {
        await transaction
          .update(actSyncOperations)
          .set({
            status: "pending",
            decision: null,
            error: null,
            retryable: true,
            updatedAt: now,
          })
          .where(
            and(
              eq(actSyncOperations.runId, runId),
              eq(actSyncOperations.status, "approved"),
            ),
          );
        await transaction
          .update(actSyncOperations)
          .set({
            decision: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(actSyncOperations.runId, runId),
              eq(actSyncOperations.status, "failed"),
              eq(actSyncOperations.retryable, true),
            ),
          );
        for (const operation of operations) {
          if (operation.status === "approved") {
            operation.status = "pending";
            operation.decision = null;
            operation.error = null;
            operation.retryable = true;
            operation.updatedAt = now;
          } else if (operation.status === "failed" && operation.retryable) {
            operation.decision = null;
            operation.updatedAt = now;
          }
        }
      }

      for (const decision of decisions) {
        const operation = operationsByRowId.get(decision.rowId);
        if (
          !operation ||
          operation.status === "applying" ||
          operation.status === "completed" ||
          operation.status === "skipped" ||
          (operation.status === "failed" && !operation.retryable)
        ) {
          throw new Error("A selected Act! sync row cannot be staged.");
        }
        await transaction
          .update(actSyncOperations)
          .set({
            decision: decision.decision,
            localContactId:
              decision.localContactId ?? operation.localContactId,
            status: "approved",
            error: null,
            retryable: true,
            updatedAt: now,
          })
          .where(eq(actSyncOperations.id, operation.id));
        operation.decision = decision.decision;
        operation.localContactId =
          decision.localContactId ?? operation.localContactId;
        operation.status = "approved";
        operation.error = null;
        operation.retryable = true;
        operation.updatedAt = now;
      }

      const status = deriveSyncRunStatus(
        operations.map((operation) => ({
          status: operation.status as ApplyOperationStatus,
        })),
      );
      await transaction
        .update(actSyncRuns)
        .set({
          status,
          completedAt: null,
          activeQueueToken: options.queueToken,
        })
        .where(eq(actSyncRuns.id, runId));
    });
  }

  async clearStagedOperations(runId: string, queueToken?: string) {
    await this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select({
          id: actSyncRuns.id,
          completedAt: actSyncRuns.completedAt,
          activeQueueToken: actSyncRuns.activeQueueToken,
        })
        .from(actSyncRuns)
        .where(eq(actSyncRuns.id, runId))
        .limit(1)
        .for("update");
      if (!run) throw new Error("Act! sync preview was not found.");
      if (
        run.activeQueueToken !== null &&
        run.activeQueueToken !== queueToken
      ) {
        throw new Error(
          "The saved sync queue changed in another page. Review the current selections and try again.",
        );
      }

      const operations = await transaction
        .select()
        .from(actSyncOperations)
        .where(eq(actSyncOperations.runId, runId))
        .for("update");
      const now = new Date();
      await transaction
        .update(actSyncOperations)
        .set({
          status: "pending",
          decision: null,
          error: null,
          retryable: true,
          updatedAt: now,
        })
        .where(
          and(
            eq(actSyncOperations.runId, runId),
            eq(actSyncOperations.status, "approved"),
          ),
        );
      await transaction
        .update(actSyncOperations)
        .set({
          decision: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(actSyncOperations.runId, runId),
            eq(actSyncOperations.status, "failed"),
            eq(actSyncOperations.retryable, true),
          ),
        );
      for (const operation of operations) {
        if (operation.status === "approved") {
          operation.status = "pending";
          operation.decision = null;
          operation.error = null;
          operation.retryable = true;
          operation.updatedAt = now;
        } else if (operation.status === "failed" && operation.retryable) {
          operation.decision = null;
          operation.updatedAt = now;
        }
      }

      const status = deriveSyncRunStatus(
        operations.map((operation) => ({
          status: operation.status as ApplyOperationStatus,
        })),
      );
      const finished = status === "completed" || status === "failed";
      await transaction
        .update(actSyncRuns)
        .set({
          status,
          completedAt: finished ? (run.completedAt ?? now) : null,
          activeQueueToken: null,
        })
        .where(eq(actSyncRuns.id, runId));
    });
  }

  async claimOperation(
    runId: string,
    rowId: string,
    decision: SyncDecision,
    localContactId?: string,
    queueToken?: string,
  ) {
    return this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select({
          id: actSyncRuns.id,
          activeQueueToken: actSyncRuns.activeQueueToken,
        })
        .from(actSyncRuns)
        .where(eq(actSyncRuns.id, runId))
        .limit(1)
        .for("update");
      if (!run) return "missing" as const;
      if (run.activeQueueToken !== (queueToken ?? null)) {
        return "superseded" as const;
      }
      const [operation] = await transaction
        .select()
        .from(actSyncOperations)
        .where(
          and(
            eq(actSyncOperations.runId, runId),
            eq(actSyncOperations.rowKey, rowId),
          ),
        )
        .limit(1)
        .for("update");
      if (!operation) return "missing" as const;
      const claim = operationClaimDisposition({
        status: operation.status as ApplyOperationStatus,
        decision: operation.decision as SyncDecision | null,
        actRecordId: operation.actRecordId,
        retryable: operation.retryable,
        updatedAt: operation.updatedAt,
      });
      if (claim === "finished") {
        return "finished" as const;
      }
      if (claim === "in_progress") return "in_progress" as const;
      if (claim === "manual_review") {
        await transaction
          .update(actSyncOperations)
          .set({
            status: "failed",
            error:
              "A previous Act! create may have completed. Create a new preview before trying again.",
            retryable: false,
            updatedAt: new Date(),
          })
          .where(eq(actSyncOperations.id, operation.id));
        return "finished" as const;
      }
      await transaction
        .update(actSyncOperations)
        .set({
          decision,
          localContactId: localContactId ?? operation.localContactId,
          status: "applying",
          error: null,
          retryable: true,
          updatedAt: new Date(),
        })
        .where(eq(actSyncOperations.id, operation.id));
      await transaction
        .update(actSyncRuns)
        .set({ status: "applying", completedAt: null })
        .where(eq(actSyncRuns.id, runId));
      return "claimed" as const;
    });
  }

  async getOperation(
    runId: string,
    rowId: string,
  ): Promise<ApplyOperation | null> {
    const [operation] = await this.database
      .select()
      .from(actSyncOperations)
      .where(
        and(
          eq(actSyncOperations.runId, runId),
          eq(actSyncOperations.rowKey, rowId),
        ),
      )
      .limit(1);
    if (!operation) return null;
    return {
      runId: operation.runId,
      rowId: operation.rowKey,
      status: operation.status as ApplyOperationStatus,
      decision: operation.decision as SyncDecision | null,
      localContactId: operation.localContactId,
      actRecordId: operation.actRecordId,
      error: operation.error,
      retryable: operation.retryable,
      updatedAt: operation.updatedAt,
    };
  }

  async rememberCreatedActId(
    runId: string,
    rowId: string,
    actRecordId: string,
  ) {
    await this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select({ id: actSyncRuns.id })
        .from(actSyncRuns)
        .where(eq(actSyncRuns.id, runId))
        .limit(1)
        .for("update");
      if (!run) throw new Error("Act! sync run is missing.");
      const [operation] = await transaction
        .select({ id: actSyncOperations.id, status: actSyncOperations.status })
        .from(actSyncOperations)
        .where(
          and(
            eq(actSyncOperations.runId, runId),
            eq(actSyncOperations.rowKey, rowId),
          ),
        )
        .limit(1)
        .for("update");
      if (!operation || operation.status !== "applying") {
        throw new Error("Act! sync operation is not active.");
      }
      const [remembered] = await transaction
        .update(actSyncOperations)
        .set({ actRecordId, updatedAt: new Date() })
        .where(eq(actSyncOperations.id, operation.id))
        .returning({ id: actSyncOperations.id });
      if (!remembered) throw new Error("Could not remember the created Act id.");
    });
  }

  async assertLocalContactUnchanged(row: SyncComparisonRow) {
    if (!row.localContactId || !row.localSnapshot) return false;
    return this.database.transaction(async (transaction) => {
      return Boolean(await this.lockPreviewedLocalContact(transaction, row));
    });
  }

  async assertActRecordWritable(row: SyncComparisonRow) {
    if (!row.localContactId || !row.actRecordId) return false;
    const links = await this.database
      .select({
        actRecordId: actExternalLinks.actRecordId,
        isPrimary: actExternalLinks.isPrimary,
        syncMode: actExternalLinks.syncMode,
      })
      .from(actExternalLinks)
      .where(
        and(
          eq(actExternalLinks.entityType, "contact"),
          eq(actExternalLinks.sourceEntityType, "contact"),
          eq(actExternalLinks.entityId, row.localContactId),
        ),
      );
    if (links.length === 0) return true;
    return links.some(
      (link) =>
        link.actRecordId === row.actRecordId &&
        link.isPrimary &&
        link.syncMode === "two_way",
    );
  }

  async withLockedLocalContact<T>(
    row: SyncComparisonRow,
    action: () => Promise<T>,
  ) {
    if (!row.localContactId || !row.localSnapshot) {
      throw new LocalContactChangedAfterPreviewError();
    }
    return this.database.transaction(async (transaction) => {
      if (!(await this.lockPreviewedLocalContact(transaction, row))) {
        throw new LocalContactChangedAfterPreviewError();
      }
      return action();
    });
  }

  async pullContact(row: SyncComparisonRow, remote: RemoteActContact) {
    return this.database.transaction(async (transaction) => {
      if (!row.localContactId) {
        const [recovered] = await transaction
          .select({ entityId: actExternalLinks.entityId })
          .from(actExternalLinks)
          .where(
            and(
              eq(actExternalLinks.entityType, "contact"),
              eq(actExternalLinks.sourceEntityType, "contact"),
              eq(actExternalLinks.isPrimary, true),
              eq(actExternalLinks.syncMode, "two_way"),
              eq(actExternalLinks.actRecordId, remote.id),
            ),
          )
          .limit(1)
          .for("update");
        if (recovered) return recovered.entityId;
      }
      const now = new Date();
      let localContactId = row.localContactId;
      let before: ReturnType<typeof canonicalContactSnapshot> | null = null;
      let organizationId: string | null;
      if (localContactId) {
        const locked = await this.lockPullContact(
          transaction,
          row,
          remote.organizationName,
          now,
        );
        organizationId = locked.organizationId;
        before = locked.currentSnapshot;
        await transaction
          .update(contacts)
          .set({
            ...this.contactValues(remote),
            actRecordId: remote.id,
            updatedAt: now,
          })
          .where(eq(contacts.id, localContactId));
      } else {
        organizationId = await this.resolveOrganizationId(
          transaction,
          remote.organizationName,
          now,
        );
        const [created] = await transaction
          .insert(contacts)
          .values({
            organizationId: null,
            ...this.contactValues(remote),
            actRecordId: remote.id,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: contacts.id });
        if (!created) throw new Error("Could not create pulled contact.");
        localContactId = created.id;
      }

      await setContactPrimaryOrganization(transaction, {
        organizationId,
        contactId: localContactId,
        source: "act_sync",
        now,
      });

      await this.ensureExternalLink(
        transaction,
        localContactId,
        remote.id,
      );
      await this.storeSyncedState(
        transaction,
        localContactId,
        remote,
        now,
      );
      await recordAuditEntry(transaction, {
        entityType: "contact",
        entityId: localContactId,
        action: before ? "act_sync_pulled_update" : "act_sync_pulled_create",
        before,
        after: canonicalContactSnapshot(remote),
      });
      return localContactId;
    });
  }

  async completePush(row: SyncComparisonRow, remote: RemoteActContact) {
    if (!row.localContactId) throw new Error("Local contact is missing.");
    await this.database.transaction(async (transaction) => {
      const locked = await this.lockPreviewedLocalContact(transaction, row);
      if (!locked) {
        throw new LocalContactChangedAfterPreviewError();
      }
      const { current } = locked;
      const now = new Date();
      await this.ensureExternalLink(
        transaction,
        current.id,
        remote.id,
      );
      await transaction
        .update(contacts)
        .set({ actRecordId: remote.id, updatedAt: now })
        .where(eq(contacts.id, current.id));
      await this.storeSyncedState(
        transaction,
        current.id,
        remote,
        now,
      );
      await recordAuditEntry(transaction, {
        entityType: "contact",
        entityId: current.id,
        action: "act_sync_pushed",
        before: row.baseSnapshot,
        after: canonicalContactSnapshot(remote),
      });
    });
  }

  private async lockPullContact(
    writer: SyncWriter,
    row: SyncComparisonRow,
    targetOrganizationName: string | null,
    now: Date,
  ) {
    if (!row.localContactId || !row.localSnapshot) {
      throw new LocalContactChangedAfterPreviewError();
    }
    const [discoveredContact] = await writer
      .select({ organizationId: contacts.organizationId })
      .from(contacts)
      .where(eq(contacts.id, row.localContactId))
      .limit(1);
    if (!discoveredContact) throw new Error("Local contact is missing.");

    const discoveredTarget = targetOrganizationName
      ? await this.findOrganizationByName(writer, targetOrganizationName)
      : null;
    const organizationIds = [
      discoveredContact.organizationId,
      discoveredTarget?.id,
    ]
      .filter((id): id is string => Boolean(id))
      .filter((id, index, ids) => ids.indexOf(id) === index)
      .sort((left, right) => left.localeCompare(right));
    const lockedOrganizations = organizationIds.length > 0
      ? await writer
          .select({ id: organizations.id, name: organizations.name })
          .from(organizations)
          .where(inArray(organizations.id, organizationIds))
          .orderBy(asc(organizations.id))
          .for("update")
      : [];
    const currentOrganization = discoveredContact.organizationId
      ? lockedOrganizations.find(
          ({ id }) => id === discoveredContact.organizationId,
        )
      : null;
    if (discoveredContact.organizationId && !currentOrganization) {
      throw new LocalContactChangedAfterPreviewError();
    }

    let organizationId: string | null = null;
    if (targetOrganizationName) {
      if (discoveredTarget) {
        const lockedTarget = lockedOrganizations.find(
          ({ id }) => id === discoveredTarget.id,
        );
        if (
          !lockedTarget ||
          this.normalizedOrganizationName(lockedTarget.name) !==
            this.normalizedOrganizationName(targetOrganizationName)
        ) {
          throw new LocalContactChangedAfterPreviewError();
        }
        organizationId = lockedTarget.id;
      } else {
        organizationId = await this.createOrganization(
          writer,
          targetOrganizationName,
          now,
        );
      }
    }

    const [current] = await writer
      .select()
      .from(contacts)
      .where(eq(contacts.id, row.localContactId))
      .limit(1)
      .for("update");
    if (
      !current ||
      current.organizationId !== discoveredContact.organizationId
    ) {
      throw new LocalContactChangedAfterPreviewError();
    }
    const currentSnapshot = canonicalContactSnapshot({
      firstName: current.firstName,
      lastName: current.lastName,
      organizationName: currentOrganization?.name ?? null,
      jobTitle: current.jobTitle,
      email: current.email,
      phone: current.phone,
      address1: current.address1,
      address2: current.address2,
      city: current.city,
      region: current.region,
      postalCode: current.postalCode,
    });
    if (!contactSnapshotsEqual(currentSnapshot, row.localSnapshot)) {
      throw new LocalContactChangedAfterPreviewError();
    }
    return { organizationId, currentSnapshot };
  }

  private async lockPreviewedLocalContact(
    writer: SyncWriter,
    row: SyncComparisonRow,
  ) {
    if (!row.localContactId || !row.localSnapshot) return null;
    const [discovered] = await writer
      .select({ organizationId: contacts.organizationId })
      .from(contacts)
      .where(eq(contacts.id, row.localContactId))
      .limit(1);
    if (!discovered) return null;

    const [organization] = discovered.organizationId
      ? await writer
          .select({ id: organizations.id, name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, discovered.organizationId))
          .limit(1)
          .for("update")
      : [];
    const [current] = await writer
      .select()
      .from(contacts)
      .where(eq(contacts.id, row.localContactId))
      .limit(1)
      .for("update");
    if (
      !current ||
      current.organizationId !== discovered.organizationId ||
      (discovered.organizationId && !organization)
    ) {
      return null;
    }

    const currentSnapshot = canonicalContactSnapshot({
      firstName: current.firstName,
      lastName: current.lastName,
      organizationName: organization?.name ?? null,
      jobTitle: current.jobTitle,
      email: current.email,
      phone: current.phone,
      address1: current.address1,
      address2: current.address2,
      city: current.city,
      region: current.region,
      postalCode: current.postalCode,
    });
    if (!contactSnapshotsEqual(currentSnapshot, row.localSnapshot)) return null;
    return { current, currentSnapshot };
  }

  async linkContact(
    localContactId: string,
    remote: RemoteActContact,
  ) {
    await this.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.id, localContactId))
        .limit(1)
        .for("update");
      if (!current) throw new Error("Local contact is missing.");
      const now = new Date();
      await this.ensureExternalLink(
        transaction,
        localContactId,
        remote.id,
      );
      await transaction
        .update(contacts)
        .set({ actRecordId: remote.id, updatedAt: now })
        .where(eq(contacts.id, localContactId));
      await transaction
        .insert(actContactSyncStates)
        .values({
          contactId: localContactId,
          baseSnapshot: null,
          actEditedAt: this.editedDate(remote),
          lastSyncedAt: null,
          localDirty: true,
          state: "conflict",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: actContactSyncStates.contactId,
          set: {
            baseSnapshot: null,
            actEditedAt: this.editedDate(remote),
            localDirty: true,
            state: "conflict",
            updatedAt: now,
          },
        });
      await recordAuditEntry(transaction, {
        entityType: "contact",
        entityId: localContactId,
        action: "act_sync_linked",
        before: null,
        after: { actRecordId: remote.id },
      });
    });
  }

  async finishOperation(
    runId: string,
    rowId: string,
    result: ApplyOperationResult,
  ) {
    await this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select({ id: actSyncRuns.id })
        .from(actSyncRuns)
        .where(eq(actSyncRuns.id, runId))
        .limit(1)
        .for("update");
      if (!run) throw new Error("Act! sync run is missing.");
      const [operation] = await transaction
        .select({ id: actSyncOperations.id })
        .from(actSyncOperations)
        .where(
          and(
            eq(actSyncOperations.runId, runId),
            eq(actSyncOperations.rowKey, rowId),
          ),
        )
        .limit(1)
        .for("update");
      if (!operation) throw new Error("Act! sync operation is missing.");
      await transaction
        .update(actSyncOperations)
        .set({
          status: result.status,
          error: result.error,
          retryable: result.retryable ?? true,
          updatedAt: new Date(),
        })
        .where(eq(actSyncOperations.id, operation.id));
    });
  }

  async finishRun(runId: string) {
    await this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select({
          id: actSyncRuns.id,
          completedAt: actSyncRuns.completedAt,
        })
        .from(actSyncRuns)
        .where(eq(actSyncRuns.id, runId))
        .limit(1)
        .for("update");
      if (!run) return;
      const operations = await transaction
        .select({ status: actSyncOperations.status })
        .from(actSyncOperations)
        .where(eq(actSyncOperations.runId, runId))
        .for("update");
      const status = deriveSyncRunStatus(
        operations.map(({ status: operationStatus }) => ({
          status: operationStatus as ApplyOperationStatus,
        })),
      );
      const finished = status === "completed" || status === "failed";
      await transaction
        .update(actSyncRuns)
        .set({
          status,
          completedAt: finished ? (run.completedAt ?? new Date()) : null,
        })
        .where(eq(actSyncRuns.id, runId));
    });
  }

  private contactValues(remote: RemoteActContact) {
    return {
      firstName: remote.firstName,
      lastName: remote.lastName,
      jobTitle: remote.jobTitle,
      email: remote.email,
      phone: remote.phone,
      normalizedPhone: remote.phone
        ? normalizeNorthAmericanPhone(remote.phone)
        : null,
      address1: remote.address1,
      address2: remote.address2,
      city: remote.city,
      region: remote.region,
      postalCode: remote.postalCode,
    };
  }

  private editedDate(remote: RemoteActContact) {
    if (!remote.editedAt) return null;
    const date = new Date(remote.editedAt);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private async resolveOrganizationId(
    writer: OrganizationWriter,
    organizationName: string | null,
    now: Date,
  ) {
    if (!organizationName) return null;
    const normalized = this.normalizedOrganizationName(organizationName);
    const [existing] = await writer
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        sql`lower(regexp_replace(trim(${organizations.name}), '\\s+', ' ', 'g')) = ${normalized}`,
      )
      .limit(1)
      .for("update");
    if (existing) return existing.id;
    return this.createOrganization(writer, organizationName, now);
  }

  private async findOrganizationByName(
    writer: OrganizationWriter,
    organizationName: string,
  ) {
    const normalized = this.normalizedOrganizationName(organizationName);
    const [organization] = await writer
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(
        sql`lower(regexp_replace(trim(${organizations.name}), '\\s+', ' ', 'g')) = ${normalized}`,
      )
      .limit(1);
    return organization ?? null;
  }

  private normalizedOrganizationName(organizationName: string) {
    return organizationName
      .trim()
      .toLocaleLowerCase("en-US")
      .replace(/\s+/g, " ");
  }

  private async createOrganization(
    writer: OrganizationWriter,
    organizationName: string,
    now: Date,
  ) {
    const [created] = await writer
      .insert(organizations)
      .values({
        name: organizationName,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: organizations.id });
    if (!created) throw new Error("Could not create contact organization.");
    return created.id;
  }

  private async ensureExternalLink(
    writer: SyncWriter,
    contactId: string,
    actRecordId: string,
  ) {
    const [created] = await writer
      .insert(actExternalLinks)
      .values({
        entityType: "contact",
        sourceEntityType: "contact",
        isPrimary: true,
        syncMode: "two_way",
        entityId: contactId,
        actRecordId,
      })
      .onConflictDoNothing()
      .returning({ entityId: actExternalLinks.entityId });
    if (created) return;
    const [existing] = await writer
      .select({ entityId: actExternalLinks.entityId })
      .from(actExternalLinks)
      .where(
        and(
          eq(actExternalLinks.entityType, "contact"),
          eq(actExternalLinks.sourceEntityType, "contact"),
          eq(actExternalLinks.isPrimary, true),
          eq(actExternalLinks.syncMode, "two_way"),
          eq(actExternalLinks.actRecordId, actRecordId),
        ),
      )
      .limit(1);
    if (existing?.entityId !== contactId) {
      throw new Error("Act! record is already linked to another contact.");
    }
  }

  private async storeSyncedState(
    writer: SyncWriter,
    contactId: string,
    remote: RemoteActContact,
    now: Date,
  ) {
    await writer
      .insert(actContactSyncStates)
      .values({
        contactId,
        baseSnapshot: canonicalContactSnapshot(remote),
        actEditedAt: this.editedDate(remote),
        lastSyncedAt: now,
        localDirty: false,
        state: "synced",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: actContactSyncStates.contactId,
        set: {
          baseSnapshot: canonicalContactSnapshot(remote),
          actEditedAt: this.editedDate(remote),
          lastSyncedAt: now,
          localDirty: false,
          state: "synced",
          updatedAt: now,
        },
      });
  }

  async listSyncAuditEntries(contactId: string) {
    return this.database
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.entityType, "contact"),
          eq(auditEntries.entityId, contactId),
        ),
      );
  }
}
