import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { completeCallAction, listActivityRevisionsAction } from "@/app/(private)/calls/actions";
import { CallWorkspace } from "@/components/calls/call-workspace";
import { bookings, contacts, followUps, organizations } from "@/db/schema";
import { ActivityService } from "@/features/activities/activity-service";
import { DrizzleActivityRepository } from "@/features/activities/activity-repository";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CallWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ contactId?: string | string[]; bookingId?: string | string[]; followUpId?: string | string[] }>;
}) {
  await requireOwner();
  const query = await searchParams;
  const requestedContactId = firstValue(query.contactId);
  const requestedBookingId = firstValue(query.bookingId);
  const requestedFollowUpId = firstValue(query.followUpId);
  if (!requestedContactId && !requestedBookingId && !requestedFollowUpId) notFound();

  const { db } = await import("@/db/client");
  const [followUp] = requestedFollowUpId
    ? await db.select().from(followUps).where(eq(followUps.id, requestedFollowUpId)).limit(1)
    : [];
  const bookingId = requestedBookingId ?? followUp?.bookingId ?? undefined;
  const bookingRecord = bookingId
    ? (await db.select({ booking: bookings, organization: organizations })
      .from(bookings)
      .leftJoin(organizations, eq(bookings.organizationId, organizations.id))
      .where(eq(bookings.id, bookingId)).limit(1))[0] ?? null
    : null;
  const contactId = requestedContactId ?? followUp?.contactId ?? bookingRecord?.booking.primaryContactId ?? undefined;
  const contactRecord = contactId
    ? (await db.select({ contact: contacts, organization: organizations })
      .from(contacts)
      .leftJoin(organizations, eq(contacts.organizationId, organizations.id))
      .where(eq(contacts.id, contactId)).limit(1))[0] ?? null
    : null;
  const contact = contactRecord?.contact ?? null;
  const booking = bookingRecord?.booking ?? null;
  const organization = bookingRecord?.organization ?? contactRecord?.organization ?? null;
  if (!organization || (contactId && !contact) || (bookingId && !booking) || (requestedFollowUpId && !followUp)) {
    notFound();
  }

  const timeline = await new ActivityService(new DrizzleActivityRepository(db)).listTimeline({
    organizationId: organization.id,
    contactId: contact?.id,
    bookingId: booking?.id,
  });

  return (
    <CallWorkspace
      booking={booking ? {
        id: booking.id,
        name: booking.name,
        city: booking.city,
        region: booking.region,
        status: booking.status,
        startsAt: booking.startsAt,
      } : null}
      contact={contact ? {
        id: contact.id,
        name: `${contact.firstName} ${contact.lastName}`.trim(),
        phone: contact.phone,
        email: contact.email,
      } : null}
      followUpId={followUp?.id ?? null}
      loadRevisions={listActivityRevisionsAction}
      onComplete={completeCallAction}
      organization={{
        id: organization.id,
        name: organization.name,
        lastResort: organization.lastResort,
        lastResortReason: organization.lastResortReason,
      }}
      timeline={timeline.slice(0, 10)}
    />
  );
}
