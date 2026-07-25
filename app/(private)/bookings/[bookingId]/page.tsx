import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { completeFollowUpAction } from "@/app/(private)/bookings/actions";
import { FollowUpCompletionDialog } from "@/components/bookings/follow-up-completion-dialog";
import { StatusBadge } from "@/components/bookings/status-badge";
import { DrizzleBookingRepository } from "@/features/bookings/booking-repository";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

function formatDate(value: Date | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
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
          <dd className="mt-0.5 text-slate-900">{item.value || "Not set"}</dd>
        </div>
      ))}
    </dl>
  );
}

async function loadBooking(bookingId: string) {
  await requireOwner();
  const { db } = await import("@/db/client");
  return new DrizzleBookingRepository(db).getBookingDetail(bookingId);
}

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const detail = await loadBooking(bookingId);
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
          <Link
            className="button-secondary text-center"
            href={`/bookings/${booking.id}/edit`}
          >
            Edit booking
          </Link>
        </div>
        <p className="mt-2 text-slate-600">
          {booking.city}, {booking.region}
        </p>
      </header>

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
