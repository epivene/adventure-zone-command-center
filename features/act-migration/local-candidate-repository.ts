import { asc } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  actExternalLinks,
  bookingContacts,
  bookings,
  contacts,
  organizationContacts,
  organizations,
} from "@/db/schema";
import type {
  ActSourceEntityType,
  LocalMigrationCandidateSnapshot,
} from "@/features/act-migration/migration-types";
import {
  isSharedMailboxEmail,
  normalizeMatchingEmail,
  normalizeMatchingText,
  normalizeWebsiteHost,
} from "@/features/act-migration/matching-normalization";
import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";

type DrizzleDatabase = typeof database;

function normalizedPhone(value: string | null) {
  return value ? normalizeNorthAmericanPhone(value) : null;
}

function isoString(value: Date | null) {
  return value?.toISOString() ?? null;
}

export interface LocalCandidateRepository {
  loadCandidateSnapshot(): Promise<LocalMigrationCandidateSnapshot>;
}

export class DrizzleLocalCandidateRepository
  implements LocalCandidateRepository
{
  constructor(private readonly database: DrizzleDatabase) {}

  loadCandidateSnapshot(): Promise<LocalMigrationCandidateSnapshot> {
    return this.database.transaction(
      async (transaction) => {
        const [
          placeRows,
          personRows,
          bookingRows,
          placePersonRows,
          bookingPersonRows,
          externalLinkRows,
        ] = await Promise.all([
          transaction
            .select()
            .from(organizations)
            .orderBy(asc(organizations.id)),
          transaction.select().from(contacts).orderBy(asc(contacts.id)),
          transaction.select().from(bookings).orderBy(asc(bookings.id)),
          transaction
            .select()
            .from(organizationContacts)
            .orderBy(
              asc(organizationContacts.organizationId),
              asc(organizationContacts.contactId),
            ),
          transaction
            .select()
            .from(bookingContacts)
            .orderBy(
              asc(bookingContacts.bookingId),
              asc(bookingContacts.contactId),
            ),
          transaction
            .select()
            .from(actExternalLinks)
            .orderBy(
              asc(actExternalLinks.sourceEntityType),
              asc(actExternalLinks.actRecordId),
              asc(actExternalLinks.entityId),
            ),
        ]);

        return {
          places: placeRows.map((row) => ({
            id: row.id,
            name: row.name,
            normalizedName: normalizeMatchingText(row.name) ?? "",
            placeType: row.placeType,
            actIndustry: row.actIndustry,
            phone: row.phone,
            normalizedPhone: normalizedPhone(row.phone),
            address1: row.address1,
            address2: row.address2,
            city: row.city,
            region: row.region,
            normalizedCity: normalizeMatchingText(row.city),
            normalizedRegion: normalizeMatchingText(row.region),
            postalCode: row.postalCode,
            website: row.website,
            normalizedWebsiteHost: normalizeWebsiteHost(row.website),
          })),
          people: personRows.map((row) => {
            const displayName =
              [row.firstName.trim(), row.lastName.trim()]
                .filter(Boolean)
                .join(" ") || row.firstName.trim() || row.lastName.trim();
            const normalizedEmail = normalizeMatchingEmail(row.email);
            return {
              id: row.id,
              firstName: row.firstName,
              lastName: row.lastName,
              displayName,
              normalizedName: normalizeMatchingText(displayName) ?? "",
              email: row.email,
              normalizedEmail,
              sharedEmail: isSharedMailboxEmail(normalizedEmail),
              phone: row.phone,
              normalizedPhone: normalizedPhone(row.phone),
              jobTitle: row.jobTitle,
              address1: row.address1,
              address2: row.address2,
              city: row.city,
              region: row.region,
              postalCode: row.postalCode,
            };
          }),
          bookings: bookingRows.map((row) => ({
            id: row.id,
            organizationId: row.organizationId,
            primaryContactId: row.primaryContactId,
            name: row.name,
            venueName: row.venueName,
            address1: row.address1,
            city: row.city,
            region: row.region,
            postalCode: row.postalCode,
            startsAt: isoString(row.startsAt),
            endsAt: isoString(row.endsAt),
            status: row.status,
            probability: row.probability,
            notes: row.notes,
          })),
          placePeople: placePersonRows.map((row) => ({
            organizationId: row.organizationId,
            contactId: row.contactId,
            active: row.active,
            isPrimary: row.isPrimary,
            role: row.role,
            source: row.source,
          })),
          bookingPeople: bookingPersonRows.map((row) => ({
            bookingId: row.bookingId,
            contactId: row.contactId,
            isPrimary: row.isPrimary,
            role: row.role,
            source: row.source,
          })),
          externalLinks: externalLinkRows.map((row) => ({
            entityType: row.entityType as
              | "organization"
              | "contact"
              | "booking"
              | "calling_list",
            entityId: row.entityId,
            sourceEntityType: row.sourceEntityType as ActSourceEntityType,
            actRecordId: row.actRecordId,
            isPrimary: row.isPrimary,
            syncMode: row.syncMode as "two_way" | "pull_only",
          })),
        };
      },
      {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      },
    );
  }
}
