import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { ActivityTimeline } from "@/components/activities/activity-timeline";
import { FollowUpCompletionDialog } from "@/components/bookings/follow-up-completion-dialog";
import { StatusBadge } from "@/components/bookings/status-badge";
import { LastResortWarning } from "@/components/organizations/last-resort-warning";
import { BUSINESS_TIME_ZONE } from "@/lib/business-date";
import {
  createActivityAction,
  editActivityAction,
  listActivityRevisionsAction,
} from "@/actions/activities";
import { completeFollowUpAction } from "@/actions/bookings";
import type { ReactNode } from "react";

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(new Date(value));
}

function DetailSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-sm font-semibold text-slate-500">{item.label}</dt>
          <dd className="mt-0.5 text-slate-900">
            {item.value == null || item.value === "" ? "Not set" : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function BookingDetailPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookingId) return;
    apiGet<any>(`/bookings/${bookingId}`)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [bookingId]);

  if (loading) return <div className="mx-auto max-w-7xl"><p className="mt-8 text-slate-500">Loading booking…</p></div>;
  if (error || !data) return <div className="mx-auto max-w-7xl"><p className="mt-8 text-rose-700">{error ?? "Not found"}</p></div>;

  const { booking, organization, contact, travelLeg, followUps, timeline } = data;
  const nextFollowUp = (followUps ?? []).find((f: any) => !f.completedAt) ?? null;

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{booking.name}</h1>
            <StatusBadge status={booking.status} />
          </div>
          <p className="mt-1 text-slate-600">{booking.city}, {booking.region}</p>
        </div>
        <Link className="button-primary text-center" href={`/bookings/${bookingId}/edit`}>
          Edit booking
        </Link>
      </header>

      {organization?.lastResort && (
        <LastResortWarning
          organizationName={organization.name}
          reason={organization.lastResortReason ?? ""}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <DetailSection title="Details">
          <DetailList
            items={[
              { label: "Dates", value: `${formatDate(booking.startsAt)} – ${formatDate(booking.endsAt)}` },
              { label: "Venue", value: booking.venueName },
              { label: "City", value: `${booking.city}, ${booking.region}` },
              { label: "Probability", value: booking.probability },
              { label: "Travel leg", value: travelLeg?.name },
            ]}
          />
        </DetailSection>

        <DetailSection title="Contacts">
          {contact ? (
            <Link className="link" href={`/contacts/${contact.id}`}>
              {contact.firstName} {contact.lastName}
            </Link>
          ) : (
            <p className="text-sm text-slate-500">No contact assigned</p>
          )}
        </DetailSection>
      </div>

      {nextFollowUp && (
        <FollowUpCompletionDialog
          bookingStatus={booking.status}
          followUpId={nextFollowUp.id}
          onComplete={completeFollowUpAction}
        />
      )}

      <ActivityTimeline
        activities={timeline ?? []}
        parent={{ bookingId: bookingId! }}
        createActivity={createActivityAction}
        editActivity={editActivityAction}
        loadRevisions={listActivityRevisionsAction}
      />
    </div>
  );
}
