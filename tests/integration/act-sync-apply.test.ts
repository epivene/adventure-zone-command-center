import { describe, expect, it } from "vitest";

import type {
  ActContactInput,
  RemoteActContact,
} from "@/features/act-sync/act-types";
import { canonicalContactSnapshot } from "@/features/act-sync/contact-snapshot";
import {
  ActSyncService,
  type ActSyncApplyClient,
} from "@/features/act-sync/sync-service";
import type {
  ApplyOperation,
  ApplyOperationResult,
  StoredSyncPreview,
  SyncApplyRepository,
  SyncSummary,
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

  constructor(public contacts: RemoteActContact[]) {}

  async listContacts() {
    this.listCalls += 1;
    return structuredClone(this.contacts);
  }

  async getContact(contactId: string) {
    this.getCalls += 1;
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
    return structuredClone(created);
  }

  async updateContact(contactId: string, input: ActContactInput) {
    this.updateCalls += 1;
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
  private nextLocal = 10;

  constructor(rows: SyncComparisonRow[], locals: LocalSyncContact[]) {
    const preview: StoredSyncPreview = {
      id: "run-1",
      status: "previewed",
      rows: structuredClone(rows),
      summary: summary(rows),
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
        actRecordId: row.actRecordId,
        error: null,
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

  async claimOperation(
    runId: string,
    rowId: string,
    decision: SyncDecision,
  ) {
    const operation = this.operations.get(rowId);
    if (!operation || operation.runId !== runId) return "missing" as const;
    if (operation.status === "completed" || operation.status === "skipped") {
      return "finished" as const;
    }
    if (operation.status === "applying") return "in_progress" as const;
    this.operations.set(rowId, {
      ...operation,
      status: "applying",
      decision,
      error: null,
    });
    return "claimed" as const;
  }

  async getOperation(runId: string, rowId: string) {
    const operation = this.operations.get(rowId);
    return operation?.runId === runId ? structuredClone(operation) : null;
  }

  async rememberCreatedActId(runId: string, rowId: string, actRecordId: string) {
    const operation = await this.getOperation(runId, rowId);
    if (!operation) throw new Error("Operation missing.");
    this.operations.set(rowId, { ...operation, actRecordId });
  }

  async pullContact(row: SyncComparisonRow, value: RemoteActContact) {
    const localContactId = row.localContactId ?? `local-${this.nextLocal++}`;
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
    const operation = await this.getOperation(runId, rowId);
    if (!operation) throw new Error("Operation missing.");
    this.operations.set(rowId, {
      ...operation,
      status: result.status,
      error: result.error,
    });
  }

  async finishRun(runId: string) {
    const preview = this.previews.get(runId);
    if (!preview) throw new Error("Preview missing.");
    const runOperations = [...this.operations.values()].filter(
      (operation) => operation.runId === runId,
    );
    if (
      runOperations.every(
        (operation) =>
          operation.status === "completed" ||
          operation.status === "skipped" ||
          operation.status === "failed",
      )
    ) {
      this.previews.set(runId, {
        ...preview,
        status: runOperations.some((operation) => operation.status === "failed")
          ? "failed"
          : "completed",
        completedAt: new Date("2026-07-27T13:00:00Z"),
      });
    }
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
});
