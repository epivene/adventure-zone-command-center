import Link from "next/link";

import { FollowUpList } from "@/components/today/follow-up-list";
import { NextCallCard } from "@/components/today/next-call-card";
import { SummaryCards } from "@/components/today/summary-cards";
import { getTodayDashboard } from "@/features/follow-ups/today-query";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(value);
}

async function loadDashboard(now: Date) {
  await requireOwner();
  return getTodayDashboard(now);
}

export default async function TodayPage() {
  const now = new Date();
  const dashboard = await loadDashboard(now);

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
        <Link className="button-primary text-center" href="/bookings/new">
          Quick Add
        </Link>
      </header>

      <SummaryCards
        contractCount={dashboard.contractCount}
        followUpCount={dashboard.followUpCount}
        newLeadCount={dashboard.newLeadCount}
        routeWarningCount={dashboard.routeWarningCount}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(19rem,1fr)] lg:items-start">
        <FollowUpList followUps={dashboard.followUps} now={now} />
        <NextCallCard followUp={dashboard.nextCall} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Needs Follow-up Plan</h2>
          <p className="mt-1 text-sm text-slate-600">
            Active leads without a future, incomplete action.
          </p>
          {dashboard.needsFollowUpPlan.length ? (
            <ul className="mt-4 grid gap-2">
              {dashboard.needsFollowUpPlan.map((booking) => (
                <li key={booking.id}>
                  <Link
                    className="font-semibold text-slate-950 hover:text-orange-700"
                    href={`/bookings/${booking.id}`}
                  >
                    {booking.name}
                  </Link>
                  <span className="ml-2 text-sm capitalize text-slate-600">
                    {booking.status.replaceAll("_", " ")}
                  </span>
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
          {dashboard.upcomingEvents.length ? (
            <ul className="mt-4 grid gap-3">
              {dashboard.upcomingEvents.map((event) => (
                <li className="flex items-center justify-between gap-3" key={event.id}>
                  <Link
                    className="font-semibold text-slate-950 hover:text-orange-700"
                    href={`/bookings/${event.id}`}
                  >
                    {event.name}
                  </Link>
                  <span className="whitespace-nowrap text-sm text-slate-600">
                    {formatDate(event.startsAt)}
                  </span>
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
