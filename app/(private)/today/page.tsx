import Link from "next/link";

import { FollowUpList } from "@/components/today/follow-up-list";
import { NextCallCard } from "@/components/today/next-call-card";
import { SummaryCards } from "@/components/today/summary-cards";
import { BookingOperations } from "@/components/today/booking-operations";
import { getTodayDashboard } from "@/features/follow-ups/today-query";
import { createBookingOperationsSummaryProvider } from "@/features/bookings/booking-operations-summary";
import { requireOwner } from "@/lib/auth/require-owner";
import { BUSINESS_TIME_ZONE } from "@/lib/business-date";

export const dynamic = "force-dynamic";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(value);
}

async function loadDashboard(
  now: Date,
  pages: { followUps: number; needsFollowUpPlan: number },
) {
  await requireOwner();
  const { db } = await import("@/db/client");
  return getTodayDashboard(
    now,
    null,
    pages,
    createBookingOperationsSummaryProvider(db),
  );
}

function positivePage(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  const page = Number(candidate);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function todayHref(followUpsPage: number, planPage: number) {
  const query = new URLSearchParams();
  if (followUpsPage > 1) query.set("followUpsPage", String(followUpsPage));
  if (planPage > 1) query.set("planPage", String(planPage));
  const serialized = query.toString();
  return serialized ? `/today?${serialized}` : "/today";
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{
    followUpsPage?: string | string[];
    planPage?: string | string[];
  }>;
}) {
  const now = new Date();
  const query = await searchParams;
  const requestedFollowUpPage = positivePage(query.followUpsPage);
  const requestedPlanPage = positivePage(query.planPage);
  const dashboard = await loadDashboard(now, {
    followUps: requestedFollowUpPage,
    needsFollowUpPlan: requestedPlanPage,
  });

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
        visibleRouteWarningCount={dashboard.visibleRouteWarningCount}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(19rem,1fr)] lg:items-start">
        <div className="grid gap-3">
          <FollowUpList followUps={dashboard.followUps} now={now} />
          {dashboard.followUpPageCount > 1 ? (
            <nav
              aria-label="Follow-up pages"
              className="flex items-center justify-between text-sm"
            >
              <span>
                Page {dashboard.followUpPage} of {dashboard.followUpPageCount}
              </span>
              <div className="flex gap-3">
                {dashboard.followUpPage > 1 ? (
                  <Link
                    className="link"
                    href={todayHref(
                      dashboard.followUpPage - 1,
                      dashboard.needsFollowUpPlanPage,
                    )}
                  >
                    Previous follow-ups
                  </Link>
                ) : null}
                {dashboard.followUpPage < dashboard.followUpPageCount ? (
                  <Link
                    className="link"
                    href={todayHref(
                      dashboard.followUpPage + 1,
                      dashboard.needsFollowUpPlanPage,
                    )}
                  >
                    Next follow-ups
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}
        </div>
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
                  <BookingOperations operations={booking.operations} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-600">Every active lead has a future action.</p>
          )}
          {dashboard.needsFollowUpPlanPageCount > 1 ? (
            <nav
              aria-label="Follow-up plan pages"
              className="mt-4 flex items-center justify-between gap-3 text-sm"
            >
              <span>
                Page {dashboard.needsFollowUpPlanPage} of{" "}
                {dashboard.needsFollowUpPlanPageCount}
              </span>
              <div className="flex gap-3">
                {dashboard.needsFollowUpPlanPage > 1 ? (
                  <Link
                    className="link"
                    href={todayHref(
                      dashboard.followUpPage,
                      dashboard.needsFollowUpPlanPage - 1,
                    )}
                  >
                    Previous plans
                  </Link>
                ) : null}
                {dashboard.needsFollowUpPlanPage <
                dashboard.needsFollowUpPlanPageCount ? (
                  <Link
                    className="link"
                    href={todayHref(
                      dashboard.followUpPage,
                      dashboard.needsFollowUpPlanPage + 1,
                    )}
                  >
                    Next plans
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Upcoming events</h2>
          <p className="mt-1 text-sm text-slate-600">The next five dated bookings.</p>
          {dashboard.upcomingEvents.length ? (
            <ul className="mt-4 grid gap-3">
              {dashboard.upcomingEvents.map((event) => (
                <li className="flex items-start justify-between gap-3" key={event.id}>
                  <div>
                    <Link
                      className="font-semibold text-slate-950 hover:text-orange-700"
                      href={`/bookings/${event.id}`}
                    >
                      {event.name}
                    </Link>
                    <BookingOperations operations={event.operations} />
                  </div>
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
