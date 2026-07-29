import { eq } from "drizzle-orm";
import { z } from "zod";

import type { db as database } from "@/db/client";
import { bookings, contacts, followUps, organizations } from "@/db/schema";
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
}

export type CallWorkspaceQuery = {
  organizationId?: string;
  contactId?: string;
  bookingId?: string;
  followUpId?: string;
};

function validId(value: string | undefined) {
  if (!value) return null;
  const parsed = z.uuid().safeParse(value);
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
  if (
    booking &&
    requestedContactId &&
    booking.primaryContactId &&
    requestedContactId !== booking.primaryContactId &&
    !followUp?.contactId
  ) {
    return { ok: false };
  }

  const contactId = requestedContactId ?? followUp?.contactId ?? booking?.primaryContactId ?? null;
  const contact = contactId ? await repository.findContact(contactId) : null;
  if (contactId && !contact) return { ok: false };

  const organizationIds = [
    requestedOrganizationId,
    followUp?.organizationId,
    booking?.organizationId,
    contact?.organizationId,
  ].filter((id): id is string => Boolean(id));
  if (new Set(organizationIds).size > 1) return { ok: false };
  const organizationId = requestedOrganizationId ?? organizationIds[0] ?? null;
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
}
