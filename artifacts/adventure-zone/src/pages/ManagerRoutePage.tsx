import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ManagerScopedMap } from "@/components/manager/manager-scoped-map";
import { ReportScheduleIssue } from "@/components/manager/report-schedule-issue";
import { useManagerScopedMap } from "@/features/manager/use-manager-scoped-map";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { ResponsiveDetailSheet } from "@/components/navigation/responsive-detail-sheet";

type Data = { route: null | { trip: { id: string; name: string; startLabel: string; endLabel: string }; stops: any[]; segments: any[] }; events: any[]; nextEvent: any | null };

export default function ManagerRoutePage() {
  const { managerApi } = useManagerAuth();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [focusedBookingId, setFocusedBookingId] = useState<string | null>(null);
  const [detailBookingId, setDetailBookingId] = useState<string | null>(null);
  const map = useManagerScopedMap();

  useEffect(() => {
    managerApi<Data>("/manager/route").then(setData).catch((e) => setError(e.message));
  }, [managerApi]);

  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p>Loading schedule…</p>;

  const scheduledEvents = map.data?.events ?? data.events;
  const detailEvent = useMemo(() => scheduledEvents.find((event: any) => event.bookingId === detailBookingId) ?? null, [scheduledEvents, detailBookingId]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-sm font-bold uppercase tracking-wider text-orange-700">Official schedule · view only</p><h1 className="text-2xl font-bold">Schedule</h1><p className="mt-1 text-sm text-slate-600">Route first, details when you tap a stop.</p></div>
        <Link className="button-secondary" href="/manager/messages?meetup=1">Request meetup / equipment swap</Link>
      </div>

      {map.error ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{map.error}</p> : null}
      {map.data ? <div className="min-h-[44dvh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><ManagerScopedMap data={map.data} variant="events" focusedBookingId={focusedBookingId} onFocusBooking={(bookingId) => { setFocusedBookingId(bookingId); setDetailBookingId(bookingId); }} /></div> : map.loading ? <p className="text-sm text-slate-500">Loading map…</p> : null}

      {data.nextEvent ? <button type="button" className="rounded-2xl border border-orange-200 bg-orange-50 p-4 text-left shadow-sm" onClick={() => { setFocusedBookingId(data.nextEvent.bookingId); setDetailBookingId(data.nextEvent.bookingId); }}><p className="text-xs font-bold uppercase tracking-wide text-orange-800">Next stop</p><h2 className="mt-1 font-bold">{data.nextEvent.bookingName}</h2><p className="text-sm text-slate-700">{[data.nextEvent.city, data.nextEvent.region].filter(Boolean).join(", ")}</p></button> : null}

      {data.route ? <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-bold">Route details · {data.route.trip.name}</summary><p className="mt-2 text-sm text-slate-600">{data.route.trip.startLabel} → {data.route.trip.endLabel}</p><div className="mt-3 grid gap-1">{data.route.segments.map((segment: any) => <p key={segment.id} className="text-sm">{segment.fromLabel} → {segment.toLabel}{segment.overrideMiles ?? segment.miles ? ` · ${segment.overrideMiles ?? segment.miles} mi` : ""}</p>)}</div></details> : <p>No current or upcoming route.</p>}

      <section className="grid gap-2">
        <h2 className="text-lg font-bold">Scheduled events</h2>
        {scheduledEvents.length ? scheduledEvents.map((event: any) => <button key={event.bookingId} className={`rounded-xl border bg-white p-4 text-left ${focusedBookingId === event.bookingId ? "ring-2 ring-orange-400" : ""}`} onClick={() => { setFocusedBookingId(event.bookingId); setDetailBookingId(event.bookingId); }} type="button"><h3 className="font-bold">{event.bookingName}</h3><p className="text-sm text-slate-600">{event.city}, {event.region}</p><p className="text-sm">{event.startsAt ? new Date(event.startsAt).toLocaleString() : "Date not set"}</p></button>) : <p>No scheduled events.</p>}
      </section>

      <ReportScheduleIssue tripId={data.route?.trip.id ?? null} />

      <ResponsiveDetailSheet open={Boolean(detailEvent)} onOpenChange={(open) => { if (!open) setDetailBookingId(null); }} title={detailEvent?.bookingName ?? "Event"}>
        {detailEvent ? <div className="grid gap-4">
          <section className="rounded-xl border border-slate-200 p-4"><h2 className="font-bold">Event details</h2><p className="mt-2 text-sm text-slate-700">{[detailEvent.city, detailEvent.region].filter(Boolean).join(", ") || "Location not set"}</p><p className="text-sm text-slate-700">{detailEvent.startsAt ? new Date(detailEvent.startsAt).toLocaleString() : "Date not set"}</p>{detailEvent.address ? <p className="mt-2 text-sm text-slate-700">{detailEvent.address}</p> : null}</section>
          <section className="rounded-xl border border-slate-200 p-4"><h2 className="font-bold">Schedule changes</h2><p className="mt-1 text-sm text-slate-600">The official booking is read-only here. Report anything that needs corrected.</p><div className="mt-3"><ReportScheduleIssue tripId={data.route?.trip.id ?? null} /></div></section>
        </div> : null}
      </ResponsiveDetailSheet>
    </div>
  );
}
