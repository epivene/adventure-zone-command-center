import { describe, expect, it } from "vitest";

import {
  actExternalLinks,
  actContactSyncStates,
  auditEntries,
  contacts,
  organizationContacts,
  organizations,
} from "@/db/schema";
import {
  buildStoredSyncPreview,
  deriveSyncRunStatus,
  DrizzleSyncRepository,
  LocalContactChangedAfterPreviewError,
  operationClaimDisposition,
  parseStoredSyncRows,
  staleOperationRecovery,
} from "@/features/act-sync/sync-repository";
import type { RemoteActContact } from "@/features/act-sync/act-types";
import type { SyncComparisonRow } from "@/features/act-sync/sync-comparison";

const snapshot = {
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

const row = {
  rowId: "act:act-1",
  category: "new_in_act",
  matchReason: "none",
  localContactId: null,
  actRecordId: "act-1",
  candidateLocalContactIds: [],
  candidateActRecordIds: ["act-1"],
  baseSnapshot: null,
  localSnapshot: null,
  actSnapshot: snapshot,
  actEditedAt: "2026-07-27T12:00:00.000Z",
  allowedDecisions: ["pull", "skip"],
  messages: [],
} satisfies SyncComparisonRow;

const counts = {
  new_in_act: 1,
  new_in_app: 0,
  changed_in_act: 0,
  changed_in_app: 0,
  changed_in_both: 0,
  possible_match: 0,
  already_matched: 0,
  missing_from_act: 0,
  error: 0,
};

class RecordingPullDatabase {
  readonly organizationId = "11111111-1111-4111-8111-111111111111";
  readonly contactId = "22222222-2222-4222-8222-222222222222";
  readonly associations = new Map<string, Record<string, unknown>>();
  readonly events: string[] = [];
  readonly primaryOrganizationAssignments: Array<string | null> = [];
  syncBaseSnapshot: unknown = null;
  organizationName = "Marias Fair";
  organizationNameAfterLock: string | null = null;
  contact = {
    id: this.contactId,
    organizationId: null as string | null,
    firstName: snapshot.firstName,
    lastName: snapshot.lastName,
    jobTitle: snapshot.jobTitle,
    email: snapshot.email,
    phone: snapshot.phone,
    address1: snapshot.address1,
    address2: snapshot.address2,
    city: snapshot.city,
    region: snapshot.region,
    postalCode: snapshot.postalCode,
  };

  select() {
    return {
      from: (table: unknown) => {
        const records = () =>
          table === organizations
            ? [{ id: this.organizationId, name: this.organizationName }]
            : table === contacts
              ? [{ ...this.contact }]
              : [];
        const terminal = {
          where: () => terminal,
          orderBy: () => terminal,
          limit: () => terminal,
          for: async () => {
            this.events.push(
              `lock:${table === organizations ? "organization" : table === contacts ? "contact" : "external"}`,
            );
            if (
              table === organizations &&
              this.organizationNameAfterLock
            ) {
              this.organizationName = this.organizationNameAfterLock;
            }
            return records();
          },
          then: (
            resolve: (value: unknown[]) => unknown,
            reject?: (reason: unknown) => unknown,
          ) => {
            if (table === contacts) this.events.push("discover:contact");
            return Promise.resolve(records()).then(resolve, reject);
          },
        };
        return {
          where: () => terminal,
          orderBy: () => terminal,
        };
      },
    };
  }

  insert(table: unknown) {
    return {
      values: (values: Record<string, unknown>) => {
        if (table === organizationContacts) {
          const key = `${values.organizationId}:${values.contactId}`;
          return {
            onConflictDoUpdate: async (configuration: { set: Record<string, unknown> }) => {
              const existing = this.associations.get(key);
              this.associations.set(
                key,
                existing ? { ...existing, ...configuration.set } : { ...values },
              );
              this.events.push("upsert:relationship");
            },
          };
        }
        if (table === actContactSyncStates) {
          return {
            onConflictDoUpdate: async (configuration: {
              set: Record<string, unknown>;
            }) => {
              this.syncBaseSnapshot =
                configuration.set.baseSnapshot ?? values.baseSnapshot;
            },
          };
        }
        if (table === contacts) {
          this.contact = { ...this.contact, ...values };
          this.events.push("insert:contact");
        }
        return {
          onConflictDoNothing: () => ({
            returning: async () => [{ entityId: values.entityId }],
          }),
          onConflictDoUpdate: async () => undefined,
          returning: async () => [
            table === contacts ? { id: this.contactId } : { id: this.organizationId },
          ],
        };
      },
    };
  }

  update(table: unknown) {
    return {
      set: (values: Record<string, unknown>) => {
        if (table === contacts) {
          if (Object.hasOwn(values, "organizationId")) {
            const organizationId = values.organizationId as string | null;
            if (
              organizationId !== null &&
              !this.associations.has(`${organizationId}:${this.contactId}`)
            ) {
              throw new Error("primary pointer requires an association");
            }
            this.primaryOrganizationAssignments.push(organizationId);
            this.events.push("update:contact:pointer");
          }
          this.contact = { ...this.contact, ...values };
        }
        return { where: () => ({ returning: async () => [{ id: this.contactId }] }) };
      },
    };
  }

  transaction<T>(operation: (transaction: RecordingPullDatabase) => Promise<T>) {
    return operation(this);
  }
}

class RecordingSnapshotDatabase {
  readonly organizationId = "11111111-1111-4111-8111-111111111111";
  readonly changedOrganizationId =
    "33333333-3333-4333-8333-333333333333";
  readonly contactId = "22222222-2222-4222-8222-222222222222";
  readonly events: string[] = [];
  contact = {
    id: this.contactId,
    organizationId: this.organizationId,
    firstName: snapshot.firstName,
    lastName: snapshot.lastName,
    jobTitle: snapshot.jobTitle,
    email: snapshot.email,
    phone: snapshot.phone,
    address1: snapshot.address1,
    address2: snapshot.address2,
    city: snapshot.city,
    region: snapshot.region,
    postalCode: snapshot.postalCode,
  };
  changeAfterPlaceLock: Partial<typeof this.contact> | null = null;

  private records(table: unknown) {
    if (table === contacts) return [{ ...this.contact }];
    if (table === organizations) {
      return [{ id: this.organizationId, name: snapshot.organizationName }];
    }
    return [];
  }

  select() {
    return {
      from: (table: unknown) => ({
        where: () => {
          const terminal = {
            limit: () => terminal,
            for: async () => {
              if (table === organizations) {
                this.events.push("lock:organization");
                if (this.changeAfterPlaceLock) {
                  this.contact = {
                    ...this.contact,
                    ...this.changeAfterPlaceLock,
                  };
                }
              } else if (table === contacts) {
                this.events.push("lock:contact");
              }
              return this.records(table);
            },
            then: (
              resolve: (value: unknown[]) => unknown,
              reject?: (reason: unknown) => unknown,
            ) => {
              if (table === contacts) this.events.push("discover:contact");
              return Promise.resolve(this.records(table)).then(resolve, reject);
            },
          };
          return terminal;
        },
      }),
    };
  }

  insert(table: unknown) {
    return {
      values: () => {
        if (table === actExternalLinks) {
          return {
            onConflictDoNothing: () => ({
              returning: async () => [{ entityId: this.contactId }],
            }),
          };
        }
        if (table === actContactSyncStates) {
          return {
            onConflictDoUpdate: async () => undefined,
          };
        }
        if (table === auditEntries) return {};
        throw new Error("Unexpected insert in Act snapshot test.");
      },
    };
  }

  update(table: unknown) {
    return {
      set: (values: Record<string, unknown>) => {
        if (table === contacts) {
          this.contact = { ...this.contact, ...values };
        }
        return { where: async () => undefined };
      },
    };
  }

  transaction<T>(operation: (transaction: RecordingSnapshotDatabase) => Promise<T>) {
    return operation(this);
  }
}

const remote = {
  ...snapshot,
  id: "act-1",
  editedAt: "2026-07-27T12:00:00.000Z",
} satisfies RemoteActContact;

const existingRow = {
  ...row,
  category: "changed_in_app",
  matchReason: "act_record_id",
  localContactId: "22222222-2222-4222-8222-222222222222",
  baseSnapshot: snapshot,
  localSnapshot: snapshot,
} satisfies SyncComparisonRow;

describe("stored Act sync previews", () => {
  it("rejects malformed or identity-bearing stored snapshots", () => {
    expect(() =>
      parseStoredSyncRows([
        {
          ...row,
          actSnapshot: { ...snapshot, phone: 123 },
        },
      ]),
    ).toThrow("Stored Act! sync preview is malformed.");

    expect(() =>
      parseStoredSyncRows([
        {
          ...row,
          actSnapshot: {
            ...snapshot,
            id: "spoofed-act-id",
            editedAt: "2099-01-01T00:00:00.000Z",
          },
        },
      ]),
    ).toThrow("Stored Act! sync preview is malformed.");
  });

  it("hydrates durable operation state for every preview row", () => {
    const preview = buildStoredSyncPreview(
      {
        id: "run-1",
        status: "partial",
        summary: { counts, rows: [row] },
        activeQueueToken: null,
        startedAt: new Date("2026-07-27T12:00:00.000Z"),
        completedAt: null,
      },
      [
        {
          rowKey: "act:act-1",
          status: "failed",
          decision: "pull",
          localContactId: null,
          actRecordId: "act-1",
          error: "Try this contact again.",
          retryable: true,
          updatedAt: new Date("2026-07-27T12:05:00.000Z"),
        },
      ],
    );

    expect(preview.operations).toEqual([
      {
        rowId: "act:act-1",
        status: "failed",
        decision: "pull",
        localContactId: null,
        actRecordId: "act-1",
        error: "Try this contact again.",
        retryable: true,
        updatedAt: new Date("2026-07-27T12:05:00.000Z"),
      },
    ]);
  });

  it("rejects a preview whose durable operation rows do not match its rows", () => {
    expect(() =>
      buildStoredSyncPreview(
        {
          id: "run-1",
          status: "previewed",
          summary: { counts, rows: [row] },
          activeQueueToken: null,
          startedAt: new Date("2026-07-27T12:00:00.000Z"),
          completedAt: null,
        },
        [],
      ),
    ).toThrow("Stored Act! sync operations are malformed.");
  });
});

describe("DrizzleSyncRepository pull", () => {
  it("locks the target Place and creates the association before the pointer during an approved Act! Contact pull", async () => {
    const database = new RecordingPullDatabase();

    const contactId = await new DrizzleSyncRepository(database as never).pullContact(
      row,
      remote,
    );

    expect(contactId).toBe(database.contactId);
    expect(database.contact.organizationId).toBe(database.organizationId);
    expect(database.primaryOrganizationAssignments).toEqual([
      database.organizationId,
    ]);
    expect(database.events.filter((event) => event === "lock:organization" || event === "lock:contact")).toEqual([
      "lock:organization",
      "lock:contact",
    ]);
    expect(database.events.indexOf("upsert:relationship")).toBeLessThan(
      database.events.indexOf("update:contact:pointer"),
    );
    expect([...database.associations.values()]).toEqual([
      expect.objectContaining({
        organizationId: database.organizationId,
        contactId: database.contactId,
        active: true,
        source: "act_sync",
      }),
    ]);
  });

  it("clears a stale primary Place while retaining the historical association when Act has no company", async () => {
    const database = new RecordingPullDatabase();
    database.contact.organizationId = database.organizationId;
    database.associations.set(
      `${database.organizationId}:${database.contactId}`,
      {
        organizationId: database.organizationId,
        contactId: database.contactId,
        active: true,
        source: "local",
      },
    );
    const remoteWithoutOrganization = {
      ...remote,
      organizationName: null,
    } satisfies RemoteActContact;
    const existingRow = {
      ...row,
      category: "changed_in_act",
      matchReason: "act_record_id",
      localContactId: database.contactId,
      baseSnapshot: snapshot,
      localSnapshot: snapshot,
      actSnapshot: {
        ...snapshot,
        organizationName: null,
      },
    } satisfies SyncComparisonRow;

    await new DrizzleSyncRepository(database as never).pullContact(
      existingRow,
      remoteWithoutOrganization,
    );

    expect(database.primaryOrganizationAssignments).toEqual([null]);
    expect(database.contact.organizationId).toBeNull();
    expect(
      database.associations.get(
        `${database.organizationId}:${database.contactId}`,
      ),
    ).toEqual(
      expect.objectContaining({
        active: true,
        source: "local",
      }),
    );
    expect(database.syncBaseSnapshot).toEqual(
      expect.objectContaining({ organizationName: null }),
    );
  });

  it("locks and revalidates the current Place before Person during an existing-Contact pull", async () => {
    const database = new RecordingPullDatabase();
    database.contact.organizationId = database.organizationId;
    database.organizationNameAfterLock = "Renamed after preview";
    const existingRow = {
      ...row,
      category: "changed_in_act",
      matchReason: "act_record_id",
      localContactId: database.contactId,
      baseSnapshot: snapshot,
      localSnapshot: snapshot,
      actSnapshot: {
        ...snapshot,
        organizationName: null,
      },
    } satisfies SyncComparisonRow;

    await expect(
      new DrizzleSyncRepository(database as never).pullContact(
        existingRow,
        { ...remote, organizationName: null },
      ),
    ).rejects.toBeInstanceOf(LocalContactChangedAfterPreviewError);
    expect(
      database.events.filter(
        (event) =>
          event === "discover:contact" ||
          event === "lock:organization" ||
          event === "lock:contact",
      ),
    ).toEqual([
      "discover:contact",
      "lock:organization",
      "lock:contact",
    ]);
    expect(database.primaryOrganizationAssignments).toEqual([]);
  });
});

describe("DrizzleSyncRepository snapshot locking", () => {
  it("discovers the current Place, then locks Place before Person when checking a preview", async () => {
    const database = new RecordingSnapshotDatabase();

    await expect(
      new DrizzleSyncRepository(
        database as never,
      ).assertLocalContactUnchanged(existingRow),
    ).resolves.toBe(true);

    expect(database.events).toEqual([
      "discover:contact",
      "lock:organization",
      "lock:contact",
    ]);
  });

  it("keeps the canonical Place then Person locks while an Act push is in flight", async () => {
    const database = new RecordingSnapshotDatabase();
    let actionCalled = false;

    await expect(
      new DrizzleSyncRepository(database as never).withLockedLocalContact(
        existingRow,
        async () => {
          actionCalled = true;
          return "pushed";
        },
      ),
    ).resolves.toBe("pushed");

    expect(actionCalled).toBe(true);
    expect(database.events).toEqual([
      "discover:contact",
      "lock:organization",
      "lock:contact",
    ]);
  });

  it("locks Place before Person when completing a pushed snapshot", async () => {
    const database = new RecordingSnapshotDatabase();

    await new DrizzleSyncRepository(database as never).completePush(
      existingRow,
      remote,
    );

    expect(database.events).toEqual([
      "discover:contact",
      "lock:organization",
      "lock:contact",
    ]);
  });

  it("rejects a changed primary Place pointer after discovery", async () => {
    const database = new RecordingSnapshotDatabase();
    database.changeAfterPlaceLock = {
      organizationId: database.changedOrganizationId,
    };

    await expect(
      new DrizzleSyncRepository(
        database as never,
      ).assertLocalContactUnchanged(existingRow),
    ).resolves.toBe(false);
  });

  it("rejects a changed Contact snapshot after the Place lock and before the Person lock", async () => {
    const database = new RecordingSnapshotDatabase();
    database.changeAfterPlaceLock = { firstName: "Changed" };
    let actionCalled = false;

    await expect(
      new DrizzleSyncRepository(database as never).withLockedLocalContact(
        existingRow,
        async () => {
          actionCalled = true;
        },
      ),
    ).rejects.toBeInstanceOf(LocalContactChangedAfterPreviewError);
    expect(actionCalled).toBe(false);
  });
});

describe("Act sync operation lifecycle", () => {
  it("marks a category-only apply partial when untouched rows remain", () => {
    expect(
      deriveSyncRunStatus([
        { status: "completed" },
        { status: "pending" },
      ]),
    ).toBe("partial");
    expect(
      deriveSyncRunStatus([
        { status: "failed" },
        { status: "pending" },
      ]),
    ).toBe("partial");
  });

  it("keeps active runs applying and settles exhausted runs", () => {
    expect(
      deriveSyncRunStatus([
        { status: "completed" },
        { status: "applying" },
      ]),
    ).toBe("applying");
    expect(
      deriveSyncRunStatus([
        { status: "completed" },
        { status: "skipped" },
      ]),
    ).toBe("completed");
    expect(
      deriveSyncRunStatus([
        { status: "completed" },
        { status: "failed" },
      ]),
    ).toBe("failed");
    expect(
      deriveSyncRunStatus([
        { status: "approved" },
        { status: "pending" },
      ]),
    ).toBe("previewed");
  });

  it("recovers only stale applying work with a known safe identity", () => {
    const now = new Date("2026-07-27T13:10:00.000Z");

    expect(
      operationClaimDisposition(
        {
          status: "applying",
          decision: "pull",
          actRecordId: "act-1",
          retryable: true,
          updatedAt: new Date("2026-07-27T13:09:00.000Z"),
        },
        now,
      ),
    ).toBe("in_progress");
    expect(
      operationClaimDisposition(
        {
          status: "applying",
          decision: "pull",
          actRecordId: "act-1",
          retryable: true,
          updatedAt: new Date("2026-07-27T13:00:00.000Z"),
        },
        now,
      ),
    ).toBe("reclaim");
  });

  it("blocks an ambiguous stale remote create instead of creating a duplicate", () => {
    expect(
      operationClaimDisposition(
        {
          status: "applying",
          decision: "push",
          actRecordId: null,
          retryable: true,
          updatedAt: new Date("2026-07-27T13:00:00.000Z"),
        },
        new Date("2026-07-27T13:10:00.000Z"),
      ),
    ).toBe("manual_review");
  });

  it("reconciles stale leases into reload-safe operation states", () => {
    const now = new Date("2026-07-27T13:10:00.000Z");

    expect(
      staleOperationRecovery(
        {
          status: "applying",
          decision: "pull",
          actRecordId: "act-1",
          retryable: true,
          updatedAt: new Date("2026-07-27T13:00:00.000Z"),
        },
        now,
      ),
    ).toEqual({
      error: "A previous sync attempt was interrupted. Retry this contact.",
      retryable: true,
      status: "failed",
    });
    expect(
      staleOperationRecovery(
        {
          status: "applying",
          decision: "push",
          actRecordId: null,
          retryable: true,
          updatedAt: new Date("2026-07-27T13:00:00.000Z"),
        },
        now,
      ),
    ).toEqual({
      error:
        "A previous Act! create may have completed. Create a new preview before trying again.",
      retryable: false,
      status: "failed",
    });
    expect(
      staleOperationRecovery(
        {
          status: "applying",
          decision: "pull",
          actRecordId: "act-1",
          retryable: true,
          updatedAt: new Date("2026-07-27T13:09:00.000Z"),
        },
        now,
      ),
    ).toBeNull();
  });
});
