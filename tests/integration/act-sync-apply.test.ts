import { describe, expect, it, vi } from "vitest";

import { ActClient } from "@/features/act-sync/act-client";
import type {
  ActContactInput,
  RemoteActContact,
} from "@/features/act-sync/act-types";
import { ActApiError } from "@/features/act-sync/act-errors";
import {
  canonicalContactSnapshot,
  contactSnapshotsEqual,
} from "@/features/act-sync/contact-snapshot";
import {
  ActSyncService,
  type ActSyncApplyClient,
} from "@/features/act-sync/sync-service";
import type {
  ApplyOperation,
  ApplyOperationResult,
  StageOperationsOptions,
  StoredSyncPreview,
  SyncApplyRepository,
  SyncSummary,
} from "@/features/act-sync/sync-repository";
import {
  deriveSyncRunStatus,
  LocalContactChangedAfterPreviewError,
  operationClaimDisposition,
} from "@/features/act-sync/sync-repository";
import {
  compareContactSets,
  type LocalSyncContact,
  type SyncComparisonRow,
  type SyncDecision,
} from "@/features/act-sync/sync-comparison";

const fields = {
  firstName: "Avery",
  lastName: "Example",
  organizationName: "Marias Fair",
  jobTitle: null,
  email: "avery@example.com",
  phone: "406-555-0101",
  address1: null,
  address2: null,
  city: "Shelby",
  region: "MT",
  postalCode: null,
};

function local(overrides: Partial<LocalSyncContact> = {}): LocalSyncContact {
  return {
    id: "local-1",
    actRecordId: "act-1",
    ...fields,
    baseSnapshot: canonicalContactSnapshot(fields),
    actEditedAt: "2026-07-26T12:00:00Z",
    ...overrides,
  };
}

function remote(
  overrides: Partial<RemoteActContact> = {},
): RemoteActContact {
  return {
    id: "act-1",
    editedAt: "2026-07-26T12:00:00Z",
    ...fields,
    ...overrides,
  };
}

function summary(rows: readonly SyncComparisonRow[]): SyncSummary {
  const counts = {
    new_in_act: 0,
    new_in_app: 0,
    changed_in_act: 0,
    changed_in_app: 0,
    changed_in_both: 0,
    possible_match: 0,
    already_matched: 0,
    missing_from_act: 0,
    error: 0,
  };
  rows.forEach((row) => {
    counts[row.category] += 1;
  });
  return counts;
}

class FakeApplyClient implements ActSyncApplyClient {
  createCalls = 0;
  updateCalls = 0;
  getCalls = 0;
  listCalls = 0;
  failUpdateFor = new Set<string>();
  getFailureFor = new Map<string, Error>();
  beforeUpdate: (() => void) | null = null;
  createFailureAfterPersist: Error | null = null;

  constructor(public contacts: RemoteActContact[]) {}

  async listContacts() {
    this.listCalls += 1;
    return structuredClone(this.contacts);
  }

  async getContact(contactId: string) {
    this.getCalls += 1;
    const failure = this.getFailureFor.get(contactId);
    if (failure) throw failure;
    const contact = this.contacts.find((value) => value.id === contactId);
    if (!contact) throw new Error("Remote contact missing.");
    return structuredClone(contact);
  }

  async createContact(input: ActContactInput) {
    this.createCalls += 1;
    const created: RemoteActContact = {
      id: `act-created-${this.createCalls}`,
      editedAt: "2026-07-27T13:00:00Z",
      ...input,
    };
    this.contacts.push(created);
    if (this.createFailureAfterPersist) {
      throw this.createFailureAfterPersist;
    }
    return structuredClone(created);
  }

  async updateContact(contactId: string, input: ActContactInput) {
    this.updateCalls += 1;
    this.beforeUpdate?.();
    if (this.failUpdateFor.has(contactId)) throw new Error("Act unavailable.");
    const index = this.contacts.findIndex((value) => value.id === contactId);
    if (index < 0) throw new Error("Remote contact missing.");
    const updated = {
      ...this.contacts[index]!,
      ...input,
      editedAt: "2026-07-27T13:00:00Z",
    };
    this.contacts[index] = updated;
    return structuredClone(updated);
  }
}

class InMemoryApplyRepository implements SyncApplyRepository {
  previews = new Map<string, StoredSyncPreview>();
  operations = new Map<string, ApplyOperation>();
  localContacts = new Map<string, LocalSyncContact>();
  appliedPulls: string[] = [];
  appliedPushes: string[] = [];
  linked: { localContactId: string; actRecordId: string }[] = [];
  writableActRecord = true;
  failFinishOnce = false;
  failRememberOnce = false;
  rememberFailureOnce: Error | null = null;
  localLockHeld = false;
  activeQueueToken: string | null = null;
  private nextLocal = 10;

  constructor(rows: SyncComparisonRow[], locals: LocalSyncContact[]) {
    const preview: StoredSyncPreview = {
      id: "run-1",
      status: "previewed",
      rows: structuredClone(rows),
      operations: rows.map((row) => ({
        rowId: row.rowId,
        status: "pending",
        decision: null,
        localContactId: row.localContactId,
        actRecordId: row.actRecordId,
        error: null,
        retryable: true,
        updatedAt: new Date("2026-07-27T12:00:00Z"),
      })),
      summary: summary(rows),
      activeQueueToken: null,
      startedAt: new Date("2026-07-27T12:00:00Z"),
      completedAt: null,
    };
    this.previews.set(preview.id, preview);
    rows.forEach((row) =>
      this.operations.set(row.rowId, {
        runId: preview.id,
        rowId: row.rowId,
        status: "pending",
        decision: null,
        localContactId: row.localContactId,
        actRecordId: row.actRecordId,
        error: null,
        retryable: true,
        updatedAt: new Date("2026-07-27T12:00:00Z"),
      }),
    );
    locals.forEach((contact) =>
      this.localContacts.set(contact.id, structuredClone(contact)),
    );
  }

  async listLocalContacts() {
    return [...this.localContacts.values()].map((value) =>
      structuredClone(value),
    );
  }

  async createPreview(
    rows: readonly SyncComparisonRow[],
    counts: SyncSummary,
  ): Promise<StoredSyncPreview> {
    void rows;
    void counts;
    throw new Error("Not used in apply tests.");
  }

  async getPreview(runId: string) {
    const preview = this.previews.get(runId);
    return preview ? structuredClone(preview) : null;
  }

  async getLatestPreview() {
    const preview = [...this.previews.values()].at(-1);
    return preview ? structuredClone(preview) : null;
  }

  async stageOperations(
    runId: string,
    decisions: readonly {
      rowId: string;
      decision: SyncDecision;
      localContactId?: string;
    }[],
    options: StageOperationsOptions,
  ) {
    if (options.replaceExisting) {
      await this.clearStagedOperations(
        runId,
        this.activeQueueToken ?? undefined,
      );
      this.activeQueueToken = options.queueToken;
    } else if (this.activeQueueToken !== options.queueToken) {
      throw new Error(
        "The saved sync queue changed in another page. Review the current selections and try again.",
      );
    }
    for (const decision of decisions) {
      const operation = this.operations.get(decision.rowId);
      if (!operation || operation.runId !== runId) {
        throw new Error("Operation missing.");
      }
      this.operations.set(decision.rowId, {
        ...operation,
        status: "approved",
        decision: decision.decision,
        localContactId:
          decision.localContactId ?? operation.localContactId,
        error: null,
        retryable: true,
        updatedAt: new Date(),
      });
    }
  }

  async clearStagedOperations(runId: string, queueToken?: string) {
    if (
      this.activeQueueToken !== null &&
      this.activeQueueToken !== queueToken
    ) {
      throw new Error(
        "The saved sync queue changed in another page. Review the current selections and try again.",
      );
    }
    this.activeQueueToken = null;
    for (const [rowId, operation] of this.operations) {
      if (operation.runId !== runId) continue;
      if (operation.status === "approved") {
        this.operations.set(rowId, {
          ...operation,
          status: "pending",
          decision: null,
          error: null,
          retryable: true,
          updatedAt: new Date(),
        });
      } else if (operation.status === "failed" && operation.retryable) {
        this.operations.set(rowId, {
          ...operation,
          decision: null,
          updatedAt: new Date(),
        });
      }
    }
  }

  async claimOperation(
    runId: string,
    rowId: string,
    decision: SyncDecision,
    localContactId?: string,
    queueToken?: string,
  ) {
    if (this.activeQueueToken !== (queueToken ?? null)) {
      return "superseded" as const;
    }
    const operation = this.operations.get(rowId);
    if (!operation || operation.runId !== runId) return "missing" as const;
    const claim = operationClaimDisposition(operation);
    if (claim === "finished") {
      return "finished" as const;
    }
    if (claim === "in_progress") return "in_progress" as const;
    if (claim === "manual_review") {
      this.operations.set(rowId, {
        ...operation,
        status: "failed",
        error:
          "A previous Act! create may have completed. Create a new preview before trying again.",
        retryable: false,
        updatedAt: new Date(),
      });
      return "finished" as const;
    }
    this.operations.set(rowId, {
      ...operation,
      status: "applying",
      decision,
      localContactId: localContactId ?? operation.localContactId,
      error: null,
      retryable: true,
      updatedAt: new Date(),
    });
    const preview = this.previews.get(runId);
    if (preview) {
      this.previews.set(runId, {
        ...preview,
        status: "applying",
        completedAt: null,
      });
    }
    return "claimed" as const;
  }

  async getOperation(runId: string, rowId: string) {
    const operation = this.operations.get(rowId);
    return operation?.runId === runId ? structuredClone(operation) : null;
  }

  async rememberCreatedActId(runId: string, rowId: string, actRecordId: string) {
    if (this.rememberFailureOnce) {
      const error = this.rememberFailureOnce;
      this.rememberFailureOnce = null;
      throw error;
    }
    if (this.failRememberOnce) {
      this.failRememberOnce = false;
      throw new Error("Could not remember the created Act id.");
    }
    const operation = await this.getOperation(runId, rowId);
    if (!operation) throw new Error("Operation missing.");
    this.operations.set(rowId, {
      ...operation,
      actRecordId,
      updatedAt: new Date(),
    });
  }

  async assertLocalContactUnchanged(row: SyncComparisonRow) {
    if (!row.localContactId || !row.localSnapshot) return true;
    const current = this.localContacts.get(row.localContactId);
    return Boolean(
      current &&
        contactSnapshotsEqual(
          canonicalContactSnapshot(current),
          row.localSnapshot,
        ),
    );
  }

  async assertActRecordWritable() {
    return this.writableActRecord;
  }

  async withLockedLocalContact<T>(
    row: SyncComparisonRow,
    action: () => Promise<T>,
  ) {
    if (!(await this.assertLocalContactUnchanged(row))) {
      throw new LocalContactChangedAfterPreviewError();
    }
    this.localLockHeld = true;
    try {
      return await action();
    } finally {
      this.localLockHeld = false;
    }
  }

  async pullContact(row: SyncComparisonRow, value: RemoteActContact) {
    const recovered = [...this.localContacts.values()].find(
      (contact) => contact.actRecordId === value.id,
    );
    const localContactId =
      row.localContactId ?? recovered?.id ?? `local-${this.nextLocal++}`;
    this.localContacts.set(localContactId, {
      ...value,
      id: localContactId,
      actRecordId: value.id,
      baseSnapshot: canonicalContactSnapshot(value),
      actEditedAt: value.editedAt,
    });
    this.appliedPulls.push(row.rowId);
    return localContactId;
  }

  async completePush(row: SyncComparisonRow, value: RemoteActContact) {
    const localContactId = row.localContactId;
    if (!localContactId) throw new Error("Local contact missing.");
    const current = this.localContacts.get(localContactId);
    if (!current) throw new Error("Local contact missing.");
    this.localContacts.set(localContactId, {
      ...current,
      actRecordId: value.id,
      baseSnapshot: canonicalContactSnapshot(value),
      actEditedAt: value.editedAt,
    });
    this.appliedPushes.push(row.rowId);
  }

  async linkContact(
    localContactId: string,
    value: RemoteActContact,
  ) {
    this.linked.push({ localContactId, actRecordId: value.id });
  }

  async finishOperation(
    runId: string,
    rowId: string,
    result: ApplyOperationResult,
  ) {
    if (this.failFinishOnce) {
      this.failFinishOnce = false;
      throw new Error("Operation finalization failed.");
    }
    const operation = await this.getOperation(runId, rowId);
    if (!operation) throw new Error("Operation missing.");
    this.operations.set(rowId, {
      ...operation,
      status: result.status,
      error: result.error,
      retryable: result.retryable ?? true,
      updatedAt: new Date(),
    });
  }

  async finishRun(runId: string) {
    const preview = this.previews.get(runId);
    if (!preview) throw new Error("Preview missing.");
    const runOperations = [...this.operations.values()].filter(
      (operation) => operation.runId === runId,
    );
    const status = deriveSyncRunStatus(runOperations);
    this.previews.set(runId, {
      ...preview,
      status,
      completedAt:
        status === "completed" || status === "failed"
          ? new Date("2026-07-27T13:00:00Z")
          : null,
      operations: runOperations.map((operation) => ({
        rowId: operation.rowId,
        status: operation.status,
        decision: operation.decision,
        localContactId: operation.localContactId,
        actRecordId: operation.actRecordId,
        error: operation.error,
        retryable: operation.retryable,
        updatedAt: operation.updatedAt,
      })),
    });
  }
}

describe("ActSyncService apply", () => {
  it("pulls a new Act contact into Command Center", async () => {
    const rows = compareContactSets([], [remote()]);
    const repository = new InMemoryApplyRepository(rows, []);
    const client = new FakeApplyClient([remote()]);
    const service = new ActSyncService(client, repository);

    const result = await service.apply("run-1", [
      { rowId: rows[0]!.rowId, decision: "pull" },
    ]);

    expect(result.rows).toEqual([
      expect.objectContaining({ status: "completed" }),
    ]);
    expect(repository.appliedPulls).toEqual([rows[0]!.rowId]);
    expect(repository.localContacts.get("local-10")).toMatchObject({
      actRecordId: "act-1",
      email: "avery@example.com",
      organizationName: "Marias Fair",
    });
    expect(client.getCalls).toBe(0);
  });

  it("fails a malformed new Act row without requesting Act", async () => {
    const rows = compareContactSets([], [remote()]);
    rows[0] = { ...rows[0]!, actSnapshot: null };
    const repository = new InMemoryApplyRepository(rows, []);
    const client = new FakeApplyClient([remote()]);
    const service = new ActSyncService(client, repository);

    const result = await service.apply("run-1", [
      { rowId: rows[0]!.rowId, decision: "pull" },
    ]);

    expect(result.rows[0]).toMatchObject({
      status: "failed",
      error: "The reviewed Act! contact is incomplete. Create a new preview.",
    });
    expect(client.getCalls).toBe(0);
    expect(repository.appliedPulls).toEqual([]);
  });

  it("still rechecks Act before overwriting an existing local contact", async () => {
    const existing = local();
    const rows = compareContactSets(
      [existing],
      [remote({ phone: "406-555-0202" })],
    );
    const repository = new InMemoryApplyRepository(rows, [existing]);
    const client = new FakeApplyClient([
      remote({ phone: "406-555-0202" }),
    ]);
    const service = new ActSyncService(client, repository);

    await service.apply("run-1", [
      { rowId: rows[0]!.rowId, decision: "pull" },
    ]);

    expect(client.getCalls).toBe(1);
  });

  it("does not overwrite a local contact changed after the preview", async () => {
    const existing = local();
    const rows = compareContactSets(
      [existing],
      [remote({ phone: "406-555-0202" })],
    );
    const repository = new InMemoryApplyRepository(rows, [existing]);
    repository.localContacts.set(existing.id, {
      ...existing,
      jobTitle: "Edited after preview",
    });
    const client = new FakeApplyClient([
      remote({ phone: "406-555-0202" }),
    ]);

    const result = await new ActSyncService(client, repository).apply(
      "run-1",
      [{ rowId: rows[0]!.rowId, decision: "pull" }],
    );

    expect(result.rows[0]).toMatchObject({
      status: "failed",
      error:
        "Command Center changed after this preview. Create a new preview.",
    });
    expect(client.getCalls).toBe(0);
    expect(repository.appliedPulls).toEqual([]);
    expect(repository.localContacts.get(existing.id)?.jobTitle).toBe(
      "Edited after preview",
    );
  });

  it("does not write a stale local snapshot to an existing Act contact", async () => {
    const changedLocal = local({ phone: "406-555-9999" });
    const rows = compareContactSets([changedLocal], [remote()]);
    const repository = new InMemoryApplyRepository(rows, [changedLocal]);
    repository.localContacts.set(changedLocal.id, {
      ...changedLocal,
      jobTitle: "Edited after preview",
    });
    const client = new FakeApplyClient([remote()]);

    const result = await new ActSyncService(client, repository).apply(
      "run-1",
      [{ rowId: rows[0]!.rowId, decision: "push" }],
    );

    expect(result.rows[0]).toMatchObject({
      status: "failed",
      error:
        "Command Center changed after this preview. Create a new preview.",
    });
    expect(client.getCalls).toBe(0);
    expect(client.updateCalls).toBe(0);
  });

  it("does not update Act through a pull-only Contact alias", async () => {
    const changedLocal = local({ phone: "406-555-9999" });
    const alias = remote({ id: "act-alias" });
    const rows = compareContactSets([changedLocal], [alias]);
    const repository = new InMemoryApplyRepository(rows, [changedLocal]);
    repository.writableActRecord = false;
    const client = new FakeApplyClient([alias]);

    const result = await new ActSyncService(client, repository).apply(
      "run-1",
      [{ rowId: rows[0]!.rowId, decision: "push" }],
    );

    expect(result.rows[0]).toMatchObject({ status: "failed" });
    expect(client.updateCalls).toBe(0);
  });

  it("holds the local contact lock while writing its reviewed snapshot to Act", async () => {
    const changedLocal = local({ phone: "406-555-9999" });
    const rows = compareContactSets([changedLocal], [remote()]);
    const repository = new InMemoryApplyRepository(rows, [changedLocal]);
    const client = new FakeApplyClient([remote()]);
    let lockHeldDuringUpdate = false;
    client.beforeUpdate = () => {
      lockHeldDuringUpdate = repository.localLockHeld;
    };

    const result = await new ActSyncService(client, repository).apply(
      "run-1",
      [{ rowId: rows[0]!.rowId, decision: "push" }],
    );

    expect(result.rows[0]).toMatchObject({ status: "completed" });
    expect(lockHeldDuringUpdate).toBe(true);
  });

  it("does not create an Act contact from a stale new-local preview", async () => {
    const newLocal = local({
      actRecordId: null,
      baseSnapshot: null,
      actEditedAt: null,
    });
    const rows = compareContactSets([newLocal], []);
    const repository = new InMemoryApplyRepository(rows, [newLocal]);
    repository.localContacts.set(newLocal.id, {
      ...newLocal,
      phone: "406-555-7777",
    });
    const client = new FakeApplyClient([]);

    const result = await new ActSyncService(client, repository).apply(
      "run-1",
      [{ rowId: rows[0]!.rowId, decision: "push" }],
    );

    expect(result.rows[0]).toMatchObject({
      status: "failed",
      error:
        "Command Center changed after this preview. Create a new preview.",
    });
    expect(client.createCalls).toBe(0);
  });

  it("pushes a new local contact once and reuses the completed result on retry", async () => {
    const newLocal = local({
      actRecordId: null,
      baseSnapshot: null,
      actEditedAt: null,
    });
    const rows = compareContactSets([newLocal], []);
    const repository = new InMemoryApplyRepository(rows, [newLocal]);
    const client = new FakeApplyClient([]);
    const service = new ActSyncService(client, repository);
    const decision = { rowId: rows[0]!.rowId, decision: "push" as const };

    await service.apply("run-1", [decision]);
    const retry = await service.apply("run-1", [decision]);

    expect(client.createCalls).toBe(1);
    expect(repository.appliedPushes).toEqual([rows[0]!.rowId]);
    expect(retry.rows[0]).toMatchObject({ status: "completed" });
  });

  it("does not overwrite Act when the remote record changed after preview", async () => {
    const changedLocal = local({ phone: "406-555-9999" });
    const rows = compareContactSets([changedLocal], [remote()]);
    const repository = new InMemoryApplyRepository(rows, [changedLocal]);
    const client = new FakeApplyClient([
      remote({
        editedAt: "2026-07-27T12:30:00Z",
        jobTitle: "Changed after preview",
      }),
    ]);
    const service = new ActSyncService(client, repository);

    const result = await service.apply("run-1", [
      { rowId: rows[0]!.rowId, decision: "push" },
    ]);

    expect(result.rows[0]).toMatchObject({
      status: "failed",
      error: "Act! changed after this preview. Create a new preview.",
    });
    expect(client.updateCalls).toBe(0);
  });

  it("re-fetches Act for link and both keep-direction decisions", async () => {
    const changedLocal = local({ phone: "406-555-9999" });
    const conflictRows = compareContactSets(
      [changedLocal],
      [remote({ jobTitle: "Changed in Act" })],
    );

    for (const decision of ["keep_act", "keep_app"] as const) {
      const repository = new InMemoryApplyRepository(conflictRows, [
        changedLocal,
      ]);
      const client = new FakeApplyClient([
        remote({ jobTitle: "Changed in Act" }),
      ]);

      await new ActSyncService(client, repository).apply("run-1", [
        { rowId: conflictRows[0]!.rowId, decision },
      ]);

      expect(client.getCalls).toBe(1);
    }

    const linkRow: SyncComparisonRow = {
      ...conflictRows[0]!,
      rowId: "possible:email:avery@example.com",
      category: "possible_match",
      allowedDecisions: ["link", "keep_separate", "skip"],
      candidateLocalContactIds: [changedLocal.id],
    };
    const linkRepository = new InMemoryApplyRepository(
      [linkRow],
      [changedLocal],
    );
    const linkClient = new FakeApplyClient([
      remote({ jobTitle: "Changed in Act" }),
    ]);

    await new ActSyncService(linkClient, linkRepository).apply("run-1", [
      {
        rowId: linkRow.rowId,
        decision: "link",
        localContactId: changedLocal.id,
      },
    ]);

    expect(linkClient.getCalls).toBe(1);
  });

  it("stages an approved link target for durable reload recovery", async () => {
    const first = local({ id: "first" });
    const second = local({ id: "second", email: "second@example.com" });
    const linkRow: SyncComparisonRow = {
      ...compareContactSets([first], [remote()])[0]!,
      rowId: "possible:act-1",
      category: "possible_match",
      localContactId: null,
      candidateLocalContactIds: [first.id, second.id],
      allowedDecisions: ["link", "keep_separate", "skip"],
    };
    const repository = new InMemoryApplyRepository(
      [linkRow],
      [first, second],
    );
    const service = new ActSyncService(
      new FakeApplyClient([remote()]),
      repository,
    );

    await service.stage("run-1", [
      {
        rowId: linkRow.rowId,
        decision: "link",
        localContactId: second.id,
      },
    ]);

    expect(repository.operations.get(linkRow.rowId)).toMatchObject({
      status: "approved",
      decision: "link",
      localContactId: second.id,
    });
  });

  it("atomically replaces and clears a durable approval queue", async () => {
    const rows = compareContactSets([], [
      remote({ id: "act-1" }),
      remote({ id: "act-2", email: "second@example.com" }),
    ]);
    const repository = new InMemoryApplyRepository(rows, []);
    const service = new ActSyncService(
      new FakeApplyClient([
        remote({ id: "act-1" }),
        remote({ id: "act-2", email: "second@example.com" }),
      ]),
      repository,
    );

    await service.stage("run-1", [
      { rowId: rows[0]!.rowId, decision: "pull" },
    ]);
    const replacementQueue = await service.stage(
      "run-1",
      [{ rowId: rows[1]!.rowId, decision: "pull" }],
      true,
    );

    expect(repository.operations.get(rows[0]!.rowId)).toMatchObject({
      status: "pending",
      decision: null,
    });
    expect(repository.operations.get(rows[1]!.rowId)).toMatchObject({
      status: "approved",
      decision: "pull",
    });

    await service.clearStaged("run-1", replacementQueue.queueToken);

    expect(repository.operations.get(rows[1]!.rowId)).toMatchObject({
      status: "pending",
      decision: null,
    });
  });

  it("rejects stale staging and apply chunks after another queue replaces them", async () => {
    const rows = compareContactSets([], [
      remote({ id: "act-1" }),
      remote({ id: "act-2", email: "second@example.com" }),
      remote({ id: "act-3", email: "third@example.com" }),
    ]);
    const repository = new InMemoryApplyRepository(rows, []);
    const client = new FakeApplyClient([
      remote({ id: "act-1" }),
      remote({ id: "act-2", email: "second@example.com" }),
      remote({ id: "act-3", email: "third@example.com" }),
    ]);
    const service = new ActSyncService(client, repository);

    const queueA = await service.stage(
      "run-1",
      [{ rowId: rows[0]!.rowId, decision: "pull" }],
      true,
    );
    const queueB = await service.stage(
      "run-1",
      [{ rowId: rows[1]!.rowId, decision: "pull" }],
      true,
    );

    await expect(
      service.clearStaged("run-1", queueA.queueToken),
    ).rejects.toThrow("queue changed");
    await expect(
      service.stage(
        "run-1",
        [{ rowId: rows[2]!.rowId, decision: "pull" }],
        false,
        queueA.queueToken,
      ),
    ).rejects.toThrow("queue changed");
    await expect(
      service.apply(
        "run-1",
        [{ rowId: rows[0]!.rowId, decision: "pull" }],
        queueA.queueToken,
      ),
    ).rejects.toThrow("queue changed");
    await expect(
      service.apply("run-1", [
        { rowId: rows[0]!.rowId, decision: "pull" },
      ]),
    ).rejects.toThrow("queue changed");
    await service.stage(
      "run-1",
      [{ rowId: rows[2]!.rowId, decision: "pull" }],
      false,
      queueB.queueToken,
    );

    expect(repository.operations.get(rows[0]!.rowId)).toMatchObject({
      status: "pending",
      decision: null,
    });
    expect(repository.operations.get(rows[1]!.rowId)).toMatchObject({
      status: "approved",
      decision: "pull",
    });
    expect(repository.operations.get(rows[2]!.rowId)).toMatchObject({
      status: "approved",
      decision: "pull",
    });
    expect(client.getCalls).toBe(0);
  });

  it("requires an explicit allowed decision for conflicts", async () => {
    const changedLocal = local({ phone: "406-555-9999" });
    const rows = compareContactSets(
      [changedLocal],
      [remote({ jobTitle: "Owner" })],
    );
    const repository = new InMemoryApplyRepository(rows, [changedLocal]);
    const service = new ActSyncService(
      new FakeApplyClient([remote({ jobTitle: "Owner" })]),
      repository,
    );

    const result = await service.apply("run-1", [
      { rowId: rows[0]!.rowId, decision: "pull" },
    ]);

    expect(result.rows[0]).toMatchObject({
      status: "failed",
      error: "Choose how to resolve this row before applying it.",
    });
  });

  it("keeps successful rows when a later row fails and does not repeat them", async () => {
    const first = local({
      id: "first",
      actRecordId: "act-1",
      phone: "406-555-1001",
    });
    const second = local({
      id: "second",
      actRecordId: "act-2",
      phone: "406-555-1002",
    });
    const rows = compareContactSets(
      [first, second],
      [remote({ id: "act-1" }), remote({ id: "act-2" })],
    );
    const repository = new InMemoryApplyRepository(rows, [first, second]);
    const client = new FakeApplyClient([
      remote({ id: "act-1" }),
      remote({ id: "act-2" }),
    ]);
    client.failUpdateFor.add("act-2");
    const service = new ActSyncService(client, repository);
    const decisions = rows.map((row) => ({
      rowId: row.rowId,
      decision: "push" as const,
    }));

    const firstResult = await service.apply("run-1", decisions);
    client.failUpdateFor.clear();
    const retry = await service.apply("run-1", decisions);

    expect(firstResult.rows.map((row) => row.status)).toEqual([
      "completed",
      "failed",
    ]);
    expect(retry.rows.map((row) => row.status)).toEqual([
      "completed",
      "completed",
    ]);
    expect(
      repository.appliedPushes.filter((rowId) => rowId === rows[0]!.rowId),
    ).toHaveLength(1);
  });

  it("pauses later rows when Act returns a systemic sanitized failure", async () => {
    const first = local({
      id: "first",
      actRecordId: "act-1",
      phone: "406-555-1001",
    });
    const second = local({
      id: "second",
      actRecordId: "act-2",
      phone: "406-555-1002",
    });
    const rows = compareContactSets(
      [first, second],
      [remote({ id: "act-1" }), remote({ id: "act-2" })],
    );
    const repository = new InMemoryApplyRepository(rows, [first, second]);
    const client = new FakeApplyClient([
      remote({ id: "act-1" }),
      remote({ id: "act-2" }),
    ]);
    client.getFailureFor.set(
      "act-1",
      new ActApiError("rate_limited", true),
    );

    await expect(
      new ActSyncService(client, repository).apply(
        "run-1",
        rows.map((value) => ({
          rowId: value.rowId,
          decision: "push" as const,
        })),
      ),
    ).rejects.toMatchObject({
      code: "rate_limited",
      message: "Act! is temporarily rate limiting requests. Try again later.",
    });

    expect(client.getCalls).toBe(1);
    expect(repository.operations.get(rows[0]!.rowId)).toMatchObject({
      status: "failed",
      retryable: true,
      error: "Act! is temporarily rate limiting requests. Try again later.",
    });
    expect(repository.operations.get(rows[1]!.rowId)?.status).toBe("pending");
  });

  it("returns the attempted row prefix when a later row is interrupted", async () => {
    const first = local({
      id: "first",
      actRecordId: "act-1",
      phone: "406-555-1001",
    });
    const second = local({
      id: "second",
      actRecordId: "act-2",
      phone: "406-555-1002",
    });
    const third = local({
      id: "third",
      actRecordId: "act-3",
      phone: "406-555-1003",
    });
    const fourth = local({
      id: "fourth",
      actRecordId: "act-4",
      phone: "406-555-1004",
    });
    const rows = compareContactSets(
      [first, second, third, fourth],
      [
        remote({ id: "act-1" }),
        remote({ id: "act-2" }),
        remote({ id: "act-3" }),
        remote({ id: "act-4" }),
      ],
    );
    const repository = new InMemoryApplyRepository(
      rows,
      [first, second, third, fourth],
    );
    const client = new FakeApplyClient([
      remote({ id: "act-1" }),
      remote({ id: "act-2" }),
      remote({ id: "act-3" }),
      remote({ id: "act-4" }),
    ]);
    client.getFailureFor.set(
      "act-3",
      new ActApiError("rate_limited", true),
    );

    await expect(
      new ActSyncService(client, repository).apply(
        "run-1",
        rows.map((value, index) => ({
          rowId: value.rowId,
          decision: index === 1 ? ("skip" as const) : ("push" as const),
        })),
      ),
    ).rejects.toMatchObject({
      processedRows: [
        {
          rowId: rows[0]!.rowId,
          status: "completed",
          error: null,
        },
        {
          rowId: rows[1]!.rowId,
          status: "skipped",
          error: null,
        },
        {
          rowId: rows[2]!.rowId,
          status: "failed",
          retryable: true,
        },
      ],
    });

    expect(repository.operations.get(rows[3]!.rowId)?.status).toBe("pending");
  });

  it("preserves a systemic Act error's non-retryable state", async () => {
    const first = local({
      id: "first",
      actRecordId: "act-1",
      phone: "406-555-1001",
    });
    const second = local({
      id: "second",
      actRecordId: "act-2",
      phone: "406-555-1002",
    });
    const rows = compareContactSets(
      [first, second],
      [remote({ id: "act-1" }), remote({ id: "act-2" })],
    );
    const repository = new InMemoryApplyRepository(rows, [first, second]);
    const client = new FakeApplyClient([
      remote({ id: "act-1" }),
      remote({ id: "act-2" }),
    ]);
    client.getFailureFor.set(
      "act-1",
      new ActApiError("authentication_failed", false),
    );

    await expect(
      new ActSyncService(client, repository).apply(
        "run-1",
        rows.map((value) => ({
          rowId: value.rowId,
          decision: "push" as const,
        })),
      ),
    ).rejects.toMatchObject({ code: "authentication_failed" });

    expect(repository.operations.get(rows[0]!.rowId)).toMatchObject({
      status: "failed",
      retryable: false,
    });
    expect(repository.operations.get(rows[1]!.rowId)?.status).toBe("pending");
  });

  it.each([
    {
      status: 401,
      code: "authentication_failed",
      error:
        "Act! rejected the shared account credentials. Check the Render settings.",
      retryable: false,
    },
    {
      status: 403,
      code: "permission_denied",
      error: "This Act! account does not currently have Web API permission.",
      retryable: false,
    },
    {
      status: 429,
      code: "rate_limited",
      error: "Act! is temporarily rate limiting requests. Try again later.",
      retryable: true,
    },
  ] as const)(
    "preserves retryability when Act rejects a create with $status",
    async ({ status, code, error, retryable }) => {
      const newLocal = local({
        actRecordId: null,
        baseSnapshot: null,
        actEditedAt: null,
      });
      const rows = compareContactSets([newLocal], []);
      const repository = new InMemoryApplyRepository(rows, [newLocal]);
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ token: "safe-test-token" }), {
            status: 200,
          }),
        )
        .mockResolvedValueOnce(new Response("", { status }));
      const client = new ActClient(
        {
          baseUrl: "https://apius.act.com/act.web.api",
          databaseName: "TEST-ACT-DATABASE",
          username: "shared",
          password: "secret",
        },
        { fetcher },
      );

      await expect(
        new ActSyncService(client, repository).apply("run-1", [
          { rowId: rows[0]!.rowId, decision: "push" },
        ]),
      ).rejects.toMatchObject({
        code,
        row: {
          error,
          rowId: rows[0]!.rowId,
          status: "failed",
          retryable,
        },
      });
      expect(repository.operations.get(rows[0]!.rowId)).toMatchObject({
        error,
        status: "failed",
        retryable,
      });
    },
  );

  it("preserves retryable unavailability before dispatching a create", async () => {
    const newLocal = local({
      actRecordId: null,
      baseSnapshot: null,
      actEditedAt: null,
    });
    const rows = compareContactSets([newLocal], []);
    const repository = new InMemoryApplyRepository(rows, [newLocal]);
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("network details"));
    const client = new ActClient(
      {
        baseUrl: "https://apius.act.com/act.web.api",
        databaseName: "TEST-ACT-DATABASE",
        username: "shared",
        password: "secret",
      },
      { fetcher },
    );

    await expect(
      new ActSyncService(client, repository).apply("run-1", [
        { rowId: rows[0]!.rowId, decision: "push" },
      ]),
    ).rejects.toMatchObject({
      code: "unavailable",
      row: {
        error: "Act! could not be reached. Try again later.",
        retryable: true,
      },
    });
    expect(repository.operations.get(rows[0]!.rowId)).toMatchObject({
      error: "Act! could not be reached. Try again later.",
      retryable: true,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("blocks retry when a create receives an ambiguous server failure", async () => {
    const newLocal = local({
      actRecordId: null,
      baseSnapshot: null,
      actEditedAt: null,
    });
    const rows = compareContactSets([newLocal], []);
    const repository = new InMemoryApplyRepository(rows, [newLocal]);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "safe-test-token" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response("", { status: 503 }));
    const client = new ActClient(
      {
        baseUrl: "https://apius.act.com/act.web.api",
        databaseName: "TEST-ACT-DATABASE",
        username: "shared",
        password: "secret",
      },
      { fetcher },
    );
    const service = new ActSyncService(client, repository);
    const decision = { rowId: rows[0]!.rowId, decision: "push" as const };

    await expect(service.apply("run-1", [decision])).rejects.toMatchObject({
      code: "unavailable",
      row: {
        error:
          "A previous Act! create may have completed. Create a new preview before trying again.",
        retryable: false,
      },
    });
    const retry = await service.apply("run-1", [decision]);

    expect(retry.rows[0]).toMatchObject({
      status: "failed",
      retryable: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("marks a category-only apply partial while other rows remain pending", async () => {
    const newLocal = local({
      actRecordId: null,
      baseSnapshot: null,
      actEditedAt: null,
    });
    const comparisonRows = compareContactSets([newLocal], [
      remote({
        id: "act-new",
        firstName: "Other",
        organizationName: "Other Fair",
        email: "other@example.com",
      }),
    ]);
    const repository = new InMemoryApplyRepository(comparisonRows, [newLocal]);
    const client = new FakeApplyClient([
      remote({
        id: "act-new",
        firstName: "Other",
        organizationName: "Other Fair",
        email: "other@example.com",
      }),
    ]);
    const newActRow = comparisonRows.find(
      (value) => value.category === "new_in_act",
    )!;

    await new ActSyncService(client, repository).apply("run-1", [
      { rowId: newActRow.rowId, decision: "pull" },
    ]);

    expect(repository.previews.get("run-1")).toMatchObject({
      status: "partial",
      completedAt: null,
    });
  });

  it("recovers an interrupted local import without duplicating the contact", async () => {
    const comparisonRows = compareContactSets([], [remote()]);
    const repository = new InMemoryApplyRepository(comparisonRows, []);
    repository.failFinishOnce = true;
    const client = new FakeApplyClient([remote()]);
    const service = new ActSyncService(client, repository);
    const decision = {
      rowId: comparisonRows[0]!.rowId,
      decision: "pull" as const,
    };

    await expect(service.apply("run-1", [decision])).rejects.toThrow(
      "Operation finalization failed.",
    );
    const stranded = repository.operations.get(decision.rowId)!;
    repository.operations.set(decision.rowId, {
      ...stranded,
      updatedAt: new Date(0),
    });

    const retry = await service.apply("run-1", [decision]);

    expect(retry.rows[0]).toMatchObject({ status: "completed" });
    expect(repository.localContacts.size).toBe(1);
    expect(client.createCalls).toBe(0);
  });

  it("reuses a remembered Act id after interrupted push finalization", async () => {
    const newLocal = local({
      actRecordId: null,
      baseSnapshot: null,
      actEditedAt: null,
    });
    const comparisonRows = compareContactSets([newLocal], []);
    const repository = new InMemoryApplyRepository(comparisonRows, [newLocal]);
    repository.failFinishOnce = true;
    const client = new FakeApplyClient([]);
    const service = new ActSyncService(client, repository);
    const decision = {
      rowId: comparisonRows[0]!.rowId,
      decision: "push" as const,
    };

    await expect(service.apply("run-1", [decision])).rejects.toThrow(
      "Operation finalization failed.",
    );
    const stranded = repository.operations.get(decision.rowId)!;
    repository.operations.set(decision.rowId, {
      ...stranded,
      updatedAt: new Date(0),
    });

    const retry = await service.apply("run-1", [decision]);

    expect(retry.rows[0]).toMatchObject({ status: "completed" });
    expect(client.createCalls).toBe(1);
    expect(client.getCalls).toBe(1);
  });

  it("blocks retry when an Act create succeeds but its response is lost", async () => {
    const newLocal = local({
      actRecordId: null,
      baseSnapshot: null,
      actEditedAt: null,
    });
    const comparisonRows = compareContactSets([newLocal], []);
    const repository = new InMemoryApplyRepository(comparisonRows, [newLocal]);
    const client = new FakeApplyClient([]);
    client.createFailureAfterPersist = new ActApiError("unavailable", true);
    const service = new ActSyncService(client, repository);
    const decision = {
      rowId: comparisonRows[0]!.rowId,
      decision: "push" as const,
    };

    await expect(service.apply("run-1", [decision])).rejects.toThrow();
    const retry = await service.apply("run-1", [decision]);

    expect(repository.operations.get(decision.rowId)).toMatchObject({
      status: "failed",
      retryable: false,
      error:
        "A previous Act! create may have completed. Create a new preview before trying again.",
    });
    expect(retry.rows[0]).toMatchObject({
      status: "failed",
      retryable: false,
    });
    expect(client.createCalls).toBe(1);
  });

  it("blocks retry when persisting a created Act id fails", async () => {
    const newLocal = local({
      actRecordId: null,
      baseSnapshot: null,
      actEditedAt: null,
    });
    const comparisonRows = compareContactSets([newLocal], []);
    const repository = new InMemoryApplyRepository(comparisonRows, [newLocal]);
    repository.failRememberOnce = true;
    const client = new FakeApplyClient([]);
    const service = new ActSyncService(client, repository);
    const decision = {
      rowId: comparisonRows[0]!.rowId,
      decision: "push" as const,
    };

    await expect(service.apply("run-1", [decision])).rejects.toThrow();
    await service.apply("run-1", [decision]);

    expect(repository.operations.get(decision.rowId)).toMatchObject({
      status: "failed",
      retryable: false,
    });
    expect(client.createCalls).toBe(1);
  });

  it("keeps Act id persistence failures ambiguous regardless of error metadata", async () => {
    const newLocal = local({
      actRecordId: null,
      baseSnapshot: null,
      actEditedAt: null,
    });
    const comparisonRows = compareContactSets([newLocal], []);
    const repository = new InMemoryApplyRepository(comparisonRows, [newLocal]);
    repository.rememberFailureOnce = new ActApiError(
      "rate_limited",
      true,
      null,
      "not_applied",
    );
    const client = new FakeApplyClient([]);
    const service = new ActSyncService(client, repository);
    const decision = {
      rowId: comparisonRows[0]!.rowId,
      decision: "push" as const,
    };

    await expect(service.apply("run-1", [decision])).rejects.toThrow();
    const retry = await service.apply("run-1", [decision]);

    expect(repository.operations.get(decision.rowId)).toMatchObject({
      status: "failed",
      retryable: false,
      error:
        "A previous Act! create may have completed. Create a new preview before trying again.",
    });
    expect(retry.rows[0]).toMatchObject({
      status: "failed",
      retryable: false,
    });
    expect(client.createCalls).toBe(1);
  });

  it("blocks an ambiguous interrupted Act create rather than duplicating it", async () => {
    const newLocal = local({
      actRecordId: null,
      baseSnapshot: null,
      actEditedAt: null,
    });
    const comparisonRows = compareContactSets([newLocal], []);
    const repository = new InMemoryApplyRepository(comparisonRows, [newLocal]);
    const operation = repository.operations.get(comparisonRows[0]!.rowId)!;
    repository.operations.set(comparisonRows[0]!.rowId, {
      ...operation,
      status: "applying",
      decision: "push",
      actRecordId: null,
      updatedAt: new Date(0),
    });
    const client = new FakeApplyClient([]);

    const result = await new ActSyncService(client, repository).apply(
      "run-1",
      [{ rowId: comparisonRows[0]!.rowId, decision: "push" }],
    );

    expect(result.rows[0]).toMatchObject({
      status: "failed",
      error:
        "A previous Act! create may have completed. Create a new preview before trying again.",
    });
    expect(client.createCalls).toBe(0);
  });

  it("keeps authoritative Act identity ahead of snapshot properties", async () => {
    const comparisonRows = compareContactSets([], [remote()]);
    comparisonRows[0] = {
      ...comparisonRows[0]!,
      actSnapshot: {
        ...comparisonRows[0]!.actSnapshot!,
        id: "spoofed-id",
        editedAt: "2099-01-01T00:00:00.000Z",
      } as never,
    };
    const repository = new InMemoryApplyRepository(comparisonRows, []);

    await new ActSyncService(
      new FakeApplyClient([remote()]),
      repository,
    ).apply("run-1", [
      { rowId: comparisonRows[0]!.rowId, decision: "pull" },
    ]);

    expect([...repository.localContacts.values()][0]).toMatchObject({
      actRecordId: "act-1",
      actEditedAt: "2026-07-26T12:00:00Z",
    });
  });
});
