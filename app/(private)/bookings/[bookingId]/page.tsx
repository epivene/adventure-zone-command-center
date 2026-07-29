import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import {
  createActivityAction,
  editActivityAction,
  listActivityRevisionsAction,
} from "@/app/(private)/activities/actions";
import { completeFollowUpAction } from "@/app/(private)/bookings/actions";
import { ActivityTimeline } from "@/components/activities/activity-timeline";
import { FollowUpCompletionDialog } from "@/components/bookings/follow-up-completion-dialog";
import { StatusBadge } from "@/components/bookings/status-badge";
import { LastResortWarning } from "@/components/organizations/last-resort-warning";
import { DrizzleActivityRepository } from "@/features/activities/activity-repository";
import { ActivityService } from "@/features/activities/activity-service";
import { DrizzleBookingRepository } from "@/features/bookings/booking-repository";
import { createBookingOperationsSummaryProvider } from "@/features/bookings/booking-operations-summary";
import { requireOwner } from "@/lib/auth/require-owner";
import { BUSINESS_TIME_ZONE } from "@/lib/business-date";

export const dynamic = "force-dynamic";

function formatDate(value: Date | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(value);
}

function DetailSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DetailList({
  items,
}: {
  items: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-sm font-semibold text-slate-500">{item.label}</dt>
          <dd className="mt-0.5 text-slate-900">
            {item.value === null ||
            item.value === undefined ||
            item.value === ""
              ? "Not set"
              : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  await requireOwner();
  const { bookingId } = await params;
  const { db } = await import("@/db/client");
  const [detail, timeline, operations] = await Promise.all([
    new DrizzleBookingRepository(db).getBookingDetail(bookingId),
    new ActivityService(new DrizzleActivityRepository(db)).listTimeline({
      bookingId,
    }),
    createBookingOperationsSummaryProvider(db).getForBooking(bookingId),
  ]);
  if (!detail) notFound();

  const { booking, organization, contact, travelLeg, followUps, auditEntries } =
    detail;
  const nextFollowUp = [...followUps]
    .filter((followUp) => !followUp.completedAt)
    .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime())[0];

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header>
        <Link
          className="text-sm font-semibold text-slate-600 hover:text-orange-700"
          href="/bookings"
        >
          ← Back to bookings
        </Link>
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{booking.name}</h1>
            <StatusBadge status={booking.status} />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              className="button-secondary text-center"
              href={`/calls/new?bookingId=${booking.id}${contact ? `&contactId=${contact.id}` : ""}`}
            >
              Call Workspace
            </Link>
            <Link
              className="button-secondary text-center"
              href={`/bookings/${booking.id}/edit`}
            >
              Edit booking
            </Link>
          </div>
        </div>
        <p className="mt-2 text-slate-600">
          {booking.city}, {booking.region}
        </p>
      </header>

      {organization?.lastResort ? (
        <LastResortWarning
          organizationName={organization.name}
          reason={organization.lastResortReason}
        />
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <DetailSection title="Contact">
          <DetailList
            items={[
              { label: "Organization", value: organization?.name },
              {
                label: "Primary contact",
                value: contact
                  ? `${contact.firstName} ${contact.lastName}`
                  : undefined,
              },
              {
                label: "Email",
                value: contact?.email ? (
                  <a className="link" href={`mailto:${contact.email}`}>
                    {contact.email}
                  </a>
                ) : null,
              },
              {
                label: "Phone",
                value: contact?.phone ? (
                  <a className="link" href={`tel:${contact.phone}`}>
                    {contact.phone}
                  </a>
                ) : null,
              },
            ]}
          />
        </DetailSection>

        <DetailSection title="Event">
          <DetailList
            items={[
              { label: "Venue", value: booking.venueName },
              {
                label: "Dates",
                value: `${formatDate(booking.startsAt)} – ${formatDate(booking.endsAt)}`,
              },
              {
                label: "Location",
                value: [booking.address1, booking.city, booking.region, booking.postalCode]
                  .filter(Boolean)
                  .join(", "),
              },
              { label: "Event name", value: booking.name },
            ]}
          />
        </DetailSection>

        <DetailSection title="Booking">
          <DetailList
            items={[
              { label: "Status", value: <StatusBadge status={booking.status} /> },
              {
                label: "Probability",
                value:
                  booking.probability[0]?.toUpperCase() +
                  booking.probability.slice(1),
              },
              { label: "Act! record", value: booking.actRecordId },
              { label: "Last updated", value: formatDate(booking.updatedAt) },
            ]}
          />
        </DetailSection>

        <DetailSection title="Packages and resources">
          <DetailList
            items={[
              {
                label: "Packages",
                value: operations.packageNames.join(", ") || "Not configured",
              },
              {
                label: "Shared physical attractions",
                value: operations.sharedAttractionTotal,
              },
              {
                label: "Pending special requests",
                value: operations.pendingRequestCount,
              },
              { label: "Travel leg", value: operations.leg?.name },
            ]}
          />
          {operations.warnings.length ? (
            <ul className="mt-4 grid gap-2">
              {operations.warnings.map((warning) => (
                <li key={warning.id}>
                  <Link
                    className={
                      warning.severity === "blocking"
                        ? "font-semibold text-rose-700"
                        : "font-semibold text-amber-800"
                    }
                    href={warning.href}
                  >
                    {warning.message}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </DetailSection>

        <DetailSection title="Logistics">
          <DetailList
            items={[
              { label: "Travel leg", value: travelLeg?.name },
              {
                label: "Coordinates",
                value:
                  booking.latitude !== null && booking.longitude !== null
                    ? `${booking.latitude}, ${booking.longitude}`
                    : null,
              },
              {
                label: "Next action",
                value: nextFollowUp
                  ? `${nextFollowUp.kind.replaceAll("_", " ")} · ${formatDate(
                      nextFollowUp.dueAt,
                    )}`
                  : "Needs follow-up plan",
              },
            ]}
          />
        </DetailSection>

        <DetailSection title="Notes">
          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
            {booking.notes || "No notes have been added."}
          </p>
        </DetailSection>

        <DetailSection title="Follow-ups">
          {followUps.length ? (
            <div className="grid gap-4">
              <ul className="divide-y divide-slate-200">
                {followUps.map((followUp) => (
                  <li className="flex justify-between gap-4 py-3" key={followUp.id}>
                    <div>
                      <p className="font-semibold">
                        {followUp.kind.replaceAll("_", " ")}
                      </p>
                      <p className="text-sm text-slate-600">
                        Due {formatDate(followUp.dueAt)}
                        {followUp.outcome
                          ? ` · ${followUp.outcome.replaceAll("_", " ")}`
                          : ""}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-slate-500">
                      {followUp.completedAt ? "Completed" : "Open"}
                    </span>
                  </li>
                ))}
              </ul>
              {nextFollowUp ? (
                <div>
                  <FollowUpCompletionDialog
                    bookingStatus={booking.status}
                    followUpId={nextFollowUp.id}
                    onComplete={completeFollowUpAction}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-600">No follow-ups recorded.</p>
          )}
        </DetailSection>

        <div className="lg:col-span-2">
          <DetailSection title="Recent activity">
            <ActivityTimeline
              activities={timeline}
              createActivity={createActivityAction}
              editActivity={editActivityAction}
              loadRevisions={listActivityRevisionsAction}
              parent={{ bookingId }}
            />
          </DetailSection>
        </div>

        <div className="lg:col-span-2">
          <DetailSection title="Audit History">
            {auditEntries.length ? (
              <ol className="grid gap-3">
                {auditEntries.map((entry) => (
                  <li
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"
                    key={entry.id}
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-semibold">
                        {entry.entityType.replaceAll("_", " ")} ·{" "}
                        {entry.action.replaceAll("_", " ")}
                      </span>
                      <time className="text-slate-500">
                        {formatDate(entry.createdAt)}
                      </time>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-slate-600">No audit entries recorded.</p>
            )}
          </DetailSection>
        </div>
      </div>
    </div>
  );
}
