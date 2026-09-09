import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Plus } from "lucide-react";
import { useManagerAssistant } from "@/features/manager-assistant/manager-assistant-context";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { EventLifecycleAction } from "@/components/manager/event-lifecycle-action";
import { EventScheduleWindow } from "@/components/manager/event-schedule-window";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@workspace/avz-crm/components/ui/dropdown-menu";
import type { ManagerDashboardResponse } from "@workspace/api-zod";

type ManagerDashboard = ManagerDashboardResponse;
type NextEvent = ManagerDashboardResponse["events"][number];
type CurrentLifecycle = NonNullable<ManagerDashboardResponse["currentLifecycle"]>;

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
  const [dashboard, setDashboard] = useState<ManagerDashboard | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    setDashboard(null);
    setLoadError("");
    managerApi<ManagerDashboard>("/manager/dashboard")
      .then((data) => { if (active) setDashboard(data); })
      .catch((error) => { if (active) setLoadError(error instanceof Error ? error.message : "Could not load your manager dashboard"); });
    return () => { active = false; };
  }, [managerApi]);

  useEffect(() => () => setActiveContext(null), [setActiveContext]);

  const bookedEvents = dashboard?.events ?? [];
  const currentLifecycle = dashboard?.currentLifecycle ?? null;
  const incompleteWrapUps = dashboard?.incompleteWrapUps ?? [];
  const money = dashboard?.money ?? null;
  const reviewsDue = dashboard?.summary?.reviewsDueCount ?? dashboard?.reviewsDue?.length ?? 0;
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

  if (!dashboard && !loadError) return <p>Loading your manager dashboard…</p>;

  return (
    <div className="grid gap-4">
      <header className="flex items-end justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wider text-orange-700">Home</p><h1 className="text-2xl font-bold">{manager?.legName}</h1><p className="mt-1 text-sm text-slate-600">What you need right now for this leg.</p></div>
        <QuickAddMenu />
      </header>

      {loadError ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">Could not load your manager dashboard: {loadError}</p> : null}
      {dashboard?.partialErrors?.length ? <section role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-bold">Some dashboard details are unavailable.</p><ul className="mt-1 list-disc pl-5">{dashboard.partialErrors.map((item) => <li key={item.section}>{item.message}</li>)}</ul></section> : null}

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
            {currentMapEvent ? <EventScheduleWindow startsAt={currentMapEvent.startsAt} endsAt={currentMapEvent.endsAt} operationalStartsAt={currentMapEvent.operationalStartsAt} operationalEndsAt={currentMapEvent.operationalEndsAt} className="mt-1 grid gap-0.5 text-sm text-slate-800" /> : null}
            <div className="mt-3"><EventLifecycleAction bookingId={currentEvent.bookingId} /></div>
            <div className="mt-3 flex flex-wrap gap-2"><Link className="button-primary inline-flex" href={`/manager/events/${currentEvent.bookingId}/wrap-up#site-check`}>Event notes / site check</Link><Link className="button-secondary inline-flex" href="/manager/route">Open Schedule</Link><button className="button-secondary" type="button" onClick={() => askAboutEvent(currentEvent, "Current event")}>Ask Assistant</button></div>
          </div>
        </section>

        {nextEvent ? <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Up Next</p>
          <h2 className="mt-2 text-lg font-bold">{nextEvent.bookingName || "Upcoming event"}</h2>
          <p className="mt-1 text-sm text-slate-600">{[nextEvent.city, nextEvent.region].filter(Boolean).join(", ") || "Location not set"}</p>
          <EventScheduleWindow startsAt={nextEvent.startsAt} endsAt={nextEvent.endsAt} operationalStartsAt={nextEvent.operationalStartsAt} operationalEndsAt={nextEvent.operationalEndsAt} className="mt-1 grid gap-0.5 text-sm text-slate-700" />
          <div className="mt-3 flex flex-wrap gap-2"><Link className="button-secondary inline-flex" href="/manager/route">Open Schedule</Link><button className="button-secondary" type="button" onClick={() => askAboutEvent(nextEvent, "Next event")}>Ask Assistant</button></div>
        </section> : null}
      </> : <section className="rounded-2xl border border-orange-200 bg-orange-50 p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wider text-orange-800">Next Stop</p>
         {nextEvent ? <div className="mt-2"><h2 className="text-xl font-bold">{nextEvent.bookingName || "Upcoming event"}</h2><p className="mt-1 text-sm text-slate-700">{[nextEvent.city, nextEvent.region].filter(Boolean).join(", ") || "Location not set"}</p><EventScheduleWindow startsAt={nextEvent.startsAt} endsAt={nextEvent.endsAt} operationalStartsAt={nextEvent.operationalStartsAt} operationalEndsAt={nextEvent.operationalEndsAt} className="mt-1 grid gap-0.5 text-sm text-slate-800" /><div className="mt-3"><EventLifecycleAction bookingId={nextEvent.bookingId} allowCheckIn={nextEvent.status === "confirmed"} /></div><div className="mt-3 flex flex-wrap gap-2"><Link className="button-secondary inline-flex" href="/manager/route">Open Schedule</Link><button className="button-secondary" type="button" onClick={() => askAboutEvent(nextEvent, "Next event")}>Ask Assistant</button></div></div> : <p className="mt-2 text-sm text-slate-700">No upcoming booked event is currently assigned.</p>}
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
