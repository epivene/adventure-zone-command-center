import { reconcileCapacityFacts } from "@/features/outreach-planner/outreach-commitments";
import { and, asc, eq, inArray, or } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  actExternalLinks,
  actMigrationApplyBatches,
  actMigrationApplyOperations,
  actMigrationRecords,
  bookingContacts,
  bookings,
  contacts,
  organizationContacts,
  organizations,
} from "@/db/schema";
import type { MigrationApplyOperation } from "@/features/act-migration/apply-repository";
import { recordAuditEntry } from "@/features/audit/audit-service";

type DrizzleDatabase = typeof database;
type Transaction = Parameters<Parameters<DrizzleDatabase["transaction"]>[0]>[0];
type Values = Record<string, unknown>;

export type MigrationRelationshipApplyResult = { entityId: string; changed: boolean; wasCreated: boolean };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function date(value: unknown): Date | null {
  const candidate = text(value);
  if (!candidate) return null;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function targetId(operation: MigrationApplyOperation) {
  const proposal = operation.proposal;
  if (proposal.decision === "link_existing") {
    if (!proposal.chosenLocalEntityId) throw new Error("Act migration link-existing decision has no local entity.");
    return proposal.chosenLocalEntityId;
  }
  if (proposal.state === "change" || proposal.state === "matched_unchanged") {
    if (!proposal.proposedLocalId) throw new Error("Act migration change has no proposed local entity.");
    return proposal.proposedLocalId;
  }
  return null;
}

function changedFields<T extends Record<string, unknown>>(current: T, next: Partial<T>) {
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => current[key] !== value)) as Partial<T>;
}

export class MigrationRelationshipApplyRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  applyOrganizationContact(operation: MigrationApplyOperation): Promise<MigrationRelationshipApplyResult> {
    if (operation.targetEntityType !== "organization_contact") throw new Error("Expected an Organization-Contact apply operation.");
    return reconcileCapacityFacts(this.database, "act-history-import",(transaction) => this.applyOrganizationContactIn(transaction, operation));
  }

  applyBooking(operation: MigrationApplyOperation): Promise<MigrationRelationshipApplyResult> {
    if (operation.targetEntityType !== "booking") throw new Error("Expected a Booking apply operation.");
    return reconcileCapacityFacts(this.database, "act-history-import",(transaction) => this.applyBookingIn(transaction, operation));
  }

  applyBookingContact(operation: MigrationApplyOperation): Promise<MigrationRelationshipApplyResult> {
    if (operation.targetEntityType !== "booking_contact") throw new Error("Expected a Booking-Contact apply operation.");
    return reconcileCapacityFacts(this.database, "act-history-import",(transaction) => this.applyBookingContactIn(transaction, operation));
  }

  private async lockOperation(transaction: Transaction, operation: MigrationApplyOperation) {
    const records = await transaction.select().from(actMigrationRecords).where(and(
      eq(actMigrationRecords.runId, operation.runId),
      inArray(actMigrationRecords.sourceKey, [...operation.proposal.sourceRecordKeys]),
    )).orderBy(asc(actMigrationRecords.sourceKey)).for("update");
    if (records.length !== operation.proposal.sourceRecordKeys.length ||
      new Set(records.map(({ sourceKey }) => sourceKey)).size !== operation.proposal.sourceRecordKeys.length) {
      throw new Error("Act migration staged source records are incomplete.");
    }
    return records;
  }

  private async dependencyIds(transaction: Transaction, operation: MigrationApplyOperation) {
    if (operation.dependencyProposalKeys.length === 0) return new Map<string, { targetEntityType: string; entityId: string }>();
    const rows = await transaction.select().from(actMigrationApplyOperations).where(and(
      eq(actMigrationApplyOperations.runId, operation.runId),
      inArray(actMigrationApplyOperations.proposalKey, [...operation.dependencyProposalKeys]),
    )).orderBy(asc(actMigrationApplyOperations.proposalKey)).for("update");
    const values = new Map<string, { targetEntityType: string; entityId: string }>(operation.resolvedDependencies.map((dependency) => [
      dependency.proposalKey,
      { targetEntityType: dependency.targetEntityType, entityId: dependency.entityId },
    ] as const));
    for (const row of rows) {
      if (row.status === "applied" && row.appliedEntityId) {
        values.set(row.proposalKey, {
          targetEntityType: row.targetEntityType,
          entityId: row.appliedEntityId,
        });
      }
    }
    if (values.size !== operation.dependencyProposalKeys.length) {
      throw new Error("Act migration dependency is not applied.");
    }
    return values;
  }

  private dependency(dependencies: Map<string, { targetEntityType: string; entityId: string }>, targetEntityType: string) {
    const match = [...dependencies.values()].find((value) => value.targetEntityType === targetEntityType);
    if (!match) throw new Error(`Act migration dependency is missing ${targetEntityType}.`);
    return match.entityId;
  }

  private async actor(transaction: Transaction, operation: MigrationApplyOperation) {
    const [batch] = await transaction.select({ requestedBy: actMigrationApplyBatches.requestedBy })
      .from(actMigrationApplyBatches).where(eq(actMigrationApplyBatches.id, operation.batchId)).limit(1).for("key share");
    return batch?.requestedBy ?? "act-migration";
  }

  private isPrimary(operation: MigrationApplyOperation) {
    return operation.proposal.displaySnapshot.isPrimary === true;
  }

  private relationshipRole(operation: MigrationApplyOperation) {
    return text(operation.proposal.displaySnapshot.role);
  }

  private async applyOrganizationContactIn(transaction: Transaction, operation: MigrationApplyOperation): Promise<MigrationRelationshipApplyResult> {
    await this.lockOperation(transaction, operation);
    const dependencies = await this.dependencyIds(transaction, operation);
    const organizationId = this.dependency(dependencies, "organization");
    const contactId = this.dependency(dependencies, "contact");
    const [organization] = await transaction.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.id, organizationId)).limit(1).for("update");
    const [contact] = await transaction.select({ id: contacts.id, organizationId: contacts.organizationId }).from(contacts)
      .where(eq(contacts.id, contactId)).limit(1).for("update");
    if (!organization || !contact) throw new Error("Act migration dependency entity is missing.");

    const [before] = await transaction.select().from(organizationContacts).where(and(
      eq(organizationContacts.organizationId, organizationId),
      eq(organizationContacts.contactId, contactId),
    )).limit(1).for("update");
    const isPrimary = this.isPrimary(operation);
    const role = this.relationshipRole(operation);
    let relationship: typeof organizationContacts.$inferSelect;
    let changed = false;
    if (!before) {
      relationship = (await transaction.insert(organizationContacts).values({ organizationId, contactId, role, active: true, isPrimary: false, source: "act_migration" }).returning())[0]!;
      changed = true;
    } else {
      const updates = changedFields(before, { role, active: true, source: "act_migration" });
      relationship = Object.keys(updates).length
        ? (await transaction.update(organizationContacts).set({ ...updates, updatedAt: new Date() }).where(eq(organizationContacts.id, before.id)).returning())[0]!
        : before;
      changed ||= Object.keys(updates).length > 0;
    }
    if (isPrimary) {
      const currentPrimaries = await transaction.select().from(organizationContacts).where(and(
        eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.isPrimary, true),
      )).orderBy(asc(organizationContacts.id)).for("update");
      const previous = currentPrimaries.find((value) => value.id !== relationship.id);
      if (previous) {
        await transaction.update(organizationContacts).set({ isPrimary: false, source: "act_migration", updatedAt: new Date() }).where(eq(organizationContacts.id, previous.id));
        changed = true;
      }
      if (!relationship.isPrimary) {
        relationship = (await transaction.update(organizationContacts).set({ isPrimary: true, active: true, source: "act_migration", updatedAt: new Date() }).where(eq(organizationContacts.id, relationship.id)).returning())[0]!;
        changed = true;
      }
      if (contact.organizationId !== organizationId) {
        await transaction.update(contacts).set({ organizationId, updatedAt: new Date() }).where(eq(contacts.id, contactId));
        changed = true;
      }
    }
    if (changed) await recordAuditEntry(transaction, {
      entityType: "organization_contact", entityId: relationship.id, action: before ? "act_migration_reactivated" : "act_migration_created",
      before: before ? { active: before.active, isPrimary: before.isPrimary, role: before.role } : null,
      after: { organizationId, contactId, active: relationship.active, isPrimary: relationship.isPrimary, role: relationship.role, actor: await this.actor(transaction, operation) },
    });
    return { entityId: relationship.id, changed, wasCreated: !before };
  }

  private async applyBookingIn(transaction: Transaction, operation: MigrationApplyOperation): Promise<MigrationRelationshipApplyResult> {
    const records = await this.lockOperation(transaction, operation);
    const dependencies = await this.dependencyIds(transaction, operation);
    const organizationId = this.dependency(dependencies, "organization");
    const [organization] = await transaction.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1).for("update");
    if (!organization) throw new Error("Act migration dependency entity is missing.");
    const opportunity = records.find((record) => record.streamType === "opportunity" && record.sourceId !== null);
    if (!opportunity) throw new Error("Act migration Booking has no staged Opportunity record.");
    const source = opportunity.normalizedSnapshot as Values;
    const name = text(source.displayName);
    if (!name) throw new Error("Act migration Booking has no Opportunity name.");
    const sourceId = opportunity.sourceId!;
    const [link] = await transaction.select().from(actExternalLinks).where(and(
      eq(actExternalLinks.sourceEntityType, "opportunity"), eq(actExternalLinks.actRecordId, sourceId),
    )).limit(1).for("update");
    const chosenId = targetId(operation);
    if (link && link.entityType !== "booking") throw new Error("Act migration Opportunity is linked to a different entity type.");
    if (link && chosenId && link.entityId !== chosenId) throw new Error("Act migration Opportunity is linked to another Booking.");
    const bookingId = link?.entityId ?? chosenId;
    const mapped = { name, startsAt: date(source.estimatedCloseDate), endsAt: date(source.actualCloseDate) };
    let booking: typeof bookings.$inferSelect;
    let changed = false;
    let before: typeof bookings.$inferSelect | null = null;
    if (bookingId) {
      const [current] = await transaction.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1).for("update");
      if (!current) throw new Error("Act migration Booking target is missing.");
      before = current;
      const updates = changedFields(current, { ...mapped, organizationId });
      booking = Object.keys(updates).length
        ? (await transaction.update(bookings).set({ ...updates, updatedAt: new Date() }).where(eq(bookings.id, current.id)).returning())[0]!
        : current;
      changed = Object.keys(updates).length > 0;
    } else {
      booking = (await transaction.insert(bookings).values({
        organizationId, primaryContactId: null, ...mapped,
        city: organization.city ?? "Unknown", region: organization.region ?? "Unknown",
        status: "new_lead", probability: "possible",
      }).returning())[0]!;
      changed = true;
    }
    if (!link) {
      await transaction.insert(actExternalLinks).values({ entityType: "booking", sourceEntityType: "opportunity", entityId: booking.id, actRecordId: sourceId, isPrimary: false, syncMode: "pull_only", migrationRunId: operation.runId });
      changed = true;
    } else if (link.migrationRunId !== operation.runId) {
      await transaction.update(actExternalLinks).set({ migrationRunId: operation.runId, updatedAt: new Date() }).where(eq(actExternalLinks.id, link.id));
      changed = true;
    }
    if (booking.actRecordId !== sourceId) {
      booking = (await transaction.update(bookings).set({ actRecordId: sourceId, updatedAt: new Date() }).where(eq(bookings.id, booking.id)).returning())[0]!;
      changed = true;
    }
    if (changed) await recordAuditEntry(transaction, {
      entityType: "booking", entityId: booking.id, action: before ? "act_migration_updated" : "act_migration_created",
      before: before ? { organizationId: before.organizationId, name: before.name, startsAt: before.startsAt, endsAt: before.endsAt } : null,
      after: { organizationId, name: booking.name, startsAt: booking.startsAt, endsAt: booking.endsAt, actor: await this.actor(transaction, operation) },
    });
    return { entityId: booking.id, changed, wasCreated: before === null };
  }

  private async applyBookingContactIn(transaction: Transaction, operation: MigrationApplyOperation): Promise<MigrationRelationshipApplyResult> {
    await this.lockOperation(transaction, operation);
    const dependencies = await this.dependencyIds(transaction, operation);
    const bookingId = this.dependency(dependencies, "booking");
    const contactId = this.dependency(dependencies, "contact");
    const [booking] = await transaction.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1).for("update");
    const [contact] = await transaction.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId)).limit(1).for("update");
    if (!booking || !contact) throw new Error("Act migration dependency entity is missing.");
    const [before] = await transaction.select().from(bookingContacts).where(and(
      eq(bookingContacts.bookingId, bookingId), eq(bookingContacts.contactId, contactId),
    )).limit(1).for("update");
    const role = this.relationshipRole(operation);
    let relationship: typeof bookingContacts.$inferSelect;
    let changed = false;
    if (!before) {
      relationship = (await transaction.insert(bookingContacts).values({ bookingId, contactId, role, isPrimary: false, source: "act_migration" }).returning())[0]!;
      changed = true;
    } else {
      const updates = changedFields(before, { role, source: "act_migration" });
      relationship = Object.keys(updates).length
        ? (await transaction.update(bookingContacts).set({ ...updates, updatedAt: new Date() }).where(eq(bookingContacts.id, before.id)).returning())[0]!
        : before;
      changed ||= Object.keys(updates).length > 0;
    }
    if (this.isPrimary(operation)) {
      const primaries = await transaction.select().from(bookingContacts).where(and(
        eq(bookingContacts.bookingId, bookingId), eq(bookingContacts.isPrimary, true),
      )).orderBy(asc(bookingContacts.id)).for("update");
      const previous = primaries.find((value) => value.id !== relationship.id);
      if (previous) {
        await transaction.update(bookingContacts).set({ isPrimary: false, source: "act_migration", updatedAt: new Date() }).where(eq(bookingContacts.id, previous.id));
        changed = true;
      }
      if (!relationship.isPrimary) {
        relationship = (await transaction.update(bookingContacts).set({ isPrimary: true, source: "act_migration", updatedAt: new Date() }).where(eq(bookingContacts.id, relationship.id)).returning())[0]!;
        changed = true;
      }
      if (booking.primaryContactId !== contactId) {
        await transaction.update(bookings).set({ primaryContactId: contactId, updatedAt: new Date() }).where(eq(bookings.id, bookingId));
        changed = true;
      }
    }
    if (changed) await recordAuditEntry(transaction, {
      entityType: "booking_contact", entityId: relationship.id, action: before ? "act_migration_updated" : "act_migration_created",
      before: before ? { isPrimary: before.isPrimary, role: before.role } : null,
      after: { bookingId, contactId, isPrimary: relationship.isPrimary, role: relationship.role, actor: await this.actor(transaction, operation) },
    });
    return { entityId: relationship.id, changed, wasCreated: !before };
  }
}
