import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import type { db as database } from "@/db/client";
import {
  activities,
  bookingContacts,
  bookings,
  callSessions,
  contactPhones,
  contacts,
  followUps,
  organizationContacts,
  organizations,
} from "@/db/schema";
import type { ActivityParent } from "@/features/activities/activity-types";
import type { BookingStatus } from "@/features/bookings/booking-types";

export type CallWorkspaceOrganization = {
  id: string;
  name: string;
  lastResort: boolean;
  lastResortReason: string | null;
};

export type CallWorkspaceContact = {
  id: string;
  organizationId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  region: string | null;
};

export type CallWorkspaceBooking = {
  id: string;
  organizationId: string | null;
  primaryContactId: string | null;
  name: string;
  city: string;
  region: string;
  status: BookingStatus;
  startsAt: Date | null;
};

export type CallWorkspaceFollowUp = {
  id: string;
  organizationId: string | null;
  contactId: string | null;
  bookingId: string | null;
  kind: string;
  dueAt: Date;
};

export type CallWorkspaceContext = {
  organization: CallWorkspaceOrganization | null;
  contact: CallWorkspaceContact | null;
  booking: CallWorkspaceBooking | null;
  followUp: CallWorkspaceFollowUp | null;
};

export interface CallWorkspaceContextRepository {
  findOrganization(id: string): Promise<CallWorkspaceOrganization | null>;
  findContact(id: string): Promise<CallWorkspaceContact | null>;
  findBooking(id: string): Promise<CallWorkspaceBooking | null>;
  findFollowUp(id: string): Promise<CallWorkspaceFollowUp | null>;
  hasActiveOrganizationContact(
    organizationId: string,
    contactId: string,
  ): Promise<boolean>;
  hasBookingContact(bookingId: string, contactId: string): Promise<boolean>;
  findLastContactedAt(context: CallWorkspaceContext): Promise<Date | null>;
}

export type CallWorkspaceQuery = {
  organizationId?: string;
  contactId?: string;
  bookingId?: string;
  followUpId?: string;
};

function validId(value: string | undefined) {
  if (!value) return null;
  const parsed = z.string().uuid().safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function activityTimelineParent(context: CallWorkspaceContext): ActivityParent {
  if (context.booking) return { bookingId: context.booking.id };
  if (context.contact) return { contactId: context.contact.id };
  return context.organization ? { organizationId: context.organization.id } : {};
}

export async function loadCallWorkspaceContext(
  query: CallWorkspaceQuery,
  repository: CallWorkspaceContextRepository,
): Promise<{ ok: true; value: CallWorkspaceContext } | { ok: false }> {
  const requestedOrganizationId = validId(query.organizationId);
  const requestedContactId = validId(query.contactId);
  const requestedBookingId = validId(query.bookingId);
  const requestedFollowUpId = validId(query.followUpId);
  if (
    requestedOrganizationId === undefined ||
    requestedContactId === undefined ||
    requestedBookingId === undefined ||
    requestedFollowUpId === undefined ||
    (!requestedOrganizationId &&
      !requestedContactId &&
      !requestedBookingId &&
      !requestedFollowUpId)
  ) return { ok: false };

  const followUp = requestedFollowUpId
    ? await repository.findFollowUp(requestedFollowUpId)
    : null;
  if (requestedFollowUpId && !followUp) return { ok: false };
  if (
    followUp &&
    ((requestedBookingId && requestedBookingId !== followUp.bookingId) ||
      (requestedContactId &&
        followUp.contactId &&
        requestedContactId !== followUp.contactId) ||
      (requestedContactId &&
        !followUp.contactId &&
        !followUp.bookingId))
  ) return { ok: false };

  const bookingId = requestedBookingId ?? followUp?.bookingId ?? null;
  const booking = bookingId ? await repository.findBooking(bookingId) : null;
  if (bookingId && !booking) return { ok: false };
  const contactId = requestedContactId ?? followUp?.contactId ?? booking?.primaryContactId ?? null;
  const contact = contactId ? await repository.findContact(contactId) : null;
  if (contactId && !contact) return { ok: false };

  const organizationId =
    requestedOrganizationId ??
    followUp?.organizationId ??
    booking?.organizationId ??
    contact?.organizationId ??
    null;
  if (
    (followUp?.organizationId && followUp.organizationId !== organizationId) ||
    (booking?.organizationId && booking.organizationId !== organizationId)
  ) return { ok: false };
  if (
    organizationId &&
    contactId &&
    !(await repository.hasActiveOrganizationContact(organizationId, contactId))
  ) return { ok: false };
  if (
    booking &&
    contactId &&
    !(await repository.hasBookingContact(booking.id, contactId))
  ) return { ok: false };
  const organization = organizationId
    ? await repository.findOrganization(organizationId)
    : null;
  if (organizationId && !organization) return { ok: false };

  return { ok: true, value: { organization, contact, booking, followUp } };
}

type DrizzleDatabase = typeof database;

export class DrizzleCallWorkspaceContextRepository
  implements CallWorkspaceContextRepository
{
  constructor(private readonly database: DrizzleDatabase) {}

  async findOrganization(id: string): Promise<CallWorkspaceOrganization | null> {
    const [record] = await this.database.select().from(organizations).where(eq(organizations.id, id)).limit(1);
    return record
      ? { id: record.id, name: record.name, lastResort: record.lastResort, lastResortReason: record.lastResortReason }
      : null;
  }

  async findContact(id: string): Promise<CallWorkspaceContact | null> {
    const [record] = await this.database.select().from(contacts).where(eq(contacts.id, id)).limit(1);
    return record
      ? {
        id: record.id,
        organizationId: record.organizationId,
        firstName: record.firstName,
        lastName: record.lastName,
        email: record.email,
        phone: record.phone,
        city: record.city,
        region: record.region,
      }
      : null;
  }

  async findBooking(id: string): Promise<CallWorkspaceBooking | null> {
    const [record] = await this.database.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    return record
      ? {
        id: record.id,
        organizationId: record.organizationId,
        primaryContactId: record.primaryContactId,
        name: record.name,
        city: record.city,
        region: record.region,
        status: record.status,
        startsAt: record.startsAt,
      }
      : null;
  }

  async findFollowUp(id: string): Promise<CallWorkspaceFollowUp | null> {
    const [record] = await this.database.select().from(followUps).where(eq(followUps.id, id)).limit(1);
    return record
      ? {
        id: record.id,
        organizationId: record.organizationId,
        contactId: record.contactId,
        bookingId: record.bookingId,
        kind: record.kind,
        dueAt: record.dueAt,
      }
      : null;
  }

  async hasActiveOrganizationContact(
    organizationId: string,
    contactId: string,
  ): Promise<boolean> {
    const [record] = await this.database
      .select({ id: organizationContacts.id })
      .from(organizationContacts)
      .where(and(
        eq(organizationContacts.organizationId, organizationId),
        eq(organizationContacts.contactId, contactId),
        eq(organizationContacts.active, true),
      ))
      .limit(1);
    return Boolean(record);
  }

  async hasBookingContact(bookingId: string, contactId: string): Promise<boolean> {
    const [record] = await this.database
      .select({ id: bookingContacts.id })
      .from(bookingContacts)
      .where(and(
        eq(bookingContacts.bookingId, bookingId),
        eq(bookingContacts.contactId, contactId),
      ))
      .limit(1);
    return Boolean(record);
  }

  async findLastContactedAt(context: CallWorkspaceContext): Promise<Date | null> {
    const parent = activityTimelineParent(context);
    const callCondition = parent.bookingId
      ? eq(callSessions.bookingId, parent.bookingId)
      : parent.contactId
      ? eq(callSessions.contactId, parent.contactId)
      : parent.organizationId
      ? eq(callSessions.organizationId, parent.organizationId)
      : undefined;
    const activityCondition = parent.bookingId
      ? eq(activities.bookingId, parent.bookingId)
      : parent.contactId
      ? eq(activities.contactId, parent.contactId)
      : parent.organizationId
      ? eq(activities.organizationId, parent.organizationId)
      : undefined;
    if (!callCondition || !activityCondition) return null;

    const [[call], [activity]] = await Promise.all([
      this.database
        .select({ endedAt: callSessions.endedAt })
        .from(callSessions)
        .where(and(callCondition, isNotNull(callSessions.endedAt)))
        .orderBy(desc(callSessions.endedAt))
        .limit(1),
      this.database
        .select({ occurredAt: activities.occurredAt })
        .from(activities)
        .where(and(activityCondition, isNotNull(activities.occurredAt)))
        .orderBy(desc(activities.occurredAt))
        .limit(1),
    ]);
    const dates = [call?.endedAt, activity?.occurredAt]
      .filter((value): value is Date => value !== null && value !== undefined);
    return dates.length ? new Date(Math.max(...dates.map((value) => value.getTime()))) : null;
  }
}
