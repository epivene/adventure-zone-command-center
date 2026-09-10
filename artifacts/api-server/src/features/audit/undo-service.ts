import { allocationEnabled } from "@/features/outreach-planner/outreach-allocation";
import { commitmentTransaction, reconcileCapacityFacts } from "@/features/outreach-planner/outreach-commitments";
import { eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  auditEntries,
  bookings,
  contacts,
  followUps,
  organizations,
  travelLegs,
} from "@/db/schema";
import {
  recordAuditEntry,
  reversibleEntityTypes,
  type AuditChange,
  type ReversibleEntityType,
  type StoredAuditEntry,
} from "@/features/audit/audit-service";
import {
  lockBookingRelationshipParents,
  setBookingPrimaryContactAfterParentLocks,
  type LockedBookingRelationshipParents,
} from "@/features/bookings/booking-relationship-repository";
import {
  patchContactInTransaction,
  type ContactPatchWriter,
} from "@/features/contacts/contact-repository";
import { err, ok, type Result } from "@/lib/result";

export type UndoError =
  | { code: "ENTRY_NOT_FOUND" }
  | { code: "ALREADY_UNDONE" }
  | { code: "NON_REVERSIBLE" }
  | { code: "ENTITY_NOT_FOUND" }
  | { code: "CONFLICT" };

export interface UndoTransaction {
  findAuditEntryForUpdate(entryId: string): Promise<StoredAuditEntry | null>;
  findUndoFor(entryId: string): Promise<StoredAuditEntry | null>;
  lockContactTargetOrganization(organizationId: string): Promise<void>;
  prepareBookingRestore?(
    bookingId: string,
    fields: Record<string, unknown>,
  ): Promise<void>;
  findEntityForUpdate(
    entityType: ReversibleEntityType,
    entityId: string,
  ): Promise<Record<string, unknown> | null>;
  updateEntity(
    entityType: ReversibleEntityType,
    entityId: string,
    fields: Record<string, unknown>,
  ): Promise<boolean>;
  createAuditEntry(change: AuditChange): Promise<void>;
}

export interface UndoRepository {
  transaction<T>(
    operation: (transaction: UndoTransaction) => Promise<T>,
    entryId?: string,
  ): Promise<T>;
}

const reversibleFields: Record<ReversibleEntityType, ReadonlySet<string>> = {
  booking: new Set([
    "organizationId",
    "primaryContactId",
    "name",
    "venueName",
    "address1",
    "city",
    "region",
    "postalCode",
    "latitude",
    "longitude",
    "startsAt",
    "endsAt",
    "status",
    "probability",
    "travelLegId",
    "actRecordId",
    "notes",
  ]),
  contact: new Set([
    "organizationId",
    "firstName",
    "lastName",
    "email",
    "phone",
    "actRecordId",
  ]),
  organization: new Set(["name", "actRecordId"]),
  follow_up: new Set([
    "kind",
    "dueAt",
    "completedAt",
    "outcome",
    "nextFollowUpId",
  ]),
  travel_leg: new Set(["name", "color", "sortOrder"]),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReversibleEntityType(value: string): value is ReversibleEntityType {
  return (reversibleEntityTypes as readonly string[]).includes(value);
}

function reversibleSnapshots(
  entry: StoredAuditEntry,
): {
  entityType: ReversibleEntityType;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
} | null {
  if (
    entry.action === "undo" ||
    entry.action.startsWith("act_import_") ||
    !isReversibleEntityType(entry.entityType) ||
    !isRecord(entry.before) ||
    !isRecord(entry.after)
  ) {
    return null;
  }
  const entityType = entry.entityType;

  const beforeKeys = Object.keys(entry.before).sort();
  const afterKeys = Object.keys(entry.after).sort();
  if (
    beforeKeys.length === 0 ||
    beforeKeys.length !== afterKeys.length ||
    beforeKeys.some((field, index) => field !== afterKeys[index]) ||
    beforeKeys.some((field) => !reversibleFields[entityType].has(field))
  ) {
    return null;
  }

  return {
    entityType,
    before: entry.before,
    after: entry.after,
  };
}

function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(comparable);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, comparable(nested)]),
    );
  }
  return value;
}

function fieldsMatch(
  entity: Record<string, unknown>,
  expected: Record<string, unknown>,
) {
  return Object.entries(expected).every(
    ([field, expectedValue]) =>
      JSON.stringify(comparable(entity[field])) ===
      JSON.stringify(comparable(expectedValue)),
  );
}

export class UndoService {
  constructor(private readonly repository: UndoRepository) {}

  undoAuditEntry(entryId: string): Promise<Result<void, UndoError>> {
    return this.repository.transaction(async (transaction) => {
      const entry = await transaction.findAuditEntryForUpdate(entryId);
      if (!entry) return err({ code: "ENTRY_NOT_FOUND" });

      if (await transaction.findUndoFor(entryId)) {
        return err({ code: "ALREADY_UNDONE" });
      }

      const snapshots = reversibleSnapshots(entry);
      if (!snapshots) return err({ code: "NON_REVERSIBLE" });

      if (
        snapshots.entityType === "contact" &&
        typeof snapshots.before.organizationId === "string"
      ) {
        await transaction.lockContactTargetOrganization(
          snapshots.before.organizationId,
        );
      }
      if (
        snapshots.entityType === "booking" &&
        transaction.prepareBookingRestore
      ) {
        await transaction.prepareBookingRestore(
          entry.entityId,
          snapshots.before,
        );
      }

      const current = await transaction.findEntityForUpdate(
        snapshots.entityType,
        entry.entityId,
      );
      if (!current) return err({ code: "ENTITY_NOT_FOUND" });
      if (!fieldsMatch(current, snapshots.after)) {
        return err({ code: "CONFLICT" });
      }

      const restored = await transaction.updateEntity(
        snapshots.entityType,
        entry.entityId,
        snapshots.before,
      );
      if (!restored) return err({ code: "ENTITY_NOT_FOUND" });

      await transaction.createAuditEntry({
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: "undo",
        before: snapshots.after,
        after: snapshots.before,
        reversesEntryId: entry.id,
      });

      return ok(undefined);
    }, entryId);
  }
}

type DrizzleDatabase = typeof database;
type DrizzleUndoWriter = Pick<
  DrizzleDatabase,
  "delete" | "select" | "insert" | "update"
>;

function storedAuditEntry(
  entry: typeof auditEntries.$inferSelect,
): StoredAuditEntry {
  return {
    ...entry,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reversesEntryId: entry.reversesEntryId ?? null,
  };
}

function dateValue(value: unknown) {
  return typeof value === "string" ? new Date(value) : value;
}

function databaseFields(
  entityType: ReversibleEntityType,
  fields: Record<string, unknown>,
) {
  const values = { ...fields };
  if (entityType === "booking") {
    if ("startsAt" in values && values.startsAt !== null) {
      values.startsAt = dateValue(values.startsAt);
    }
    if ("endsAt" in values && values.endsAt !== null) {
      values.endsAt = dateValue(values.endsAt);
    }
  }
  if (entityType === "follow_up") {
    if ("dueAt" in values && values.dueAt !== null) {
      values.dueAt = dateValue(values.dueAt);
    }
    if ("completedAt" in values && values.completedAt !== null) {
      values.completedAt = dateValue(values.completedAt);
    }
  }
  return values;
}

class DrizzleUndoTransaction implements UndoTransaction {
  private readonly lockedEntities = new Map<
    string,
    Record<string, unknown>
  >();
  private readonly preparedBookingRelationships = new Map<
    string,
    LockedBookingRelationshipParents
  >();

  constructor(private readonly database: DrizzleUndoWriter) {}

  async findAuditEntryForUpdate(entryId: string) {
    const [entry] = await this.database
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.id, entryId))
      .limit(1)
      .for("update");
    return entry ? storedAuditEntry(entry) : null;
  }

  async findUndoFor(entryId: string) {
    const [entry] = await this.database
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.reversesEntryId, entryId))
      .limit(1);
    return entry ? storedAuditEntry(entry) : null;
  }

  async lockContactTargetOrganization(organizationId: string) {
    const [organization] = await this.database
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1)
      .for("update");
    if (!organization) {
      throw new Error("Cannot restore a Contact primary Place that is missing.");
    }
  }

  async prepareBookingRestore(
    bookingId: string,
    fields: Record<string, unknown>,
  ) {
    const locked = await lockBookingRelationshipParents(this.database, {
      bookingId,
      additionalOrganizationIds:
        typeof fields.organizationId === "string"
          ? [fields.organizationId]
          : [],
      additionalContactIds:
        typeof fields.primaryContactId === "string"
          ? [fields.primaryContactId]
          : [],
      includeExistingPeople: true,
    });
    this.preparedBookingRelationships.set(bookingId, locked);
  }

  async findEntityForUpdate(
    entityType: ReversibleEntityType,
    entityId: string,
  ): Promise<Record<string, unknown> | null> {
    switch (entityType) {
      case "booking": {
        const prepared = this.preparedBookingRelationships.get(entityId);
        if (prepared) {
          if (prepared.booking) {
            this.lockedEntities.set(
              `${entityType}:${entityId}`,
              prepared.booking,
            );
          }
          return prepared.booking;
        }
        const [record] = await this.database
          .select()
          .from(bookings)
          .where(eq(bookings.id, entityId))
          .limit(1)
          .for("update");
        if (record) this.lockedEntities.set(`${entityType}:${entityId}`, record);
        return record ?? null;
      }
      case "contact": {
        const [record] = await this.database
          .select()
          .from(contacts)
          .where(eq(contacts.id, entityId))
          .limit(1)
          .for("update");
        if (record) this.lockedEntities.set(`${entityType}:${entityId}`, record);
        return record ?? null;
      }
      case "organization": {
        const [record] = await this.database
          .select()
          .from(organizations)
          .where(eq(organizations.id, entityId))
          .limit(1)
          .for("update");
        if (record) this.lockedEntities.set(`${entityType}:${entityId}`, record);
        return record ?? null;
      }
      case "follow_up": {
        const [record] = await this.database
          .select()
          .from(followUps)
          .where(eq(followUps.id, entityId))
          .limit(1)
          .for("update");
        if (record) this.lockedEntities.set(`${entityType}:${entityId}`, record);
        return record ?? null;
      }
      case "travel_leg": {
        const [record] = await this.database
          .select()
          .from(travelLegs)
          .where(eq(travelLegs.id, entityId))
          .limit(1)
          .for("update");
        if (record) this.lockedEntities.set(`${entityType}:${entityId}`, record);
        return record ?? null;
      }
    }
  }

  async updateEntity(
    entityType: ReversibleEntityType,
    entityId: string,
    fields: Record<string, unknown>,
  ) {
    const values = { ...databaseFields(entityType, fields), updatedAt: new Date() };
    switch (entityType) {
      case "booking": {
        if ("primaryContactId" in values) {
          const before = this.lockedEntities.get(
            `${entityType}:${entityId}`,
          ) as typeof bookings.$inferSelect | undefined;
          if (!before) return false;
          const restoredPrimaryContactId =
            typeof values.primaryContactId === "string"
              ? values.primaryContactId
              : null;
          const bookingValues = { ...values };
          delete bookingValues.primaryContactId;
          const [record] = await this.database
            .update(bookings)
            .set({
              ...bookingValues,
              primaryContactId: null,
              updatedAt: values.updatedAt,
            })
            .where(eq(bookings.id, entityId))
            .returning({ id: bookings.id });
          if (!record) return false;

          await setBookingPrimaryContactAfterParentLocks(
            this.database,
            {
              ...before,
              ...bookingValues,
              primaryContactId: null,
              updatedAt: values.updatedAt as Date,
            },
            {
              bookingId: entityId,
              contactId: restoredPrimaryContactId,
              source: "undo",
              now: values.updatedAt as Date,
            },
          );
          return true;
        }

        const [record] = await this.database
          .update(bookings)
          .set(values)
          .where(eq(bookings.id, entityId))
          .returning({ id: bookings.id });
        return Boolean(record);
      }
      case "contact": {
        const before = this.lockedEntities.get(
          `${entityType}:${entityId}`,
        ) as typeof contacts.$inferSelect | undefined;
        if (!before) return false;
        await patchContactInTransaction(
          this.database as ContactPatchWriter,
          before,
          null,
          databaseFields(entityType, fields),
          values.updatedAt as Date,
          "undo",
        );
        return true;
      }
      case "organization": {
        const [record] = await this.database
          .update(organizations)
          .set(values)
          .where(eq(organizations.id, entityId))
          .returning({ id: organizations.id });
        return Boolean(record);
      }
      case "follow_up": {
        const [record] = await this.database
          .update(followUps)
          .set(values)
          .where(eq(followUps.id, entityId))
          .returning({ id: followUps.id });
        return Boolean(record);
      }
      case "travel_leg": {
        const [record] = await this.database
          .update(travelLegs)
          .set(values)
          .where(eq(travelLegs.id, entityId))
          .returning({ id: travelLegs.id });
        return Boolean(record);
      }
    }
  }

  createAuditEntry(change: AuditChange) {
    return recordAuditEntry(this.database, change);
  }
}

export class DrizzleUndoRepository implements UndoRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async transaction<T>(
    operation: (transaction: UndoTransaction) => Promise<T>,
    entryId?: string,
  ): Promise<T> {
    const entry=allocationEnabled() && entryId ? (await this.database.select().from(auditEntries).where(eq(auditEntries.id,entryId)).limit(1))[0] : null;
    return commitmentTransaction(this.database, (transaction) =>
      operation(new DrizzleUndoTransaction(transaction)),
      {source:"audit-undo",bookingIds:entry?.entityType==="booking"?[entry.entityId]:[]},
    );
  }
}

export async function undoAuditEntry(
  entryId: string,
): Promise<Result<void, UndoError>> {
  const { db } = await import("@/db/client");
  return new UndoService(new DrizzleUndoRepository(db)).undoAuditEntry(entryId);
}
