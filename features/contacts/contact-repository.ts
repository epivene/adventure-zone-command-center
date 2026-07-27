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
  auditEntries,
  bookings,
  contacts,
  organizations,
} from "@/db/schema";
import { recordAuditEntry } from "@/features/audit/audit-service";
import type { ContactInput } from "@/features/contacts/contact-input";
import {
  contactSyncStateValues,
  type ContactDetail,
  type ContactFields,
  type ContactListPage,
  type ContactListQuery,
  type ContactListRecord,
  type ContactSyncState,
} from "@/features/contacts/contact-types";

type DrizzleDatabase = typeof database;
type OrganizationWriter = Pick<DrizzleDatabase, "select" | "insert">;

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

function contactFields(
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
  syncState: string | null;
  lastSyncedAt: Date | null;
}): ContactListRecord {
  return {
    id: record.contact.id,
    ...contactFields(record.contact, record.organizationName),
    syncState: contactSyncState(record.syncState),
    updatedAt: record.contact.updatedAt,
    lastSyncedAt: record.lastSyncedAt,
  };
}

function auditSnapshot(
  contact: typeof contacts.$inferSelect,
  organizationName: string | null,
) {
  return contactFields(contact, organizationName);
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

    const relatedBookings = await this.database
      .select({
        id: bookings.id,
        name: bookings.name,
        city: bookings.city,
        region: bookings.region,
        startsAt: bookings.startsAt,
        status: bookings.status,
      })
      .from(bookings)
      .where(eq(bookings.primaryContactId, contactId))
      .orderBy(desc(bookings.startsAt), asc(bookings.name));

    return {
      contact: {
        ...listRecord(record),
        actRecordId: record.contact.actRecordId,
        createdAt: record.contact.createdAt,
      },
      relatedBookings,
    };
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
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) throw new Error("Could not create contact.");

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
        after: auditSnapshot(created, input.organizationName),
      });
      return created.id;
    });
  }

  async updateContact(
    contactId: string,
    input: ContactInput,
    now = new Date(),
  ) {
    return this.database.transaction(async (transaction) => {
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
      if (!before) return false;

      const organizationId = await this.resolveOrganizationId(
        transaction,
        input.organizationName,
        now,
      );
      const [updated] = await transaction
        .update(contacts)
        .set({
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
          updatedAt: now,
        })
        .where(eq(contacts.id, contactId))
        .returning();
      if (!updated) return false;

      await transaction
        .insert(actContactSyncStates)
        .values({
          contactId,
          localDirty: true,
          state: "waiting",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: actContactSyncStates.contactId,
          set: {
            localDirty: true,
            state: "waiting",
            updatedAt: now,
          },
        });
      await recordAuditEntry(transaction, {
        entityType: "contact",
        entityId: contactId,
        action: "update",
        before: auditSnapshot(before.contact, before.organizationName),
        after: auditSnapshot(updated, input.organizationName),
      });
      return true;
    });
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
    const [existing] = await writer
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        sql`lower(regexp_replace(trim(${organizations.name}), '\\s+', ' ', 'g')) = ${normalizedName}`,
      )
      .limit(1);
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
    return created.id;
  }
}
