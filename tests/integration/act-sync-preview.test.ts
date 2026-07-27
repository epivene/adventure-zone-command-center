import { describe, expect, it } from "vitest";

import { ActApiError } from "@/features/act-sync/act-errors";
import type { RemoteActContact } from "@/features/act-sync/act-types";
import {
  ActSyncService,
  type ActSyncClient,
} from "@/features/act-sync/sync-service";
import type {
  StoredSyncPreview,
  SyncRepository,
} from "@/features/act-sync/sync-repository";
import type { LocalSyncContact } from "@/features/act-sync/sync-comparison";
import { canonicalContactSnapshot } from "@/features/act-sync/contact-snapshot";

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

class FakeActClient implements ActSyncClient {
  listCalls = 0;
  constructor(
    public remoteContacts: RemoteActContact[],
    public failure: Error | null = null,
  ) {}

  async listContacts() {
    this.listCalls += 1;
    if (this.failure) throw this.failure;
    return structuredClone(this.remoteContacts);
  }
}

class InMemorySyncRepository implements SyncRepository {
  previews = new Map<string, StoredSyncPreview>();
  createCalls = 0;
  contactMutationCount = 0;
  private nextRun = 1;

  constructor(public localContacts: LocalSyncContact[]) {}

  async listLocalContacts() {
    return structuredClone(this.localContacts);
  }

  async createPreview(
    rows: StoredSyncPreview["rows"],
    summary: StoredSyncPreview["summary"],
  ) {
    this.createCalls += 1;
    const preview: StoredSyncPreview = {
      id: `sync-${this.nextRun++}`,
      status: "previewed",
      rows: structuredClone(rows),
      summary: structuredClone(summary),
      startedAt: new Date("2026-07-27T12:00:00Z"),
      completedAt: null,
    };
    this.previews.set(preview.id, preview);
    return structuredClone(preview);
  }

  async getPreview(runId: string) {
    const preview = this.previews.get(runId);
    return preview ? structuredClone(preview) : null;
  }
}

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

describe("ActSyncService preview", () => {
  it("fetches Act only when explicitly creating a preview", async () => {
    const client = new FakeActClient([remote()]);
    const repository = new InMemorySyncRepository([local()]);
    const service = new ActSyncService(client, repository);

    expect(client.listCalls).toBe(0);
    const preview = await service.createPreview();

    expect(client.listCalls).toBe(1);
    expect(preview.summary.already_matched).toBe(1);
    expect(repository.contactMutationCount).toBe(0);
  });

  it("compares every accessible Act contact and stores category counts", async () => {
    const client = new FakeActClient([
      remote(),
      remote({
        id: "act-new",
        firstName: "New",
        lastName: "Person",
        email: "new@example.com",
      }),
    ]);
    const repository = new InMemorySyncRepository([local()]);
    const service = new ActSyncService(client, repository);

    const preview = await service.createPreview();

    expect(preview.rows).toHaveLength(2);
    expect(preview.summary).toMatchObject({
      already_matched: 1,
      new_in_act: 1,
    });
    expect(repository.createCalls).toBe(1);
  });

  it("reopens a stored preview without another Act request", async () => {
    const client = new FakeActClient([remote()]);
    const repository = new InMemorySyncRepository([local()]);
    const service = new ActSyncService(client, repository);
    const created = await service.createPreview();

    const reopened = await service.getPreview(created.id);

    expect(reopened).toEqual(created);
    expect(client.listCalls).toBe(1);
  });

  it("preserves a sanitized permission error and stores no partial preview", async () => {
    const client = new FakeActClient(
      [],
      new ActApiError("permission_denied", false),
    );
    const repository = new InMemorySyncRepository([local()]);
    const service = new ActSyncService(client, repository);

    await expect(service.createPreview()).rejects.toMatchObject({
      code: "permission_denied",
      message: "This Act! account does not currently have Web API permission.",
    });
    expect(repository.createCalls).toBe(0);
  });
});
