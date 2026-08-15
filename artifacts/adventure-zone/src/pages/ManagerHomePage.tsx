import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useManagerAuth } from "@/lib/manager-auth-context";

type NextEvent = {
  bookingName?: string | null;
  city?: string | null;
  region?: string | null;
  startsAt?: string | null;
};

type RouteSummary = { nextEvent?: NextEvent | null };

function formatEventDate(value?: string | null) {
  if (!value) return "Date not set";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const destinations = [
  { href: "/manager/route", title: "Events & Route", detail: "Official schedule, stops, and route issues" },
  { href: "/manager/money", title: "Money", detail: "Income, expenses, cash, and settlement" },
  { href: "/manager/receipts", title: "Receipts", detail: "Receipt photos and missing-receipt follow-up" },
  { href: "/manager/crew", title: "Crew", detail: "Seasonal workers, history, and rehire notes" },
  { href: "/manager/reviews", title: "Reviews & Incidents", detail: "Post-event reviews and incident follow-up" },
  { href: "/manager/operations", title: "Operations", detail: "Mileage, RV parks, food, and maintenance" },
];

export default function ManagerHomePage() {
  const { manager, managerApi } = useManagerAuth();
  const [reviewsDue, setReviewsDue] = useState(0);
  const [nextEvent, setNextEvent] = useState<NextEvent | null>(null);

  useEffect(() => {
    managerApi<{ reviewsDue?: unknown[] }>("/manager/reviews/due")
      .then((data) => setReviewsDue(data.reviewsDue?.length ?? 0))
      .catch(() => setReviewsDue(0));
  }, [managerApi]);

  useEffect(() => {
    managerApi<RouteSummary>("/manager/route")
      .then((data) => setNextEvent(data.nextEvent ?? null))
      .catch(() => setNextEvent(null));
  }, [managerApi]);

  const location = [nextEvent?.city, nextEvent?.region].filter(Boolean).join(", ");

  return (
    <div className="grid gap-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-wider text-orange-700">Manager dashboard</p>
        <h1 className="text-2xl font-bold">{manager?.legName}</h1>
        <p className="mt-1 text-sm text-slate-600">What needs attention right now for this leg.</p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Next event</p>
            {nextEvent ? (
              <>
                <h2 className="mt-1 text-lg font-bold">{nextEvent.bookingName || "Upcoming event"}</h2>
                <p className="mt-1 text-sm text-slate-600">{location || "Location not set"}</p>
                <p className="text-sm text-slate-600">{formatEventDate(nextEvent.startsAt)}</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-600">No upcoming event is currently assigned.</p>
            )}
          </div>
          <Link className="button-primary shrink-0" href="/manager/route">Events & Route</Link>
        </div>
      </section>

      {reviewsDue > 0 ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="font-bold">{reviewsDue} {reviewsDue === 1 ? "event still needs" : "events still need"} a review</h2>
          <p className="mt-1 text-sm text-amber-900">Finish post-event notes while the details are still fresh.</p>
          <Link href="/manager/reviews" className="button-primary mt-3 inline-flex">Complete reviews</Link>
        </section>
      ) : null}

      <section>
        <h2 className="text-lg font-bold">Your leg</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {destinations.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange-300 hover:bg-orange-50">
              <span className="font-bold text-slate-950">{item.title}</span>
              <span className="mt-1 block text-sm text-slate-600">{item.detail}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-bold">Quick actions</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Link className="button-secondary text-center" href="/manager/receipts">Add receipt</Link>
          <Link className="button-secondary text-center" href="/manager/money">Add expense</Link>
          <Link className="button-secondary text-center" href="/manager/operations">Log mileage</Link>
          <Link className="button-secondary text-center" href="/manager/incidents/new">Report incident</Link>
        </div>
      </section>
    </div>
  );
}
