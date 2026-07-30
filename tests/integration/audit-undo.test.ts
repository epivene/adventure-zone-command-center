import { describe, expect, it } from "vitest";

import { auditEntries, contacts, organizationContacts } from "@/db/schema";
import type {
  AuditChange,
  StoredAuditEntry,
} from "@/features/audit/audit-service";
import {
  UndoService,
  DrizzleUndoRepository,
  type UndoRepository,
  type UndoTransaction,
} from "@/features/audit/undo-service";

type Entity = Record<string, unknown> & { id: string };

const originalBooking: Entity = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Neverwinter Adventure",
  status: "possible",
};

function cloneEntry(entry: StoredAuditEntry): StoredAuditEntry {
  return structuredClone(entry);
}

class InMemoryUndoRepository implements UndoRepository {
  readonly entities = new Map<string, Entity>();
  readonly auditEntries: StoredAuditEntry[] = [];
  failNextAuditWrite = false;
  private nextAuditId = 1;

  constructor() {
    this.entities.set(`booking:${originalBooking.id}`, structuredClone(originalBooking));
  }

  recordChange(change: AuditChange) {
    const entry: StoredAuditEntry = {
      ...structuredClone(change),
      id: `audit-${this.nextAuditId++}`,
      reversesEntryId: null,
      createdAt: new Date("2026-07-25T12:00:00.000Z"),
    };
    this.auditEntries.push(entry);
    return cloneEntry(entry);
  }

  async transaction<T>(
    operation: (transaction: UndoTransaction) => Promise<T>,
  ): Promise<T> {
    const entities = structuredClone(this.entities);
    const auditEntries = this.auditEntries.map(cloneEntry);
    let nextAuditId = this.nextAuditId;
    const failNextAuditWrite = this.failNextAuditWrite;

    const transaction: UndoTransaction = {
      findAuditEntryForUpdate: async (entryId) => {
        const entry = auditEntries.find(({ id }) => id === entryId);
        return entry ? cloneEntry(entry) : null;
      },
      findUndoFor: async (entryId) => {
        const entry = auditEntries.find(
          ({ reversesEntryId }) => reversesEntryId === entryId,
        );
        return entry ? cloneEntry(entry) : null;
      },
      findEntityForUpdate: async (entityType, entityId) => {
        const entity = entities.get(`${entityType}:${entityId}`);
        return entity ? structuredClone(entity) : null;
      },
      updateEntity: async (entityType, entityId, fields) => {
        const key = `${entityType}:${entityId}`;
        const entity = entities.get(key);
        if (!entity) return false;
        entities.set(key, { ...entity, ...structuredClone(fields) });
        return true;
      },
      createAuditEntry: async (change) => {
        if (failNextAuditWrite) {
          throw new Error("Audit storage is unavailable.");
        }
        auditEntries.push({
          ...structuredClone(change),
          id: `audit-${nextAuditId++}`,
          reversesEntryId: change.reversesEntryId ?? null,
          createdAt: new Date("2026-07-25T12:01:00.000Z"),
        });
      },
    };

    const result = await operation(transaction);
    this.entities.clear();
    entities.forEach((entity, key) => this.entities.set(key, entity));
    this.auditEntries.length = 0;
    this.auditEntries.push(...auditEntries);
    this.nextAuditId = nextAuditId;
    return result;
  }
}

function updateBookingStatus(
  repository: InMemoryUndoRepository,
  status: string,
) {
  const booking = repository.entities.get(`booking:${originalBooking.id}`)!;
  repository.entities.set(`booking:${originalBooking.id}`, {
    ...booking,
    status,
  });
  return repository.recordChange({
    entityType: "booking",
    entityId: originalBooking.id,
    action: "update",
    before: { status: booking.status },
    after: { status },
  });
}

class RecordingDrizzleUndoDatabase {
  readonly contactId = "22222222-2222-4222-8222-222222222222";
  readonly originalOrganizationId = "11111111-1111-4111-8111-111111111111";
  readonly currentOrganizationId = "33333333-3333-4333-8333-333333333333";
  readonly now = new Date("2026-07-28T15:00:00.000Z");
  readonly associations = new Map<string, Record<string, unknown>>();
  private auditReadCount = 0;
  readonly contact = {
    id: this.contactId,
    organizationId: this.currentOrganizationId,
    firstName: "Avery",
    lastName: "Example",
    email: null,
    phone: null,
    normalizedPhone: null,
    quickAddRequestKey: null,
    jobTitle: null,
    address1: null,
    address2: null,
    city: null,
    region: null,
    postalCode: null,
    actRecordId: null,
    createdAt: this.now,
    updatedAt: this.now,
  };
  readonly auditEntry = {
    id: "audit-1",
    entityType: "contact",
    entityId: this.contactId,
    action: "update",
    before: { organizationId: this.originalOrganizationId },
    after: { organizationId: this.currentOrganizationId },
    reversesEntryId: null,
    createdAt: this.now,
  };

  select() {
    return {
      from: (table: unknown) => ({
        where: () => {
          const records =
            table === auditEntries
              ? this.auditReadCount++ === 0 ? [this.auditEntry] : []
              : table === contacts
                ? [this.contact]
                : [];
          const terminal = {
            limit: () => terminal,
            for: async () => records,
            then: Promise.resolve(records).then.bind(Promise.resolve(records)),
          };
          return terminal;
        },
      }),
    };
  }

  insert(table: unknown) {
    return {
      values: (values: Record<string, unknown>) => {
        if (table === organizationContacts) {
          this.associations.set(
            `${values.organizationId}:${values.contactId}`,
            { ...values },
          );
        }
        return { onConflictDoUpdate: async () => undefined };
      },
    };
  }

  update(table: unknown) {
    return {
      set: (values: Record<string, unknown>) => {
        if (table === contacts) Object.assign(this.contact, values);
        return {
          where: () => ({ returning: async () => [{ ...this.contact }] }),
        };
      },
    };
  }

  transaction<T>(operation: (transaction: RecordingDrizzleUndoDatabase) => Promise<T>) {
    return operation(this);
  }
}

describe("UndoService", () => {
  it("restores a Contact primary Place through an association-aware undo", async () => {
    const database = new RecordingDrizzleUndoDatabase();

    await expect(
      new UndoService(new DrizzleUndoRepository(database as never)).undoAuditEntry(
        database.auditEntry.id,
      ),
    ).resolves.toEqual({ ok: true, value: undefined });

    expect(database.contact.organizationId).toBe(database.originalOrganizationId);
    expect([...database.associations.values()]).toEqual([
      expect.objectContaining({
        organizationId: database.originalOrganizationId,
        contactId: database.contactId,
        active: true,
        source: "undo",
      }),
    ]);
  });

  it("restores the prior booking status and creates a linked audit entry", async () => {
    const repository = new InMemoryUndoRepository();
    const change = updateBookingStatus(repository, "unlikely");

    const result = await new UndoService(repository).undoAuditEntry(change.id);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(repository.entities.get(`booking:${originalBooking.id}`)).toMatchObject({
      status: "possible",
    });
    expect(
      repository.auditEntries.map(({ action, reversesEntryId }) => ({
        action,
        reversesEntryId,
      })),
    ).toEqual([
      { action: "update", reversesEntryId: null },
      { action: "undo", reversesEntryId: change.id },
    ]);
    expect(repository.auditEntries.at(-1)).toMatchObject({
      entityType: "booking",
      entityId: originalBooking.id,
      before: { status: "unlikely" },
      after: { status: "possible" },
    });
  });

  it("returns an explicit error instead of applying an undo twice", async () => {
    const repository = new InMemoryUndoRepository();
    const change = updateBookingStatus(repository, "unlikely");
    const service = new UndoService(repository);

    expect(await service.undoAuditEntry(change.id)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await service.undoAuditEntry(change.id)).toEqual({
      ok: false,
      error: { code: "ALREADY_UNDONE" },
    });
    expect(repository.auditEntries.map(({ action }) => action)).toEqual([
      "update",
      "undo",
    ]);
  });

  it("rejects a non-reversible import audit entry", async () => {
    const repository = new InMemoryUndoRepository();
    const importEntry = repository.recordChange({
      entityType: "contact",
      entityId: "22222222-2222-4222-8222-222222222222",
      action: "act_import_updated",
      before: { phone: "old phone" },
      after: { phone: "new phone" },
    });

    expect(await new UndoService(repository).undoAuditEntry(importEntry.id)).toEqual({
      ok: false,
      error: { code: "NON_REVERSIBLE" },
    });
    expect(repository.auditEntries).toHaveLength(1);
  });

  it("reports a conflict when audited fields changed after the source action", async () => {
    const repository = new InMemoryUndoRepository();
    const change = updateBookingStatus(repository, "unlikely");
    repository.entities.set(`booking:${originalBooking.id}`, {
      ...originalBooking,
      status: "confirmed",
    });

    expect(await new UndoService(repository).undoAuditEntry(change.id)).toEqual({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(repository.entities.get(`booking:${originalBooking.id}`)).toMatchObject({
      status: "confirmed",
    });
    expect(repository.auditEntries).toHaveLength(1);
  });

  it("rolls back the restored entity when writing the undo audit entry fails", async () => {
    const repository = new InMemoryUndoRepository();
    const change = updateBookingStatus(repository, "unlikely");
    repository.failNextAuditWrite = true;

    await expect(
      new UndoService(repository).undoAuditEntry(change.id),
    ).rejects.toThrow("Audit storage is unavailable.");
    expect(repository.entities.get(`booking:${originalBooking.id}`)).toMatchObject({
      status: "unlikely",
    });
    expect(repository.auditEntries).toHaveLength(1);
  });
});
