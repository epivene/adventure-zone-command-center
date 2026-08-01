import { notFound } from "next/navigation";

import {
  createActivityAction,
  editActivityAction,
  listActivityRevisionsAction,
} from "@/app/(private)/activities/actions";
import { completeCallAction } from "@/app/(private)/calls/actions";
import { CallWorkspace } from "@/components/calls/call-workspace";
import { ActivityService } from "@/features/activities/activity-service";
import { DrizzleActivityRepository } from "@/features/activities/activity-repository";
import {
  activityTimelineParent,
  DrizzleCallWorkspaceContextRepository,
} from "@/features/calls/call-workspace-context";
import { loadCallWorkspace } from "@/features/calls/call-workspace-query";
import { createBookingOperationsSummaryProvider } from "@/features/bookings/booking-operations-summary";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CallWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{
    organizationId?: string | string[];
    contactId?: string | string[];
    bookingId?: string | string[];
    followUpId?: string | string[];
  }>;
}) {
  await requireOwner();
  const query = await searchParams;
  const requestedOrganizationId = firstValue(query.organizationId);
  const requestedContactId = firstValue(query.contactId);
  const requestedBookingId = firstValue(query.bookingId);
  const requestedFollowUpId = firstValue(query.followUpId);
  const { db } = await import("@/db/client");
  const workspace = await loadCallWorkspace({
    organizationId: requestedOrganizationId,
    contactId: requestedContactId,
    bookingId: requestedBookingId,
    followUpId: requestedFollowUpId,
  }, new DrizzleCallWorkspaceContextRepository(db),
  createBookingOperationsSummaryProvider(db));
  if (!workspace.ok) notFound();
  const context = workspace.value.context;

  const timeline = await new ActivityService(new DrizzleActivityRepository(db)).listTimeline(
    activityTimelineParent(context),
  );

  return (
    <CallWorkspace
      activityParent={activityTimelineParent(context)}
      booking={context.booking ? {
        id: context.booking.id,
        name: context.booking.name,
        city: context.booking.city,
        region: context.booking.region,
        status: context.booking.status,
        startsAt: context.booking.startsAt,
      } : null}
      contact={context.contact ? {
        id: context.contact.id,
        name: `${context.contact.firstName} ${context.contact.lastName}`.trim(),
        phone: context.contact.phone,
        email: context.contact.email,
        city: context.contact.city,
        region: context.contact.region,
      } : null}
      followUp={context.followUp ? {
        id: context.followUp.id,
        kind: context.followUp.kind,
        dueAt: context.followUp.dueAt,
      } : null}
      createActivity={createActivityAction}
      editActivity={editActivityAction}
      loadRevisions={listActivityRevisionsAction}
      onComplete={completeCallAction}
      operations={workspace.value.operations}
      organization={context.organization ? {
        id: context.organization.id,
        name: context.organization.name,
        lastResort: context.organization.lastResort,
        lastResortReason: context.organization.lastResortReason,
      } : null}
      timeline={timeline}
    />
  );
}
