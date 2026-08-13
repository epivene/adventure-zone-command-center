import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  actContactSyncStates,
  activities,
  auditEntries,
  bookingContacts,
  bookings,
  contacts,
  organizationContacts,
  organizations,
} from "@/db/schema";
import { recordAuditEntry } from "@/features/audit/audit-service";
import { createContactPhoneRepository } from "@/features/contact-phones/contact-phone-repository";
import type { ContactInput } from "@/features/contacts/contact-input";
import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";
import {
  setContactPrimaryOrganization,
} from "@/features/relationships/relationship-writer";
import type { RelationshipSource } from "@/features/relationships/relationship-types";
import {
  contactSyncStateValues,
  type ContactDetail,
  type ContactFields,
  type ContactListPage,
  type ContactListQuery,
  type ContactListRecord,
  type ContactSyncState,
  type PhoneMatch,
  type QuickCallerInput,
} from "@/features/contacts/contact-types";
import { requireOwner } from "@/lib/auth/require-owner";

type DrizzleDatabase = typeof database;
type OrganizationWriter = Pick<
  DrizzleDatabase,
  "execute" | "select" | "insert"
>;
export type ContactPatchWriter = Pick<
  DrizzleDatabase,
  "delete" | "insert" | "select" | "update"
>;

class ContactDisappearedDuringUpdateError extends Error {
  constructor() {
    super("Contact disappeared during update.");
    this.name = "ContactDisappearedDuringUpdateError";
  }
}

export function contactSyncState(value: string | null): ContactSyncState {
  return contactSyncStateValues.includes(value as ContactSyncState)
    ? (value as ContactSyncState)
    : "unlinked";
}

export function buildContactSearchCondition(search: string) {
  const trimmed = search.trim();
  if (!trimmed) return null;
  const pattern = `%${trimmed}%`;
  return (
    or(
      ilike(
        sql<string>`concat_ws(' ', ${contacts.firstName}, ${contacts.lastName})`,
        pattern,
      ),
      ilike(organizations.name, pattern),
      ilike(contacts.email, pattern),
      ilike(contacts.phone, pattern),
      ilike(contacts.city, pattern),
      ilike(contacts.region, pattern),
      ilike(contacts.postalCode, pattern),
    ) ?? null
  );
}

function syncStateCondition(state: ContactListQuery["state"]) {
  if (state === "all") return null;
  if (state === "unlinked") {
    return or(
      isNull(actContactSyncStates.state),
      eq(actContactSyncStates.state, "unlinked"),
    );
  }
  return eq(actContactSyncStates.state, state);
}

export function contactFields(
  contact: typeof contacts.$inferSelect,
  organizationName: string | null,
): ContactFields {
  return {
    firstName: contact.firstName,
    lastName: contact.lastName,
    organizationName,
    jobTitle: contact.jobTitle,
    email: contact.email,
    phone: contact.phone,
    address1: contact.address1,
    address2: contact.address2,
    city: contact.city,
    region: contact.region,
    postalCode: contact.postalCode,
  };
}

function listRecord(record: {
  contact: typeof contacts.$inferSelect;
  organizationName: string | null;
  organizationLastResort: boolean | null;
  organizationLastResortReason: string | null;
  syncState: string | null;
  lastSyncedAt: Date | null;
}): ContactListRecord {
  return {
    id: record.contact.id,
    ...contactFields(record.contact, record.organizationName),
    syncState: contactSyncState(record.syncState),
    updatedAt: record.contact.updatedAt,
    lastSyncedAt: record.lastSyncedAt,
    organizationLastResort: record.organizationLastResort ?? false,
    organizationLastResortReason: record.organizationLastResortReason,
  };
}

export function contactAuditSnapshot(
  contact: typeof contacts.$inferSelect,
  organizationName: string | null,
) {
  return contactFields(contact, organizationName);
}

export function normalizeUsPhone(phone: string | null) {
  return phone ? normalizeNorthAmericanPhone(phone) : null;
}

export function phoneMatch(
  normalizedPhone: string,
  records: ContactListRecord[],
): PhoneMatch {
  if (records.length === 1) return { kind: "one", contact: records[0]! };
  if (records.length > 1) return { kind: "many", contacts: records };
  return { kind: "none", normalizedPhone };
}

export async function patchContactInTransaction(
  writer: ContactPatchWriter,
  before: typeof contacts.$inferSelect,
  organizationName: string | null,
  updates: Record<string, unknown>,
  now: Date,
  source: RelationshipSource = "local",
) {
  const contactUpdates: Record<string, unknown> = { ...updates, updatedAt: now };
  if (Object.hasOwn(updates, "organizationId")) {
    delete contactUpdates.organizationId;
    await setContactPrimaryOrganization(writer, {
      contactId: before.id,
      organizationId:
        typeof updates.organizationId === "string"
          ? updates.organizationId
          : null,
      source,
      now,
    });
  }
  if (Object.hasOwn(updates, "phone")) {
    contactUpdates.normalizedPhone = normalizeUsPhone(
      typeof updates.phone === "string" ? updates.phone : null,
    );
  }
  const [updated] = await writer
    .update(contacts)
    .set(contactUpdates)
    .where(eq(contacts.id, before.id))
    .returning();
  if (!updated) throw new Error("Contact is missing.");

  await writer
    .insert(actContactSyncStates)
    .values({
      contactId: updated.id,
      localDirty: true,
      state: "waiting",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: actContactSyncStates.contactId,
      set: { localDirty: true, state: "waiting", updatedAt: now },
    });
  return { contact: updated, snapshot: contactFields(updated, organizationName) };
}

export class DrizzleContactRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async listContacts(query: ContactListQuery): Promise<ContactListPage> {
    const condition =
      and(
        buildContactSearchCondition(query.search) ?? undefined,
        syncStateCondition(query.state) ?? undefined,
      ) ?? undefined;
    const baseSelection = {
      contact: contacts,
      organizationName: organizations.name,
      organizationLastResort: organizations.lastResort,
      organizationLastResortReason: organizations.lastResortReason,
      syncState: actContactSyncStates.state,
      lastSyncedAt: actContactSyncStates.lastSyncedAt,
    };

    const [records, totals] = await Promise.all([
      this.database
        .select(baseSelection)
        .from(contacts)
        .leftJoin(
          organizations,
          eq(contacts.organizationId, organizations.id),
        )
        .leftJoin(
          actContactSyncStates,
          eq(contacts.id, actContactSyncStates.contactId),
        )
        .where(condition)
        .orderBy(
          asc(contacts.lastName),
          asc(contacts.firstName),
          asc(contacts.id),
        )
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.database
        .select({ value: count() })
        .from(contacts)
        .leftJoin(
          organizations,
          eq(contacts.organizationId, organizations.id),
        )
        .leftJoin(
          actContactSyncStates,
          eq(contacts.id, actContactSyncStates.contactId),
        )
        .where(condition),
    ]);

    const total = totals[0]?.value ?? 0;
    return {
      records: records.map(listRecord),
      total,
      page: query.page,
      pageSize: query.pageSize,
      pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async getContactDetail(contactId: string): Promise<ContactDetail | null> {
    const [record] = await this.database
      .select({
        contact: contacts,
        organizationName: organizations.name,
        organizationLastResort: organizations.lastResort,
        organizationLastResortReason: organizations.lastResortReason,
        syncState: actContactSyncStates.state,
        lastSyncedAt: actContactSyncStates.lastSyncedAt,
      })
      .from(contacts)
      .leftJoin(
        organizations,
        eq(contacts.organizationId, organizations.id),
      )
      .leftJoin(
        actContactSyncStates,
        eq(contacts.id, actContactSyncStates.contactId),
      )
      .where(eq(contacts.id, contactId))
      .limit(1);
    if (!record) return null;

    const [placeRows, relatedBookings, phones] = await Promise.all([
      this.database
        .select({
          relationship: organizationContacts,
          organization: organizations,
        })
        .from(organizationContacts)
        .innerJoin(
          organizations,
          eq(organizationContacts.organizationId, organizations.id),
        )
        .where(eq(organizationContacts.contactId, contactId))
        .orderBy(
          desc(sql`${organizationContacts.organizationId} = ${record.contact.organizationId}`),
          asc(organizationContacts.role),
          asc(organizations.name),
          asc(organizations.id),
        ),
      this.database
      .select({
        id: bookings.id,
        name: bookings.name,
        city: bookings.city,
        region: bookings.region,
        startsAt: bookings.startsAt,
        status: bookings.status,
      })
      .from(bookingContacts)
      .innerJoin(bookings, eq(bookingContacts.bookingId, bookings.id))
      .where(eq(bookingContacts.contactId, contactId))
      .orderBy(desc(bookings.startsAt), asc(bookings.name), asc(bookings.id)),
      createContactPhoneRepository(this.database).listForContact(contactId),
    ]);

    return {
      contact: {
        ...listRecord(record),
        actRecordId: record.contact.actRecordId,
        createdAt: record.contact.createdAt,
      },
      places: placeRows.map(({ relationship, organization }) => ({
        id: organization.id,
        name: organization.name,
        role: relationship.role,
        isPrimaryPerson: relationship.isPrimary,
        isPrimaryPlace:
          relationship.organizationId === record.contact.organizationId,
        active: relationship.active,
      })),
      relatedBookings,
      phones,
    };
  }

  async findContactsByPhone(phone: string): Promise<PhoneMatch> {
    const normalizedPhone = normalizeNorthAmericanPhone(phone);
    if (!normalizedPhone) return { kind: "none", normalizedPhone: "" };

    const records = await this.database
      .select({
        contact: contacts,
        organizationName: organizations.name,
        organizationLastResort: organizations.lastResort,
        organizationLastResortReason: organizations.lastResortReason,
        syncState: actContactSyncStates.state,
        lastSyncedAt: actContactSyncStates.lastSyncedAt,
      })
      .from(contacts)
      .leftJoin(organizations, eq(contacts.organizationId, organizations.id))
      .leftJoin(
        actContactSyncStates,
        eq(contacts.id, actContactSyncStates.contactId),
      )
      .where(eq(contacts.normalizedPhone, normalizedPhone))
      .orderBy(asc(contacts.lastName), asc(contacts.firstName), asc(contacts.id));

    return phoneMatch(normalizedPhone, records.map(listRecord));
  }

  async createContact(input: ContactInput, now = new Date()) {
    return this.database.transaction(async (transaction) => {
      const organizationId = await this.resolveOrganizationId(
        transaction,
        input.organizationName,
        now,
      );
      const [created] = await transaction
        .insert(contacts)
        .values({
          organizationId: null,
          firstName: input.firstName,
          lastName: input.lastName,
          jobTitle: input.jobTitle,
          email: input.email,
          phone: input.phone,
          normalizedPhone: normalizeUsPhone(input.phone),
          address1: input.address1,
          address2: input.address2,
          city: input.city,
          region: input.region,
          postalCode: input.postalCode,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) throw new Error("Could not create contact.");
      if (organizationId) {
        await setContactPrimaryOrganization(transaction, {
          organizationId,
          contactId: created.id,
          source: "local",
          now,
        });
      }

      await transaction.insert(actContactSyncStates).values({
        contactId: created.id,
        localDirty: true,
        state: "waiting",
        createdAt: now,
        updatedAt: now,
      });
      await recordAuditEntry(transaction, {
        entityType: "contact",
        entityId: created.id,
        action: "create",
        before: null,
        after: contactAuditSnapshot(created, input.organizationName),
      });
      return created.id;
    });
  }

  async createQuickCaller(input: QuickCallerInput, now = new Date()) {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`quick-caller:${input.requestKey}`}, 0))`,
      );
      const [replay] = await transaction
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.quickAddRequestKey, input.requestKey))
        .limit(1)
        .for("update");
      if (replay) {
        return { kind: "created" as const, contactId: replay.id };
      }

      const normalizedPhone = normalizeUsPhone(input.phone);
      if (normalizedPhone) {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`quick-caller-phone:${normalizedPhone}`}, 0))`,
        );
        const matches = await transaction
          .select({
            contact: contacts,
            organizationName: organizations.name,
            organizationLastResort: organizations.lastResort,
            organizationLastResortReason: organizations.lastResortReason,
            syncState: actContactSyncStates.state,
            lastSyncedAt: actContactSyncStates.lastSyncedAt,
          })
          .from(contacts)
          .leftJoin(
            organizations,
            eq(contacts.organizationId, organizations.id),
          )
          .leftJoin(
            actContactSyncStates,
            eq(contacts.id, actContactSyncStates.contactId),
          )
          .where(eq(contacts.normalizedPhone, normalizedPhone))
          .orderBy(
            asc(contacts.lastName),
            asc(contacts.firstName),
            asc(contacts.id),
          );
        if (matches.length) {
          return {
            kind: "match" as const,
            match: phoneMatch(normalizedPhone, matches.map(listRecord)),
          };
        }
      }

      const organizationId = await this.resolveOrganizationId(
        transaction,
        input.organizationName,
        now,
      );
      const [contact] = await transaction
        .insert(contacts)
        .values({
          organizationId: null,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          normalizedPhone,
          quickAddRequestKey: input.requestKey,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!contact) throw new Error("Could not create caller contact.");
      if (organizationId) {
        await setContactPrimaryOrganization(transaction, {
          organizationId,
          contactId: contact.id,
          source: "local",
          now,
        });
      }

      await transaction.insert(actContactSyncStates).values({
        contactId: contact.id,
        localDirty: true,
        state: "waiting",
        createdAt: now,
        updatedAt: now,
      });
      await recordAuditEntry(transaction, {
        entityType: "contact",
        entityId: contact.id,
        action: "create",
        before: null,
        after: contactAuditSnapshot(contact, input.organizationName),
      });

      const note = [
        `Reason for calling: ${input.reason}`,
        input.eventDate ? `Event date: ${input.eventDate}` : null,
        input.eventLocation ? `Event location: ${input.eventLocation}` : null,
      ].filter(Boolean).join("\n");
      const [activity] = await transaction
        .insert(activities)
        .values({
          organizationId,
          contactId: contact.id,
          kind: "note",
          body: note,
          occurredAt: now,
          timelineSortAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!activity) throw new Error("Could not create caller note.");
      await recordAuditEntry(transaction, {
        entityType: "activity",
        entityId: activity.id,
        action: "create",
        before: null,
        after: {
          organizationId: activity.organizationId,
          contactId: activity.contactId,
          bookingId: activity.bookingId,
          kind: activity.kind,
          body: activity.body,
          occurredAt: (activity.occurredAt ?? activity.timelineSortAt).toISOString(),
        },
      });

      return { kind: "created" as const, contactId: contact.id };
    });
  }

  async updateContact(
    contactId: string,
    input: ContactInput,
    now = new Date(),
  ) {
    try {
      return await this.database.transaction(async (transaction) => {
        const [candidate] = await transaction
          .select({ id: contacts.id })
          .from(contacts)
          .where(eq(contacts.id, contactId))
          .limit(1);
        if (!candidate) return false;

        const organizationId = await this.resolveOrganizationId(
          transaction,
          input.organizationName,
          now,
        );
        const [before] = await transaction
          .select({ contact: contacts, organizationName: organizations.name })
          .from(contacts)
          .leftJoin(
            organizations,
            eq(contacts.organizationId, organizations.id),
          )
          .where(eq(contacts.id, contactId))
          .limit(1)
          .for("update", { of: contacts });
        if (!before) throw new ContactDisappearedDuringUpdateError();
        const { snapshot } = await patchContactInTransaction(
          transaction,
          before.contact,
          input.organizationName,
          {
            organizationId,
            firstName: input.firstName,
            lastName: input.lastName,
            jobTitle: input.jobTitle,
            email: input.email,
            phone: input.phone,
            address1: input.address1,
            address2: input.address2,
            city: input.city,
            region: input.region,
            postalCode: input.postalCode,
          } as Partial<Omit<ContactFields, "organizationName">>,
          now,
        );
        await recordAuditEntry(transaction, {
          entityType: "contact",
          entityId: contactId,
          action: "update",
          before: contactAuditSnapshot(before.contact, before.organizationName),
          after: snapshot,
        });
        return true;
      });
    } catch (error) {
      if (error instanceof ContactDisappearedDuringUpdateError) return false;
      throw error;
    }
  }

  async listRecentAuditEntries(contactId: string) {
    return this.database
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.entityType, "contact"),
          eq(auditEntries.entityId, contactId),
        ),
      )
      .orderBy(desc(auditEntries.createdAt));
  }

  private async resolveOrganizationId(
    writer: OrganizationWriter,
    organizationName: string | null,
    now: Date,
  ) {
    if (!organizationName) return null;
    const normalizedName = organizationName
      .trim()
      .toLocaleLowerCase("en-US")
      .replace(/\s+/g, " ");
    await writer.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`organization:${normalizedName}`}, 0))`,
    );
    const [existing] = await writer
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        sql`lower(regexp_replace(trim(${organizations.name}), '\\s+', ' ', 'g')) = ${normalizedName}`,
      )
      .limit(1)
      .for("update");
    if (existing) return existing.id;

    const [created] = await writer
      .insert(organizations)
      .values({
        name: organizationName,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: organizations.id });
    if (!created) throw new Error("Could not create contact organization.");
    await recordAuditEntry(writer, {
      entityType: "organization",
      entityId: created.id,
      action: "create",
      before: null,
      after: {
        name: organizationName,
        actRecordId: null,
      },
    });
    return created.id;
  }
}

export async function findContactsByPhone(phone: string): Promise<PhoneMatch> {
  await requireOwner();
  const { db } = await import("@/db/client");
  return new DrizzleContactRepository(db).findContactsByPhone(phone);
}
