import { and, eq, sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { contacts, organizationContacts, organizations } from "@/db/schema";
import { ActivityService } from "@/features/activities/activity-service";
import { DrizzleActivityRepository } from "@/features/activities/activity-repository";
import { recordAuditEntry } from "@/features/audit/audit-service";
import { createContactPhoneRepository } from "@/features/contact-phones/contact-phone-repository";
import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";
import { DrizzleLocationRepository } from "@/features/organization-locations/location-repository";
import type { OfficeContactInput, OfficeLocationInput, OfficeProfileInput } from "./office-profile-input";

type DrizzleDatabase = typeof database;
export type OfficeActor = { accountId: string; displayName: string };

function actorSnapshot(actor: OfficeActor) {
  return { officeAccountId: actor.accountId, officeDisplayName: actor.displayName };
}

function profileSnapshot(row: any, description: string | null) {
  return {
    name: row.name,
    description,
    phone: row.phone,
    address1: row.address1,
    address2: row.address2,
    city: row.city,
    region: row.region,
    postalCode: row.postalCode,
    website: row.website,
  };
}

function contactSnapshot(row: any, relationshipRole: string | null, phones: any[]) {
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    jobTitle: row.jobTitle,
    relationshipRole,
    email: row.email,
    address1: row.address1,
    address2: row.address2,
    city: row.city,
    region: row.region,
    postalCode: row.postalCode,
    phones: phones.map((phone) => ({
      id: phone.id,
      number: phone.number,
      type: phone.type,
      extension: phone.extension,
      label: phone.label,
      primary: phone.primary,
    })),
  };
}

function locationSnapshot(location: any) {
  return {
    label: location.label,
    venueName: location.venueName,
    address1: location.address1,
    address2: location.address2,
    city: location.city,
    region: location.region,
    postalCode: location.postalCode,
    website: location.website,
    phone: location.phone,
    email: location.email,
  };
}

async function readDescription(transaction: any, profileId: string): Promise<string | null> {
  try {
    const result = await transaction.execute(sql`select description from organizations where id = ${profileId}::uuid limit 1`);
    return result.rows?.[0]?.description ?? null;
  } catch {
    return null;
  }
}

export class OfficeProfileEditor {
  constructor(private readonly database: DrizzleDatabase) {}

  async updateProfile(profileId: string, input: OfficeProfileInput, actor: OfficeActor): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [before] = await transaction.select({
        id: organizations.id,
        name: organizations.name,
        phone: organizations.phone,
        address1: organizations.address1,
        address2: organizations.address2,
        city: organizations.city,
        region: organizations.region,
        postalCode: organizations.postalCode,
        website: organizations.website,
      }).from(organizations).where(eq(organizations.id, profileId)).limit(1).for("update");
      if (!before) return false;
      const beforeDescription = await readDescription(transaction, profileId);

      const { description, ...normalFields } = input;
      const set: Record<string, unknown> = { ...normalFields, updatedAt: new Date() };
      if (Object.hasOwn(input, "phone")) {
        set.normalizedPhone = input.phone ? normalizeNorthAmericanPhone(input.phone) : null;
      }
      await transaction.update(organizations).set(set).where(eq(organizations.id, profileId));
      if (Object.hasOwn(input, "description")) {
        await transaction.execute(sql`update organizations set description = ${description ?? null}, updated_at = now() where id = ${profileId}::uuid`);
      }

      const [after] = await transaction.select({
        id: organizations.id,
        name: organizations.name,
        phone: organizations.phone,
        address1: organizations.address1,
        address2: organizations.address2,
        city: organizations.city,
        region: organizations.region,
        postalCode: organizations.postalCode,
        website: organizations.website,
      }).from(organizations).where(eq(organizations.id, profileId)).limit(1);
      const afterDescription = await readDescription(transaction, profileId);
      await recordAuditEntry(transaction, {
        entityType: "organization",
        entityId: profileId,
        action: "office_profile_updated",
        before: profileSnapshot(before, beforeDescription),
        after: { ...profileSnapshot(after ?? before, afterDescription), ...actorSnapshot(actor) },
      });
      return true;
    });
  }

  async updateContact(profileId: string, contactId: string, input: OfficeContactInput, actor: OfficeActor): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [relationship] = await transaction.select({
        id: organizationContacts.id,
        role: organizationContacts.role,
      }).from(organizationContacts).where(and(
        eq(organizationContacts.organizationId, profileId),
        eq(organizationContacts.contactId, contactId),
        eq(organizationContacts.active, true),
      )).limit(1).for("update");
      const [before] = await transaction.select().from(contacts).where(eq(contacts.id, contactId)).limit(1).for("update");
      if (!relationship || !before) return false;

      const phoneRepository = createContactPhoneRepository(transaction as unknown as DrizzleDatabase);
      const beforePhones = await phoneRepository.listForContact(contactId);
      const savedPhones = await phoneRepository.replaceForContact(contactId, input.phones, new Date());
      const primaryPhone = savedPhones.find((phone) => phone.primary) ?? null;
      const [after] = await transaction.update(contacts).set({
        firstName: input.firstName,
        lastName: input.lastName,
        jobTitle: input.jobTitle,
        email: input.email,
        phone: primaryPhone?.number ?? null,
        normalizedPhone: primaryPhone ? normalizeNorthAmericanPhone(primaryPhone.number) : null,
        address1: input.address1,
        address2: input.address2,
        city: input.city,
        region: input.region,
        postalCode: input.postalCode,
        updatedAt: new Date(),
      }).where(eq(contacts.id, contactId)).returning();
      await transaction.update(organizationContacts).set({ role: input.relationshipRole, updatedAt: new Date() }).where(eq(organizationContacts.id, relationship.id));

      await recordAuditEntry(transaction, {
        entityType: "contact",
        entityId: contactId,
        action: "office_contact_updated",
        before: contactSnapshot(before, relationship.role, beforePhones),
        after: { ...contactSnapshot(after ?? before, input.relationshipRole, savedPhones), ...actorSnapshot(actor), organizationId: profileId },
      });
      return true;
    });
  }

  async updateLocation(profileId: string, locationId: string, input: OfficeLocationInput, actor: OfficeActor): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const repository = new DrizzleLocationRepository(transaction as unknown as DrizzleDatabase);
      const before = await repository.findById(profileId, locationId);
      if (!before) return false;
      if (!(await repository.update(profileId, locationId, input, new Date()))) return false;
      const after = await repository.findById(profileId, locationId);
      await recordAuditEntry(transaction, {
        entityType: "organization_location",
        entityId: locationId,
        action: "office_location_updated",
        before: locationSnapshot(before),
        after: { ...locationSnapshot(after ?? before), ...actorSnapshot(actor), organizationId: profileId },
      });
      return true;
    });
  }

  async addNote(profileId: string, body: string, actor: OfficeActor) {
    const service = new ActivityService(new DrizzleActivityRepository(this.database));
    const result = await service.create({ organizationId: profileId, kind: "note", body, occurredAt: new Date() });
    if (!result.ok) return result;
    await recordAuditEntry(this.database, {
      entityType: "activity",
      entityId: result.value.id,
      action: "office_note_created",
      before: null,
      after: { organizationId: profileId, body, ...actorSnapshot(actor) },
    });
    return result;
  }
}
