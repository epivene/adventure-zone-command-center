import { and, eq, isNotNull, isNull } from "drizzle-orm";

import type { db as relationshipDatabase } from "@/db/client";
import {
  bookingContacts,
  bookings,
  contacts,
  organizationContacts,
} from "@/db/schema";

export type RelationshipInvariantReport = {
  contactPrimaryPlaceWithoutAssociation: string[];
  bookingPrimaryPersonWithoutAssociation: string[];
  bookingPeopleOutsidePlace: Array<{
    bookingId: string;
    contactId: string;
  }>;
  legacyBookingsWithoutPlace: string[];
};

export async function inspectRelationshipInvariants(
  database: typeof relationshipDatabase,
): Promise<RelationshipInvariantReport> {
  const [
    contactPrimaryPlaceRows,
    bookingPrimaryPersonRows,
    bookingPeopleOutsidePlaceRows,
    legacyBookingRows,
  ] = await Promise.all([
    database
      .select({ id: contacts.id })
      .from(contacts)
      .leftJoin(
        organizationContacts,
        and(
          eq(organizationContacts.organizationId, contacts.organizationId),
          eq(organizationContacts.contactId, contacts.id),
          eq(organizationContacts.active, true),
        ),
      )
      .where(and(
        isNotNull(contacts.organizationId),
        isNull(organizationContacts.id),
      )),
    database
      .select({ id: bookings.id })
      .from(bookings)
      .leftJoin(
        bookingContacts,
        and(
          eq(bookingContacts.bookingId, bookings.id),
          eq(bookingContacts.contactId, bookings.primaryContactId),
          eq(bookingContacts.isPrimary, true),
        ),
      )
      .where(and(
        isNotNull(bookings.primaryContactId),
        isNull(bookingContacts.id),
      )),
    database
      .select({
        bookingId: bookingContacts.bookingId,
        contactId: bookingContacts.contactId,
      })
      .from(bookingContacts)
      .innerJoin(bookings, eq(bookingContacts.bookingId, bookings.id))
      .leftJoin(
        organizationContacts,
        and(
          eq(organizationContacts.organizationId, bookings.organizationId),
          eq(organizationContacts.contactId, bookingContacts.contactId),
          eq(organizationContacts.active, true),
        ),
      )
      .where(isNull(organizationContacts.id)),
    database
      .select({ id: bookings.id })
      .from(bookings)
      .where(isNull(bookings.organizationId)),
  ]);

  return {
    contactPrimaryPlaceWithoutAssociation: contactPrimaryPlaceRows
      .map(({ id }) => id)
      .sort(),
    bookingPrimaryPersonWithoutAssociation: bookingPrimaryPersonRows
      .map(({ id }) => id)
      .sort(),
    bookingPeopleOutsidePlace: bookingPeopleOutsidePlaceRows
      .map(({ bookingId, contactId }) => ({ bookingId, contactId }))
      .sort((left, right) =>
        left.bookingId.localeCompare(right.bookingId) ||
        left.contactId.localeCompare(right.contactId)),
    legacyBookingsWithoutPlace: legacyBookingRows
      .map(({ id }) => id)
      .sort(),
  };
}
