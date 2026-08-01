import { useEffect, useState } from "react";
import { Link } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { FollowUpList } from "@/components/today/follow-up-list";
import { NextCallCard, eventProfileHref } from "@/components/today/next-call-card";
import { SummaryCards } from "@/components/today/summary-cards";
import { BookingOperations } from "@/components/today/booking-operations";
import { BUSINESS_TIME_ZONE } from "@/lib/business-date";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(value);
}

function todayHref(followUpsPage: number, planPage: number) {
  const query = new URLSearchParams();
  if (followUpsPage > 1) query.set("followUpsPage", String(followUpsPage));
  if (planPage > 1) query.set("planPage", String(planPage));
  const s = query.toString();
  return s ? `/today?${s}` : "/today";
}

export default function TodayPage() {
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();

  useEffect(() => {
    apiGet<any>("/today")
      .then((d) => { setDashboard(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <div className="flex h-64 items-center justify-center">
          <p className="text-slate-500">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="mx-auto max-w-7xl">
        <div className="mt-8 rounded-xl border border-rose-200 bg-rose-50 p-6">
          <p className="font-semibold text-rose-800">Could not load dashboard</p>
          <p className="mt-1 text-sm text-rose-700">{error}</p>
        </div>
      </div>
    );
  }

  // Coerce date strings back to Date objects
  const followUps = (dashboard.followUps ?? []).map((f: any) => ({
    ...f,
    dueAt: new Date(f.dueAt),
    completedAt: f.completedAt ? new Date(f.completedAt) : null,
  }));

  const upcomingEvents = (dashboard.upcomingEvents ?? []).map((e: any) => ({
    ...e,
    startsAt: e.startsAt ? new Date(e.startsAt) : null,
  }));

  const firstNewLead = (dashboard.needsFollowUpPlan ?? []).find(
    (b: any) => b.status === "new_lead",
  );
  const newLeadHref = firstNewLead
    ? eventProfileHref({
        organizationId: firstNewLead.organizationId ?? null,
        contactId: firstNewLead.primaryContactId,
        bookingId: firstNewLead.id,
        mode: "prospect",
      }) ?? undefined
    : undefined;

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
            Command Center
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Today</h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Calls and decisions that need your attention first.
          </p>
        </div>
        <Link className="button-primary text-center" href="/event-profiles/new">
          New event
        </Link>
      </header>

      <SummaryCards
        contractCount={dashboard.contractCount}
        followUpCount={dashboard.followUpCount}
        newLeadCount={dashboard.newLeadCount}
        newLeadHref={newLeadHref}
        visibleRouteWarningCount={dashboard.visibleRouteWarningCount}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(19rem,1fr)] lg:items-start">
        <div className="grid gap-3">
          <FollowUpList followUps={followUps} now={now} />
        </div>
        <NextCallCard followUp={dashboard.nextCall ? { ...dashboard.nextCall, dueAt: new Date(dashboard.nextCall.dueAt) } : null} />
      </div>

      {(dashboard.todayTrips ?? []).length ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Today's trips</h2>
          <p className="mt-1 text-sm text-slate-600">Routes on the road today.</p>
          <ul className="mt-4 grid gap-2">
            {dashboard.todayTrips.map((trip: any) => (
              <li className="flex flex-wrap items-center gap-2" key={trip.id}>
                {trip.legColor ? (
                  <span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: trip.legColor }} />
                ) : null}
                <Link className="font-semibold text-slate-950 hover:text-orange-700" href={`/trips/${trip.id}`}>
                  {trip.name}
                </Link>
                <span className="text-sm text-slate-600">
                  {trip.legName ? `${trip.legName} · ` : ""}
                  {trip.stopCount} {trip.stopCount === 1 ? "stop" : "stops"}
                  {trip.vehicleName ? ` · ${trip.vehicleName}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Needs Follow-up Plan</h2>
          <p className="mt-1 text-sm text-slate-600">
            Active leads without a future, incomplete action.
          </p>
          {(dashboard.needsFollowUpPlan ?? []).length ? (
            <ul className="mt-4 grid gap-2">
              {dashboard.needsFollowUpPlan.map((booking: any) => (
                <li key={booking.id}>
                  <Link
                    className="font-semibold text-slate-950 hover:text-orange-700"
                    href={
                      eventProfileHref({
                        organizationId: booking.organizationId ?? null,
                        contactId: booking.primaryContactId,
                        bookingId: booking.id,
                        mode: booking.status === "new_lead" ? "prospect" : undefined,
                      }) ?? `/bookings/${booking.id}`
                    }
                  >
                    {booking.name}
                  </Link>
                  <span className="ml-2 text-sm capitalize text-slate-600">
                    {booking.status.replaceAll("_", " ")}
                  </span>
                  <BookingOperations operations={booking.operations} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-600">Every active lead has a future action.</p>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Upcoming events</h2>
          <p className="mt-1 text-sm text-slate-600">The next five dated bookings.</p>
          {upcomingEvents.length ? (
            <ul className="mt-4 grid gap-3">
              {upcomingEvents.map((event: any) => (
                <li className="flex items-start justify-between gap-3" key={event.id}>
                  <div>
                    <Link
                      className="font-semibold text-slate-950 hover:text-orange-700"
                      href={
                        eventProfileHref({
                          organizationId: event.organizationId ?? null,
                          contactId: event.primaryContactId,
                          bookingId: event.id,
                        }) ?? `/bookings/${event.id}`
                      }
                    >
                      {event.name}
                    </Link>
                    <BookingOperations operations={event.operations} />
                  </div>
                  {event.startsAt && (
                    <span className="whitespace-nowrap text-sm text-slate-600">
                      {formatDate(event.startsAt)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-600">No upcoming event dates are set.</p>
          )}
        </section>
      </div>
    </div>
  );
}
