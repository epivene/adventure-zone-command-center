import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ManagerScopedMap } from "@/components/manager/manager-scoped-map";
import { NextEventPlanCard } from "@/components/manager/next-event-plan-card";
import { EventLifecycleAction } from "@/components/manager/event-lifecycle-action";
import { EventScheduleWindow } from "@/components/manager/event-schedule-window";
import { ReportScheduleIssue } from "@/components/manager/report-schedule-issue";
import { useManagerScopedMap } from "@/features/manager/use-manager-scoped-map";
import { useManagerAssistant } from "@/features/manager-assistant/manager-assistant-context";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { ResponsiveDetailSheet } from "@/components/navigation/responsive-detail-sheet";
import type { ManagerDashboardResponse } from "@workspace/api-zod";

type Data = Pick<ManagerDashboardResponse, "route" | "events" | "nextEvent">;
type Incomplete = { bookingId: string };

export default function ManagerRoutePage() {
  const { managerApi } = useManagerAuth();
  const { setActiveContext } = useManagerAssistant();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [focusedBookingId, setFocusedBookingId] = useState<string | null>(null);
  const [detailBookingId, setDetailBookingId] = useState<string | null>(null);
  const [incompleteIds, setIncompleteIds] = useState<Set<string>>(new Set());
  const map = useManagerScopedMap();

  useEffect(() => {
    managerApi<Data>("/manager/route").then(setData).catch((e) => setError(e.message));
    managerApi<{ lifecycles?: Incomplete[] }>("/manager/events/lifecycle/incomplete")
      .then((result) => setIncompleteIds(new Set((result.lifecycles ?? []).map((item) => item.bookingId))))
      .catch(() => setIncompleteIds(new Set()));
  }, [managerApi]);

  useEffect(() => {
    if (detailBookingId) {
      const event = (map.data?.events ?? data?.events ?? []).find((row) => row.bookingId === detailBookingId);
      setActiveContext({ kind: "booking", recordId: detailBookingId, label: event?.bookingName ?? "Event" });
      return () => setActiveContext(null);
    }
    if (data?.route?.trip.id) {
      setActiveContext({ kind: "route", recordId: data.route.trip.id, label: data.route.trip.name });
      return () => setActiveContext(null);
    }
    setActiveContext(null);
    return undefined;
  }, [data?.route?.trip.id, data?.route?.trip.name, detailBookingId, map.data?.events, data?.events, setActiveContext]);

  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p>Loading schedule…</p>;

  const scheduledEvents = map.data?.events ?? data.events;
  const nextEvent = data.nextEvent;
  const detailEvent = scheduledEvents.find((event) => event.bookingId === detailBookingId) ?? null;
  const canLoadLifecycle = detailEvent && !["declined", "cancelled"].includes(String(detailEvent.status));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-sm font-bold uppercase tracking-wider text-orange-700">Official schedule · view only</p><h1 className="text-2xl font-bold">Schedule</h1><p className="mt-1 text-sm text-slate-600">Route first, details when you tap a stop.</p></div>
        <Link className="button-secondary" href="/manager/messages?meetup=1">Request meetup / equipment swap</Link>
      </div>

      {map.error ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{map.error}</p> : null}
      {map.data ? <div className="min-h-[44dvh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><ManagerScopedMap data={map.data} variant="events" focusedBookingId={focusedBookingId} onFocusBooking={(bookingId) => { setFocusedBookingId(bookingId); setDetailBookingId(bookingId); }} /></div> : map.loading ? <p className="text-sm text-slate-500">Loading map…</p> : null}

      {nextEvent ? <NextEventPlanCard event={nextEvent} route={data.route} onSelect={() => { setFocusedBookingId(nextEvent.bookingId); setDetailBookingId(nextEvent.bookingId); }} /> : null}

      {data.route ? <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-bold">Route details · {data.route.trip.name}</summary><p className="mt-2 text-sm text-slate-600">{data.route.trip.startLabel} → {data.route.trip.endLabel}</p><div className="mt-3 grid gap-1">{data.route.segments.map((segment: any) => <p key={segment.id} className="text-sm">{segment.fromLabel} → {segment.toLabel}{segment.overrideMiles ?? segment.miles ? ` · ${segment.overrideMiles ?? segment.miles} mi` : ""}</p>)}</div></details> : <p>No current or upcoming route.</p>}

      <section className="grid gap-2">
        <h2 className="text-lg font-bold">Scheduled events</h2>
        {scheduledEvents.length ? scheduledEvents.map((event) => <button key={event.bookingId} className={`rounded-xl border bg-white p-4 text-left ${focusedBookingId === event.bookingId ? "ring-2 ring-orange-400" : ""}`} onClick={() => { setFocusedBookingId(event.bookingId); setDetailBookingId(event.bookingId); }} type="button"><div className="flex items-start justify-between gap-2"><h3 className="font-bold">{event.bookingName}</h3>{incompleteIds.has(event.bookingId) ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">Wrap-up incomplete</span> : null}</div><p className="text-sm text-slate-600">{event.city}, {event.region}</p><EventScheduleWindow startsAt={event.startsAt} endsAt={event.endsAt} operationalStartsAt={event.operationalStartsAt} operationalEndsAt={event.operationalEndsAt} className="mt-1 grid gap-0.5 text-sm text-slate-700" /></button>) : <p>No scheduled events.</p>}
      </section>

      <ReportScheduleIssue tripId={data.route?.trip.id ?? null} />

      <ResponsiveDetailSheet open={Boolean(detailEvent)} onOpenChange={(open) => { if (!open) setDetailBookingId(null); }} title={detailEvent?.bookingName ?? "Event"}>
        {detailEvent ? <div className="grid gap-4">
          <section className="rounded-xl border border-slate-200 p-4"><h2 className="font-bold">Event details</h2><p className="mt-2 text-sm text-slate-700">{[detailEvent.city, detailEvent.region].filter(Boolean).join(", ") || "Location not set"}</p><EventScheduleWindow startsAt={detailEvent.startsAt} endsAt={detailEvent.endsAt} operationalStartsAt={detailEvent.operationalStartsAt} operationalEndsAt={detailEvent.operationalEndsAt} className="mt-1 grid gap-0.5 text-sm text-slate-800" />{canLoadLifecycle ? <div className="mt-4 border-t pt-3"><EventLifecycleAction bookingId={detailEvent.bookingId} allowCheckIn={detailEvent.status === "confirmed"} checkoutDueAt={detailEvent.operationalEndsAt ?? null} onChanged={(next) => { if (next.wrapUpStatus === "incomplete") setIncompleteIds((current) => new Set(current).add(detailEvent.bookingId)); }} /></div> : null}</section>
          <section className="rounded-xl border border-slate-200 p-4"><h2 className="font-bold">Schedule changes</h2><p className="mt-1 text-sm text-slate-600">The official booking is read-only here. Report anything that needs corrected.</p><div className="mt-3"><ReportScheduleIssue tripId={data.route?.trip.id ?? null} /></div></section>
        </div> : null}
      </ResponsiveDetailSheet>
    </div>
  );
}
