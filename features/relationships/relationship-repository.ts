import { and, asc, eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  contacts,
  organizationContacts,
  organizations,
} from "@/db/schema";
import { recordAuditEntry } from "@/features/audit/audit-service";
import {
  ensurePlacePersonRelationship,
  setContactPrimaryOrganization,
} from "@/features/relationships/relationship-writer";
import type {
  AssociatePersonWithPlaceInput,
  PlacePersonRelationship,
  RelationshipWriter,
  RelationshipWriteResult,
  SetPersonPrimaryPlaceInput,
  SetPlacePersonActiveInput,
  SetPlacePrimaryPersonInput,
} from "@/features/relationships/relationship-types";

export interface RelationshipRepository {
  associatePersonWithPlace(
    input: AssociatePersonWithPlaceInput,
    now: Date,
  ): Promise<RelationshipWriteResult>;
  setPersonPrimaryPlace(
    input: SetPersonPrimaryPlaceInput,
    now: Date,
  ): Promise<RelationshipWriteResult | { kind: "cleared" }>;
  setPlacePrimaryPerson(
    input: SetPlacePrimaryPersonInput,
    now: Date,
  ): Promise<RelationshipWriteResult>;
  setPlacePersonActive(
    input: SetPlacePersonActiveInput,
    now: Date,
  ): Promise<RelationshipWriteResult>;
  listPeopleForPlace(
    organizationId: string,
    includeInactive?: boolean,
  ): Promise<PlacePersonRelationship[]>;
  listPlacesForPerson(
    contactId: string,
    includeInactive?: boolean,
  ): Promise<PlacePersonRelationship[]>;
}

type DrizzleDatabase = typeof database;
type RelationshipRow = typeof organizationContacts.$inferSelect;

function relationship(record: RelationshipRow): PlacePersonRelationship {
  return {
    id: record.id,
    organizationId: record.organizationId,
    contactId: record.contactId,
    role: record.role,
    isPrimary: record.isPrimary,
    active: record.active,
    source: record.source,
  };
}

function relationshipSnapshot(record: RelationshipRow) {
  return relationship(record);
}

async function lockedRelationship(
  writer: Pick<RelationshipWriter, "select">,
  organizationId: string,
  contactId: string,
) {
  const [record] = await writer
    .select()
    .from(organizationContacts)
    .where(and(
      eq(organizationContacts.organizationId, organizationId),
      eq(organizationContacts.contactId, contactId),
    ))
    .limit(1)
    .for("update");
  return record;
}

export class DrizzleRelationshipRepository implements RelationshipRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async associatePersonWithPlace(
    input: AssociatePersonWithPlaceInput,
    now: Date,
  ): Promise<RelationshipWriteResult> {
    return this.database.transaction(async (transaction) => {
      const [place] = await transaction
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1)
        .for("update");
      if (!place) return { kind: "place_not_found" };

      const [person] = await transaction
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.id, input.contactId))
        .limit(1)
        .for("update");
      if (!person) return { kind: "person_not_found" };

      const before = await lockedRelationship(transaction, input.organizationId, input.contactId);
      await ensurePlacePersonRelationship(transaction, {
        organizationId: input.organizationId,
        contactId: input.contactId,
        source: "local",
        now,
      });
      const [updated] = await transaction
        .update(organizationContacts)
        .set({ role: input.role, source: "local", updatedAt: now })
        .where(and(
          eq(organizationContacts.organizationId, input.organizationId),
          eq(organizationContacts.contactId, input.contactId),
        ))
        .returning();
      if (!updated) throw new Error("Could not associate the Person with the Place.");

      await recordAuditEntry(transaction, {
        entityType: "organization_contact",
        entityId: updated.id,
        action: before ? "update" : "create",
        before: before ? relationshipSnapshot(before) : null,
        after: relationshipSnapshot(updated),
      });
      return { kind: "ok", relationship: relationship(updated) };
    });
  }

  async setPersonPrimaryPlace(
    input: SetPersonPrimaryPlaceInput,
    now: Date,
  ): Promise<RelationshipWriteResult | { kind: "cleared" }> {
    return this.database.transaction(async (transaction) => {
      if (input.organizationId) {
        const [place] = await transaction
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.id, input.organizationId))
          .limit(1)
          .for("update");
        if (!place) return { kind: "place_not_found" };
      }

      const [person] = await transaction
        .select({ id: contacts.id, organizationId: contacts.organizationId })
        .from(contacts)
        .where(eq(contacts.id, input.contactId))
        .limit(1)
        .for("update");
      if (!person) return { kind: "person_not_found" };

      const beforeRelationship = person.organizationId
        ? await lockedRelationship(transaction, person.organizationId, input.contactId)
        : undefined;
      await setContactPrimaryOrganization(transaction, {
        contactId: input.contactId,
        organizationId: input.organizationId,
        source: "local",
        now,
      });

      if (!input.organizationId) {
        await recordAuditEntry(transaction, {
          entityType: "organization_contact",
          entityId: beforeRelationship?.id ?? input.contactId,
          action: "primary_place_changed",
          before: { organizationId: person.organizationId },
          after: { organizationId: null },
        });
        return { kind: "cleared" };
      }

      const updated = await lockedRelationship(
        transaction,
        input.organizationId,
        input.contactId,
      );
      if (!updated) throw new Error("Could not set the Person primary Place.");
      await recordAuditEntry(transaction, {
        entityType: "organization_contact",
        entityId: updated.id,
        action: "primary_place_changed",
        before: { organizationId: person.organizationId },
        after: { organizationId: input.organizationId },
      });
      return { kind: "ok", relationship: relationship(updated) };
    });
  }

  async setPlacePrimaryPerson(
    input: SetPlacePrimaryPersonInput,
    now: Date,
  ): Promise<RelationshipWriteResult> {
    return this.database.transaction(async (transaction) => {
      const [place] = await transaction
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1)
        .for("update");
      if (!place) return { kind: "place_not_found" };

      const [person] = await transaction
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.id, input.contactId))
        .limit(1)
        .for("update");
      if (!person) return { kind: "person_not_found" };

      const target = await lockedRelationship(
        transaction,
        input.organizationId,
        input.contactId,
      );
      if (!target) return { kind: "relationship_not_found" };
      const [previous] = await transaction
        .select()
        .from(organizationContacts)
        .where(and(
          eq(organizationContacts.organizationId, input.organizationId),
          eq(organizationContacts.isPrimary, true),
        ))
        .limit(1)
        .for("update");

      await transaction
        .update(organizationContacts)
        .set({ isPrimary: false, source: "local", updatedAt: now })
        .where(and(
          eq(organizationContacts.organizationId, input.organizationId),
          eq(organizationContacts.isPrimary, true),
        ));
      const [updated] = await transaction
        .update(organizationContacts)
        .set({ active: true, isPrimary: true, source: "local", updatedAt: now })
        .where(eq(organizationContacts.id, target.id))
        .returning();
      if (!updated) throw new Error("Could not set the Place primary Person.");

      await recordAuditEntry(transaction, {
        entityType: "organization_contact",
        entityId: updated.id,
        action: "primary_person_changed",
        before: { contactId: previous?.contactId ?? null },
        after: { contactId: updated.contactId },
      });
      return { kind: "ok", relationship: relationship(updated) };
    });
  }

  async setPlacePersonActive(
    input: SetPlacePersonActiveInput,
    now: Date,
  ): Promise<RelationshipWriteResult> {
    return this.database.transaction(async (transaction) => {
      const [place] = await transaction
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1)
        .for("update");
      if (!place) return { kind: "place_not_found" };

      const [person] = await transaction
        .select({ id: contacts.id, organizationId: contacts.organizationId })
        .from(contacts)
        .where(eq(contacts.id, input.contactId))
        .limit(1)
        .for("update");
      if (!person) return { kind: "person_not_found" };

      const before = await lockedRelationship(
        transaction,
        input.organizationId,
        input.contactId,
      );
      if (!before) return { kind: "relationship_not_found" };
      if (!input.active && (before.isPrimary || person.organizationId === input.organizationId)) {
        return { kind: "primary_relationship_cannot_be_inactive" };
      }

      const [updated] = await transaction
        .update(organizationContacts)
        .set({ active: input.active, source: "local", updatedAt: now })
        .where(eq(organizationContacts.id, before.id))
        .returning();
      if (!updated) throw new Error("Could not update the Place Person relationship.");
      await recordAuditEntry(transaction, {
        entityType: "organization_contact",
        entityId: updated.id,
        action: "update",
        before: relationshipSnapshot(before),
        after: relationshipSnapshot(updated),
      });
      return { kind: "ok", relationship: relationship(updated) };
    });
  }

  async listPeopleForPlace(
    organizationId: string,
    includeInactive = false,
  ): Promise<PlacePersonRelationship[]> {
    const records = await this.database
      .select()
      .from(organizationContacts)
      .where(and(
        eq(organizationContacts.organizationId, organizationId),
        includeInactive ? undefined : eq(organizationContacts.active, true),
      ))
      .orderBy(asc(organizationContacts.contactId), asc(organizationContacts.id));
    return records.map(relationship);
  }

  async listPlacesForPerson(
    contactId: string,
    includeInactive = false,
  ): Promise<PlacePersonRelationship[]> {
    const records = await this.database
      .select()
      .from(organizationContacts)
      .where(and(
        eq(organizationContacts.contactId, contactId),
        includeInactive ? undefined : eq(organizationContacts.active, true),
      ))
      .orderBy(asc(organizationContacts.organizationId), asc(organizationContacts.id));
    return records.map(relationship);
  }
}
