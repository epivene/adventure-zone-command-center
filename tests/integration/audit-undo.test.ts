import { describe, expect, it } from "vitest";

import {
  auditEntries,
  bookingContacts,
  bookings,
  contacts,
  organizationContacts,
  organizations,
} from "@/db/schema";
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
import { setBookingPrimaryContact } from "@/features/bookings/booking-relationship-repository";

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
      lockContactTargetOrganization: async () => undefined,
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
  readonly events: string[] = [];
  readonly auditWrites: Record<string, unknown>[] = [];
  failAuditWrite = false;
  private auditReadCount = 0;
  contact = {
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
  readonly organization = {
    id: this.originalOrganizationId,
    name: "Marias Fair",
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
                : table === organizations
                  ? [this.organization]
                : [];
          const terminal = {
            limit: () => terminal,
            for: async () => {
              this.events.push(
                `lock:${table === organizations ? "organization" : table === contacts ? "contact" : "audit"}`,
              );
              return records;
            },
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
          this.events.push("upsert:relationship");
        }
        if (table === auditEntries) {
          if (this.failAuditWrite) throw new Error("Audit storage is unavailable.");
          this.auditWrites.push({ ...values });
          this.events.push("insert:undo-audit");
        }
        return { onConflictDoUpdate: async () => undefined };
      },
    };
  }

  update(table: unknown) {
    return {
      set: (values: Record<string, unknown>) => {
        if (table === contacts) {
          if (typeof values.organizationId === "string") {
            if (!this.associations.has(`${values.organizationId}:${this.contactId}`)) {
              throw new Error("primary pointer requires an association");
            }
            this.events.push("update:contact:pointer");
          } else {
            this.events.push("update:contact:fields");
          }
          Object.assign(this.contact, values);
        }
        return {
          where: () => ({ returning: async () => [{ ...this.contact }] }),
        };
      },
    };
  }

  transaction<T>(operation: (transaction: RecordingDrizzleUndoDatabase) => Promise<T>) {
    const contact = structuredClone(this.contact);
    const associations = structuredClone(this.associations);
    const auditWrites = structuredClone(this.auditWrites);
    this.events.push("transaction:begin");
    return operation(this).then(
      (result) => {
        this.events.push("transaction:commit");
        return result;
      },
      (error) => {
        this.contact = contact;
        this.associations.clear();
        associations.forEach((value, key) => this.associations.set(key, value));
        this.auditWrites.length = 0;
        this.auditWrites.push(...auditWrites);
        this.events.push("transaction:rollback");
        throw error;
      },
    );
  }
}

class RecordingBookingUndoDatabase {
  readonly bookingId = "55555555-5555-4555-8555-555555555555";
  readonly placeId: string | null;
  readonly restoredContactId = "66666666-6666-4666-8666-666666666666";
  readonly currentContactId = "77777777-7777-4777-8777-777777777777";
  readonly now = new Date("2026-07-29T12:00:00.000Z");
  readonly bookingPeople = new Map<string, Record<string, unknown>>();
  readonly events: string[] = [];
  readonly auditWrites: Record<string, unknown>[] = [];
  failAuditWrite = false;
  activeRestoredRelationship: boolean;
  private auditReadCount = 0;
  private lastEnsuredContactId: string | null = null;
  booking = {
    id: this.bookingId,
    organizationId: null as string | null,
    primaryContactId: this.currentContactId as string | null,
    name: "Neverwinter Adventure",
    venueName: null,
    address1: null,
    city: "Denver",
    region: "CO",
    postalCode: null,
    latitude: null,
    longitude: null,
    startsAt: null,
    endsAt: null,
    status: "new_lead",
    probability: "possible",
    travelLegId: null,
    actRecordId: null,
    notes: null,
    physicalAttractionTotal: null,
    attractionTotalApprovalReason: null,
    createdAt: this.now,
    updatedAt: this.now,
  };
  auditEntry: StoredAuditEntry;

  constructor(options: {
    placeId: string | null;
    activeRestoredRelationship?: boolean;
    statusOnly?: boolean;
  }) {
    this.placeId = options.placeId;
    this.activeRestoredRelationship =
      options.activeRestoredRelationship ?? Boolean(options.placeId);
    this.booking.organizationId = options.placeId;
    this.bookingPeople.set(this.currentContactId, {
      bookingId: this.bookingId,
      contactId: this.currentContactId,
      role: null,
      isPrimary: true,
      source: "local",
      createdAt: this.now,
      updatedAt: this.now,
    });
    this.auditEntry = {
      id: "audit-booking-1",
      entityType: "booking",
      entityId: this.bookingId,
      action: "update",
      before: options.statusOnly
        ? { status: "new_lead" }
        : { primaryContactId: this.restoredContactId },
      after: options.statusOnly
        ? { status: "unlikely" }
        : { primaryContactId: this.currentContactId },
      reversesEntryId: null,
      createdAt: this.now,
    };
    if (options.statusOnly) this.booking.status = "unlikely";
  }

  select() {
    return {
      from: (table: unknown) => {
        const query = {
          innerJoin: () => query,
          where: () => {
            const records =
              table === auditEntries
                ? this.auditReadCount++ === 0 ? [this.auditEntry] : []
                : table === bookings
                  ? [this.booking]
                  : table === organizationContacts &&
                      this.placeId &&
                      this.activeRestoredRelationship
                    ? [{
                        organizationId: this.placeId,
                        contactId: this.restoredContactId,
                        active: true,
                      }]
                    : table === bookingContacts
                      ? [...this.bookingPeople.values()]
                      : [];
            const terminal = {
              limit: () => terminal,
              for: async () => {
                this.events.push(
                  `lock:${table === bookings ? "booking" : table === auditEntries ? "audit" : "association"}`,
                );
                return records;
              },
              then: Promise.resolve(records).then.bind(Promise.resolve(records)),
            };
            return terminal;
          },
        };
        return query;
      },
    };
  }

  insert(table: unknown) {
    return {
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
        const records = Array.isArray(values) ? values : [values];
        if (table === bookingContacts) {
          for (const record of records) {
            const contactId = record.contactId as string;
            this.lastEnsuredContactId = contactId;
            this.bookingPeople.set(contactId, {
              ...this.bookingPeople.get(contactId),
              ...record,
            });
            this.events.push("upsert:booking-contact");
          }
        }
        if (table === auditEntries) {
          if (this.failAuditWrite) throw new Error("Audit storage is unavailable.");
          this.auditWrites.push({ ...records[0] });
          this.events.push("insert:undo-audit");
        }
        return {
          onConflictDoUpdate: async () => undefined,
          then: Promise.resolve().then.bind(Promise.resolve()),
        };
      },
    };
  }

  update(table: unknown) {
    return {
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (table === bookings) {
            if (typeof values.primaryContactId === "string") {
              if (!this.bookingPeople.has(values.primaryContactId)) {
                throw new Error("primary pointer requires a Booking Person");
              }
              this.events.push("update:booking:pointer");
            } else if ("primaryContactId" in values) {
              this.events.push("clear:booking:pointer");
            } else {
              this.events.push("update:booking:fields");
            }
            Object.assign(this.booking, values);
          }
          if (table === bookingContacts) {
            if (values.isPrimary === false) {
              this.bookingPeople.forEach((person) => {
                person.isPrimary = false;
                Object.assign(person, values);
              });
              this.events.push("clear:booking-contact:primary");
            } else if (values.isPrimary === true && this.lastEnsuredContactId) {
              Object.assign(
                this.bookingPeople.get(this.lastEnsuredContactId)!,
                values,
              );
              this.events.push("set:booking-contact:primary");
            }
          }
          const record = table === bookings
            ? { ...this.booking }
            : this.lastEnsuredContactId
              ? { ...this.bookingPeople.get(this.lastEnsuredContactId) }
              : {};
          const terminal = {
            returning: async () => [record],
            then: Promise.resolve([record]).then.bind(Promise.resolve([record])),
          };
          return terminal;
        },
      }),
    };
  }

  delete() {
    return { where: async () => undefined };
  }

  transaction<T>(operation: (transaction: RecordingBookingUndoDatabase) => Promise<T>) {
    const booking = structuredClone(this.booking);
    const bookingPeople = structuredClone(this.bookingPeople);
    const auditWrites = structuredClone(this.auditWrites);
    this.events.push("transaction:begin");
    return operation(this).then(
      (result) => {
        this.events.push("transaction:commit");
        return result;
      },
      (error) => {
        this.booking = booking;
        this.bookingPeople.clear();
        bookingPeople.forEach((value, key) => this.bookingPeople.set(key, value));
        this.auditWrites.length = 0;
        this.auditWrites.push(...auditWrites);
        this.events.push("transaction:rollback");
        throw error;
      },
    );
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
    expect(database.events.filter((event) => event === "lock:organization" || event === "lock:contact")).toEqual([
      "lock:organization",
      "lock:contact",
      "lock:contact",
    ]);
    expect(database.events.indexOf("upsert:relationship")).toBeLessThan(
      database.events.indexOf("update:contact:pointer"),
    );
    expect(database.events).toEqual(expect.arrayContaining([
      "transaction:begin",
      "insert:undo-audit",
      "transaction:commit",
    ]));
    expect(database.auditWrites).toEqual([
      expect.objectContaining({
        action: "undo",
        reversesEntryId: database.auditEntry.id,
      }),
    ]);
    expect([...database.associations.values()]).toEqual([
      expect.objectContaining({
        organizationId: database.originalOrganizationId,
        contactId: database.contactId,
        active: true,
        source: "undo",
      }),
    ]);
  });

  it("rolls back a Contact pointer restoration when its undo audit write fails", async () => {
    const database = new RecordingDrizzleUndoDatabase();
    database.failAuditWrite = true;

    await expect(
      new UndoService(new DrizzleUndoRepository(database as never)).undoAuditEntry(
        database.auditEntry.id,
      ),
    ).rejects.toThrow("Audit storage is unavailable.");

    expect(database.contact.organizationId).toBe(database.currentOrganizationId);
    expect(database.associations).toEqual(new Map());
    expect(database.auditWrites).toEqual([]);
    expect(database.events.at(-1)).toBe("transaction:rollback");
  });

  it("restores a Booking primary Person through an association-aware undo", async () => {
    const database = new RecordingBookingUndoDatabase({
      placeId: "88888888-8888-4888-8888-888888888888",
    });

    await expect(
      new UndoService(new DrizzleUndoRepository(database as never)).undoAuditEntry(
        database.auditEntry.id,
      ),
    ).resolves.toEqual({ ok: true, value: undefined });

    expect(database.booking.primaryContactId).toBe(database.restoredContactId);
    expect(database.bookingPeople.get(database.restoredContactId)).toMatchObject({
      contactId: database.restoredContactId,
      isPrimary: true,
      source: "undo",
    });
    expect(database.bookingPeople.get(database.currentContactId)).toMatchObject({
      isPrimary: false,
    });
    expect(database.events.indexOf("upsert:booking-contact")).toBeLessThan(
      database.events.indexOf("update:booking:pointer"),
    );
    expect(database.auditWrites).toEqual([
      expect.objectContaining({
        action: "undo",
        reversesEntryId: database.auditEntry.id,
      }),
    ]);
  });

  it("undoes a legacy Place-less Booking without inventing a Place", async () => {
    const database = new RecordingBookingUndoDatabase({ placeId: null });

    await expect(
      new UndoService(new DrizzleUndoRepository(database as never)).undoAuditEntry(
        database.auditEntry.id,
      ),
    ).resolves.toEqual({ ok: true, value: undefined });

    expect(database.booking.organizationId).toBeNull();
    expect(database.booking.primaryContactId).toBe(database.restoredContactId);
    expect(database.bookingPeople.get(database.restoredContactId)).toMatchObject({
      source: "undo",
      isPrimary: true,
    });
  });

  it("rolls back Booking undo when the restored Person is outside its Place", async () => {
    const database = new RecordingBookingUndoDatabase({
      placeId: "88888888-8888-4888-8888-888888888888",
      activeRestoredRelationship: false,
    });

    await expect(
      new UndoService(new DrizzleUndoRepository(database as never)).undoAuditEntry(
        database.auditEntry.id,
      ),
    ).rejects.toThrow("not actively associated");

    expect(database.booking.primaryContactId).toBe(database.currentContactId);
    expect(database.bookingPeople.has(database.restoredContactId)).toBe(false);
    expect(database.auditWrites).toEqual([]);
    expect(database.events.at(-1)).toBe("transaction:rollback");
  });

  it("leaves an untouched legacy Place-less Booking readable", async () => {
    const database = new RecordingBookingUndoDatabase({
      placeId: null,
      statusOnly: true,
    });

    await expect(
      new UndoService(new DrizzleUndoRepository(database as never)).undoAuditEntry(
        database.auditEntry.id,
      ),
    ).resolves.toEqual({ ok: true, value: undefined });

    expect(database.booking).toMatchObject({
      organizationId: null,
      status: "new_lead",
      primaryContactId: database.currentContactId,
    });
    expect(database.bookingPeople.get(database.currentContactId)).toMatchObject({
      isPrimary: true,
    });
  });

  it("does not grant local writers the legacy Place-less undo exception", async () => {
    const database = new RecordingBookingUndoDatabase({ placeId: null });

    await expect(setBookingPrimaryContact(database as never, {
      bookingId: database.bookingId,
      contactId: database.restoredContactId,
      source: "local",
      now: database.now,
    })).rejects.toThrow("has no Place");

    expect(database.booking.primaryContactId).toBe(database.currentContactId);
    expect(database.bookingPeople.has(database.restoredContactId)).toBe(false);
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
