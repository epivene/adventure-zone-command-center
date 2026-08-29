import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Plus } from "lucide-react";
import { useManagerAssistant } from "@/features/manager-assistant/manager-assistant-context";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { EventLifecycleAction } from "@/components/manager/event-lifecycle-action";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@workspace/avz-crm/components/ui/dropdown-menu";
import { isBookedForSchedule } from "@/features/calendar/schedule-booking-state";

type NextEvent = { bookingId: string; bookingName?: string | null; city?: string | null; region?: string | null; startsAt?: string | null; endsAt?: string | null; status?: string | null; probability?: string | null };
type ManagerMapSummary = { events?: NextEvent[] };
type CurrentLifecycle = { bookingId: string; bookingName?: string | null; city?: string | null; region?: string | null; checkedInAt?: string | null; checkedOutAt?: string | null };
type IncompleteWrapUp = { bookingId: string; bookingName?: string | null; city?: string | null; region?: string | null; checkedOutAt?: string | null };
type MoneySummary = { expenseTotalCents?: number; cashPosition?: { cashOnHandCents?: number } };

function formatEventDate(value?: string | null) {
  if (!value) return "Date not set";
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatEventRange(startsAt?: string | null, endsAt?: string | null) {
  if (!startsAt) return "Date not set";
  if (!endsAt || endsAt === startsAt) return formatEventDate(startsAt);
  return `${formatEventDate(startsAt)} → ${formatEventDate(endsAt)}`;
}

function QuickAddMenu() {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><button className="button-primary inline-flex items-center gap-2" type="button"><Plus className="h-4 w-4" />Add</button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-52">
      <DropdownMenuItem asChild><Link href="/manager/receipts">Receipt</Link></DropdownMenuItem>
      <DropdownMenuItem asChild><Link href="/manager/money">Expense / income</Link></DropdownMenuItem>
      <DropdownMenuItem asChild><Link href="/manager/operations">Mileage</Link></DropdownMenuItem>
      <DropdownMenuItem asChild><Link href="/manager/route">Schedule issue</Link></DropdownMenuItem>
      <DropdownMenuItem asChild><Link href="/manager/incidents/new">Incident</Link></DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

export default function ManagerHomePage() {
  const { manager, managerApi } = useManagerAuth();
  const { setActiveContext, openAssistant } = useManagerAssistant();
  const [reviewsDue, setReviewsDue] = useState(0);
  const [bookedEvents, setBookedEvents] = useState<NextEvent[]>([]);
  const [currentLifecycle, setCurrentLifecycle] = useState<CurrentLifecycle | null>(null);
  const [incompleteWrapUps, setIncompleteWrapUps] = useState<IncompleteWrapUp[]>([]);
  const [money, setMoney] = useState<MoneySummary | null>(null);

  useEffect(() => {
    managerApi<{ reviewsDue?: unknown[] }>("/manager/reviews/due").then((data) => setReviewsDue(data.reviewsDue?.length ?? 0)).catch(() => setReviewsDue(0));
    managerApi<ManagerMapSummary>("/manager/map").then((data) => setBookedEvents((data.events ?? []).filter(isBookedForSchedule))).catch(() => setBookedEvents([]));
    managerApi<{ lifecycle?: CurrentLifecycle | null }>("/manager/events/lifecycle/current").then((data) => setCurrentLifecycle(data.lifecycle ?? null)).catch(() => setCurrentLifecycle(null));
    managerApi<{ lifecycles?: IncompleteWrapUp[] }>("/manager/events/lifecycle/incomplete").then((data) => setIncompleteWrapUps(data.lifecycles ?? [])).catch(() => setIncompleteWrapUps([]));
    managerApi<MoneySummary>("/manager/money/summary").then(setMoney).catch(() => setMoney(null));
  }, [managerApi]);

  useEffect(() => () => setActiveContext(null), [setActiveContext]);

  const currentMapEvent = currentLifecycle ? bookedEvents.find((event) => event.bookingId === currentLifecycle.bookingId) ?? null : null;
  const currentEvent = currentLifecycle ? { ...currentMapEvent, ...currentLifecycle } : null;
  const nextEvent = bookedEvents.find((event) => event.bookingId !== currentLifecycle?.bookingId) ?? null;
  const cashOnHand = money?.cashPosition?.cashOnHandCents != null ? money.cashPosition.cashOnHandCents / 100 : null;
  const expenseTotal = money?.expenseTotalCents != null ? money.expenseTotalCents / 100 : null;

  function askAboutEvent(event: NextEvent | CurrentLifecycle, label: string) {
    if (!event.bookingId) return;
    setActiveContext({ kind: "booking", recordId: event.bookingId, label: event.bookingName ?? label });
    openAssistant("What do I need to know for this event?");
  }

  return (
    <div className="grid gap-4">
      <header className="flex items-end justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wider text-orange-700">Home</p><h1 className="text-2xl font-bold">{manager?.legName}</h1><p className="mt-1 text-sm text-slate-600">What you need right now for this leg.</p></div>
        <QuickAddMenu />
      </header>

      {incompleteWrapUps.length ? <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-800">Finish event wrap-up</p>
        <div className="mt-2 grid gap-2">{incompleteWrapUps.map((item) => <Link key={item.bookingId} href={`/manager/events/${item.bookingId}/wrap-up`} className="rounded-xl border border-amber-200 bg-white p-3"><p className="font-bold">{item.bookingName || "Event wrap-up"}</p><p className="text-sm text-slate-600">{[item.city, item.region].filter(Boolean).join(", ") || "Location not set"}</p><p className="mt-1 text-sm font-semibold text-amber-800">Wrap-up incomplete</p></Link>)}</div>
      </section> : null}

      {currentEvent ? <>
        <section className="rounded-2xl border border-orange-200 bg-orange-50 p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-orange-800">Current Event</p>
          <div className="mt-2">
            <h2 className="text-xl font-bold">{currentEvent.bookingName || "Current event"}</h2>
            <p className="mt-1 text-sm text-slate-700">{[currentEvent.city, currentEvent.region].filter(Boolean).join(", ") || "Location not set"}</p>
            {currentMapEvent ? <p className="mt-1 text-sm font-semibold text-slate-800">{formatEventRange(currentMapEvent.startsAt, currentMapEvent.endsAt)}</p> : null}
            <div className="mt-3"><EventLifecycleAction bookingId={currentEvent.bookingId} /></div>
            <div className="mt-3 flex flex-wrap gap-2"><Link className="button-primary inline-flex" href={`/manager/events/${currentEvent.bookingId}/wrap-up#site-check`}>Event notes / site check</Link><Link className="button-secondary inline-flex" href="/manager/route">Open Schedule</Link><button className="button-secondary" type="button" onClick={() => askAboutEvent(currentEvent, "Current event")}>Ask Assistant</button></div>
          </div>
        </section>

        {nextEvent ? <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Up Next</p>
          <h2 className="mt-2 text-lg font-bold">{nextEvent.bookingName || "Upcoming event"}</h2>
          <p className="mt-1 text-sm text-slate-600">{[nextEvent.city, nextEvent.region].filter(Boolean).join(", ") || "Location not set"}</p>
          <p className="text-sm font-semibold text-slate-700">{formatEventRange(nextEvent.startsAt, nextEvent.endsAt)}</p>
          <div className="mt-3 flex flex-wrap gap-2"><Link className="button-secondary inline-flex" href="/manager/route">Open Schedule</Link><button className="button-secondary" type="button" onClick={() => askAboutEvent(nextEvent, "Next event")}>Ask Assistant</button></div>
        </section> : null}
      </> : <section className="rounded-2xl border border-orange-200 bg-orange-50 p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wider text-orange-800">Next Stop</p>
         {nextEvent ? <div className="mt-2"><h2 className="text-xl font-bold">{nextEvent.bookingName || "Upcoming event"}</h2><p className="mt-1 text-sm text-slate-700">{[nextEvent.city, nextEvent.region].filter(Boolean).join(", ") || "Location not set"}</p><p className="text-sm font-semibold text-slate-800">{formatEventRange(nextEvent.startsAt, nextEvent.endsAt)}</p><div className="mt-3"><EventLifecycleAction bookingId={nextEvent.bookingId} allowCheckIn={nextEvent.status === "confirmed"} /></div><div className="mt-3 flex flex-wrap gap-2"><Link className="button-secondary inline-flex" href="/manager/route">Open Schedule</Link><button className="button-secondary" type="button" onClick={() => askAboutEvent(nextEvent, "Next event")}>Ask Assistant</button></div></div> : <p className="mt-2 text-sm text-slate-700">No upcoming booked event is currently assigned.</p>}
      </section>}

      {(cashOnHand != null || expenseTotal != null) ? <section className="grid grid-cols-2 gap-3">
        {cashOnHand != null ? <Link href="/manager/money" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Cash on hand</p><p className="mt-1 text-xl font-bold">${cashOnHand.toFixed(2)}</p></Link> : null}
        {expenseTotal != null ? <Link href="/manager/money" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Expenses</p><p className="mt-1 text-xl font-bold">${expenseTotal.toFixed(2)}</p></Link> : null}
      </section> : null}

      {reviewsDue > 0 ? <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><h2 className="font-bold">Needs Attention</h2><p className="mt-1 text-sm text-amber-900">{reviewsDue} {reviewsDue === 1 ? "event still needs" : "events still need"} a review.</p><Link href="/manager/reviews" className="button-secondary mt-3 inline-flex">Complete reviews</Link></section> : null}

      <section className="grid grid-cols-3 gap-2">
        <Link className="rounded-xl border border-slate-200 bg-white p-3 text-center text-sm font-semibold shadow-sm" href="/manager/receipts">Receipts</Link>
        <Link className="rounded-xl border border-slate-200 bg-white p-3 text-center text-sm font-semibold shadow-sm" href="/manager/operations">Mileage</Link>
        <Link className="rounded-xl border border-slate-200 bg-white p-3 text-center text-sm font-semibold shadow-sm" href="/manager/crew">Crew</Link>
      </section>
    </div>
  );
}
