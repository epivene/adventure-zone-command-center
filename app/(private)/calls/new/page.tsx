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
  loadCallWorkspaceContext,
} from "@/features/calls/call-workspace-context";
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
  const context = await loadCallWorkspaceContext({
    organizationId: requestedOrganizationId,
    contactId: requestedContactId,
    bookingId: requestedBookingId,
    followUpId: requestedFollowUpId,
  }, new DrizzleCallWorkspaceContextRepository(db));
  if (!context.ok) notFound();

  const timeline = await new ActivityService(new DrizzleActivityRepository(db)).listTimeline(
    activityTimelineParent(context.value),
  );

  return (
    <CallWorkspace
      activityParent={activityTimelineParent(context.value)}
      booking={context.value.booking ? {
        id: context.value.booking.id,
        name: context.value.booking.name,
        city: context.value.booking.city,
        region: context.value.booking.region,
        status: context.value.booking.status,
        startsAt: context.value.booking.startsAt,
      } : null}
      contact={context.value.contact ? {
        id: context.value.contact.id,
        name: `${context.value.contact.firstName} ${context.value.contact.lastName}`.trim(),
        phone: context.value.contact.phone,
        email: context.value.contact.email,
        city: context.value.contact.city,
        region: context.value.contact.region,
      } : null}
      followUp={context.value.followUp ? {
        id: context.value.followUp.id,
        kind: context.value.followUp.kind,
        dueAt: context.value.followUp.dueAt,
      } : null}
      createActivity={createActivityAction}
      editActivity={editActivityAction}
      loadRevisions={listActivityRevisionsAction}
      onComplete={completeCallAction}
      organization={context.value.organization ? {
        id: context.value.organization.id,
        name: context.value.organization.name,
        lastResort: context.value.organization.lastResort,
        lastResortReason: context.value.organization.lastResortReason,
      } : null}
      timeline={timeline}
    />
  );
}
