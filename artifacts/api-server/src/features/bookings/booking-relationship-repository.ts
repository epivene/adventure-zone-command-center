import { commitmentTransaction } from "@/features/outreach-planner/outreach-commitments";
import {
  and,
  asc,
  eq,
  inArray,
  notInArray,
} from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  bookingContacts,
  bookings,
  contacts,
  organizationContacts,
  organizations,
} from "@/db/schema";
import { recordAuditEntry } from "@/features/audit/audit-service";
import type {
  BookingPersonSelection,
  ChangeBookingPlaceInput,
  ReplaceBookingPeopleInput,
} from "@/features/bookings/booking-relationship-input";
import type { RelationshipSource } from "@/features/relationships/relationship-types";

export type ChangeBookingPlaceResult = {
  bookingId: string;
  organizationId: string;
  primaryContactId: string | null;
  removedContactIds: string[];
};

export type BookingRelationshipWriteResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "booking_not_found" }
  | { kind: "place_not_found" }
  | { kind: "people_outside_place"; contactIds: string[] };

export type BookingRelationshipWriter = Pick<
  typeof database,
  "select" | "insert" | "update" | "delete"
>;

type BookingRow = typeof bookings.$inferSelect;
type BookingContactRow = typeof bookingContacts.$inferSelect;

export type LockedBookingRelationshipParents = {
  booking: BookingRow | null;
  bookingPeople: BookingContactRow[];
  organizationIds: ReadonlySet<string>;
};

class BookingRelationshipsChangedWhileLockingError extends Error {
  constructor() {
    super("Booking relationships changed while locks were acquired.");
    this.name = "BookingRelationshipsChangedWhileLockingError";
  }
}

function sortedUniqueIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length &&
    left.every((id, index) => id === right[index]);
}

export async function lockBookingRelationshipParents(
  writer: BookingRelationshipWriter,
  input: {
    bookingId: string;
    additionalOrganizationIds?: string[];
    additionalContactIds?: string[];
    includeExistingPeople: boolean;
  },
): Promise<LockedBookingRelationshipParents> {
  const [previewBooking] = await writer
    .select()
    .from(bookings)
    .where(eq(bookings.id, input.bookingId))
    .limit(1);
  const previewPeople = input.includeExistingPeople
    ? await writer
        .select()
        .from(bookingContacts)
        .where(eq(bookingContacts.bookingId, input.bookingId))
        .orderBy(asc(bookingContacts.contactId))
    : [];

  const organizationIds = sortedUniqueIds([
    previewBooking?.organizationId,
    ...(input.additionalOrganizationIds ?? []),
  ]);
  const contactIds = sortedUniqueIds([
    ...previewPeople.map(({ contactId }) => contactId),
    ...(input.additionalContactIds ?? []),
  ]);

  const lockedOrganizations = organizationIds.length > 0
    ? await writer
        .select({ id: organizations.id })
        .from(organizations)
        .where(inArray(organizations.id, organizationIds))
        .orderBy(asc(organizations.id))
        .for("update")
    : [];
  if (contactIds.length > 0) {
    await writer
      .select({ id: contacts.id })
      .from(contacts)
      .where(inArray(contacts.id, contactIds))
      .orderBy(asc(contacts.id))
      .for("update");
  }

  const [lockedBooking] = await writer
    .select()
    .from(bookings)
    .where(eq(bookings.id, input.bookingId))
    .limit(1)
    .for("update");
  if (
    Boolean(previewBooking) !== Boolean(lockedBooking) ||
    (
      previewBooking &&
      lockedBooking &&
      (
        previewBooking.organizationId !== lockedBooking.organizationId ||
        previewBooking.primaryContactId !== lockedBooking.primaryContactId
      )
    )
  ) {
    throw new BookingRelationshipsChangedWhileLockingError();
  }

  const lockedPeople = input.includeExistingPeople
    ? await writer
        .select()
        .from(bookingContacts)
        .where(eq(bookingContacts.bookingId, input.bookingId))
        .orderBy(asc(bookingContacts.contactId))
        .for("update")
    : [];
  if (
    input.includeExistingPeople &&
    !sameIds(
      previewPeople.map(({ contactId }) => contactId),
      lockedPeople.map(({ contactId }) => contactId),
    )
  ) {
    throw new BookingRelationshipsChangedWhileLockingError();
  }

  return {
    booking: lockedBooking ?? null,
    bookingPeople: lockedPeople,
    organizationIds: new Set(lockedOrganizations.map(({ id }) => id)),
  };
}

export async function ensureBookingContactAfterParentLocks(
  writer: BookingRelationshipWriter,
  booking: BookingRow,
  input: {
    bookingId: string;
    contactId: string;
    role?: string | null;
    source: RelationshipSource;
    now: Date;
  },
): Promise<void> {
  if (booking.organizationId) {
    const [activeRelationship] = await writer
      .select({ contactId: organizationContacts.contactId })
      .from(organizationContacts)
      .where(and(
        eq(organizationContacts.organizationId, booking.organizationId),
        eq(organizationContacts.contactId, input.contactId),
        eq(organizationContacts.active, true),
      ))
      .limit(1)
      .for("share");
    if (!activeRelationship) {
      throw new Error(
        "Cannot associate a Person who is not actively associated with the Booking Place.",
      );
    }
  } else if (input.source !== "undo") {
    throw new Error("Cannot associate a Person with a Booking that has no Place.");
  }

  await writer
    .insert(bookingContacts)
    .values({
      bookingId: input.bookingId,
      contactId: input.contactId,
      role: input.role ?? null,
      isPrimary: false,
      source: input.source,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [bookingContacts.bookingId, bookingContacts.contactId],
      set: {
        ...(input.role !== undefined ? { role: input.role } : {}),
        source: input.source,
        updatedAt: input.now,
      },
    });
}

export async function ensureBookingContact(
  writer: BookingRelationshipWriter,
  input: {
    bookingId: string;
    contactId: string;
    role?: string | null;
    source: RelationshipSource;
    now: Date;
  },
): Promise<void> {
  const { booking } = await lockBookingRelationshipParents(writer, {
    bookingId: input.bookingId,
    additionalContactIds: [input.contactId],
    includeExistingPeople: false,
  });
  if (!booking) {
    throw new Error("Cannot associate a Person with a missing Booking.");
  }

  await ensureBookingContactAfterParentLocks(writer, booking, input);
}

export async function setBookingPrimaryContactAfterParentLocks(
  writer: BookingRelationshipWriter,
  booking: BookingRow,
  input: {
    bookingId: string;
    contactId: string | null;
    role?: string | null;
    source: RelationshipSource;
    now: Date;
  },
): Promise<void> {
  if (input.contactId) {
    await ensureBookingContactAfterParentLocks(writer, booking, {
      ...input,
      contactId: input.contactId,
    });
  }

  await writer
    .update(bookings)
    .set({ primaryContactId: null, updatedAt: input.now })
    .where(eq(bookings.id, input.bookingId));
  await writer
    .update(bookingContacts)
    .set({
      isPrimary: false,
      source: input.source,
      updatedAt: input.now,
    })
    .where(and(
      eq(bookingContacts.bookingId, input.bookingId),
      eq(bookingContacts.isPrimary, true),
    ));

  if (!input.contactId) return;

  const [association] = await writer
    .update(bookingContacts)
    .set({
      ...(input.role !== undefined ? { role: input.role } : {}),
      isPrimary: true,
      source: input.source,
      updatedAt: input.now,
    })
    .where(and(
      eq(bookingContacts.bookingId, input.bookingId),
      eq(bookingContacts.contactId, input.contactId),
    ))
    .returning({ contactId: bookingContacts.contactId });
  if (!association) {
    throw new Error("Cannot set a primary Person without a Booking association.");
  }

  await writer
    .update(bookings)
    .set({ primaryContactId: input.contactId, updatedAt: input.now })
    .where(eq(bookings.id, input.bookingId));
}

export async function setBookingPrimaryContact(
  writer: BookingRelationshipWriter,
  input: {
    bookingId: string;
    contactId: string | null;
    role?: string | null;
    source: RelationshipSource;
    now: Date;
  },
): Promise<void> {
  const { booking } = await lockBookingRelationshipParents(writer, {
    bookingId: input.bookingId,
    additionalContactIds: input.contactId ? [input.contactId] : [],
    includeExistingPeople: true,
  });
  if (!booking) {
    if (!input.contactId) return;
    throw new Error("Cannot associate a Person with a missing Booking.");
  }
  await setBookingPrimaryContactAfterParentLocks(writer, booking, input);
}

export interface BookingRelationshipRepository {
  changePlace(
    input: ChangeBookingPlaceInput,
    now: Date,
  ): Promise<BookingRelationshipWriteResult<ChangeBookingPlaceResult>>;
  replacePeople(
    input: ReplaceBookingPeopleInput,
    now: Date,
  ): Promise<BookingRelationshipWriteResult<BookingPersonSelection[]>>;
}

type DrizzleDatabase = typeof database;

function selection(row: BookingContactRow): BookingPersonSelection {
  return {
    contactId: row.contactId,
    role: row.role,
    isPrimary: row.isPrimary,
  };
}

function sortedSelections(people: BookingPersonSelection[]) {
  return [...people].sort((left, right) =>
    left.contactId.localeCompare(right.contactId));
}

export class DrizzleBookingRelationshipRepository
implements BookingRelationshipRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async changePlace(
    input: ChangeBookingPlaceInput,
    now: Date,
  ): Promise<BookingRelationshipWriteResult<ChangeBookingPlaceResult>> {
    return commitmentTransaction(this.database, async (transaction) => {
      const locked = await lockBookingRelationshipParents(transaction, {
        bookingId: input.bookingId,
        additionalOrganizationIds: [input.organizationId],
        includeExistingPeople: true,
      });
      const { booking } = locked;
      if (!booking) return { kind: "booking_not_found" };
      if (!locked.organizationIds.has(input.organizationId)) {
        return { kind: "place_not_found" };
      }

      const retainedPeople = await transaction
        .select({ contactId: bookingContacts.contactId })
        .from(bookingContacts)
        .innerJoin(
          organizationContacts,
          and(
            eq(organizationContacts.contactId, bookingContacts.contactId),
            eq(organizationContacts.organizationId, input.organizationId),
            eq(organizationContacts.active, true),
          ),
        )
        .where(eq(bookingContacts.bookingId, input.bookingId))
        .for("update");
      const beforePeople = locked.bookingPeople;
      const retainedIds = new Set(
        retainedPeople.map(({ contactId }) => contactId),
      );
      const removedContactIds = beforePeople
        .map(({ contactId }) => contactId)
        .filter((contactId) => !retainedIds.has(contactId));
      const primaryContactId =
        booking.primaryContactId &&
        retainedIds.has(booking.primaryContactId)
          ? booking.primaryContactId
          : null;

      if (booking.primaryContactId && !primaryContactId) {
        await transaction
          .update(bookings)
          .set({ primaryContactId: null, updatedAt: now })
          .where(eq(bookings.id, input.bookingId));
      }
      await transaction
        .delete(bookingContacts)
        .where(and(
          eq(bookingContacts.bookingId, input.bookingId),
          retainedIds.size > 0
            ? notInArray(bookingContacts.contactId, [...retainedIds])
            : undefined,
        ));
      await transaction
        .update(bookings)
        .set({
          organizationId: input.organizationId,
          primaryContactId,
          updatedAt: now,
        })
        .where(eq(bookings.id, input.bookingId));

      await recordAuditEntry(transaction, {
        entityType: "booking_contact",
        entityId: input.bookingId,
        action: "place_changed",
        before: {
          organizationId: booking.organizationId,
          primaryContactId: booking.primaryContactId,
        },
        after: {
          organizationId: input.organizationId,
          primaryContactId,
          removedContactIds,
        },
      });

      return {
        kind: "ok",
        value: {
          bookingId: input.bookingId,
          organizationId: input.organizationId,
          primaryContactId,
          removedContactIds,
        },
      };
    });
  }

  async replacePeople(
    input: ReplaceBookingPeopleInput,
    now: Date,
  ): Promise<BookingRelationshipWriteResult<BookingPersonSelection[]>> {
    return commitmentTransaction(this.database, async (transaction) => {
      const selectedIds = input.people.map(({ contactId }) => contactId);
      const locked = await lockBookingRelationshipParents(transaction, {
        bookingId: input.bookingId,
        additionalContactIds: selectedIds,
        includeExistingPeople: true,
      });
      const { booking } = locked;
      if (!booking) return { kind: "booking_not_found" };
      if (!booking.organizationId) return { kind: "place_not_found" };

      const activeRelationships = selectedIds.length > 0
        ? await transaction
            .select({ contactId: organizationContacts.contactId })
            .from(organizationContacts)
            .where(and(
              eq(
                organizationContacts.organizationId,
                booking.organizationId,
              ),
              eq(organizationContacts.active, true),
              inArray(organizationContacts.contactId, selectedIds),
            ))
            .for("share")
        : [];
      const activeIds = new Set(
        activeRelationships.map(({ contactId }) => contactId),
      );
      const outsidePlace = selectedIds.filter(
        (contactId) => !activeIds.has(contactId),
      );
      if (outsidePlace.length > 0) {
        return {
          kind: "people_outside_place",
          contactIds: outsidePlace,
        };
      }

      const beforePeople = locked.bookingPeople;
      await transaction
        .update(bookings)
        .set({ primaryContactId: null, updatedAt: now })
        .where(eq(bookings.id, input.bookingId));
      await transaction
        .delete(bookingContacts)
        .where(eq(bookingContacts.bookingId, input.bookingId));
      if (input.people.length > 0) {
        await transaction.insert(bookingContacts).values(
          input.people.map((person) => ({
            bookingId: input.bookingId,
            ...person,
            source: "local",
            createdAt: now,
            updatedAt: now,
          })),
        );
      }
      const primaryContactId =
        input.people.find(({ isPrimary }) => isPrimary)?.contactId ?? null;
      await transaction
        .update(bookings)
        .set({ primaryContactId, updatedAt: now })
        .where(eq(bookings.id, input.bookingId));

      await recordAuditEntry(transaction, {
        entityType: "booking_contact",
        entityId: input.bookingId,
        action: "people_replaced",
        before: {
          organizationId: booking.organizationId,
          primaryContactId: booking.primaryContactId,
          people: beforePeople.map(selection),
        },
        after: {
          organizationId: booking.organizationId,
          primaryContactId,
          people: sortedSelections(input.people),
        },
      });

      return { kind: "ok", value: input.people };
    });
  }
}
