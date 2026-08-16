import { useEffect, useState } from "react";
import { ManagerScopedMap } from "@/components/manager/manager-scoped-map";
import { ReportScheduleIssue } from "@/components/manager/report-schedule-issue";
import { useManagerScopedMap } from "@/features/manager/use-manager-scoped-map";
import { useManagerAuth } from "@/lib/manager-auth-context";

type Data = { route: null | { trip: { id: string; name: string; startLabel: string; endLabel: string }; stops: any[]; segments: any[] }; events: any[]; nextEvent: any | null };

export default function ManagerRoutePage() {
  const { managerApi } = useManagerAuth();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [focusedBookingId, setFocusedBookingId] = useState<string | null>(null);
  const map = useManagerScopedMap();

  useEffect(() => {
    managerApi<Data>("/manager/route").then(setData).catch((e) => setError(e.message));
  }, [managerApi]);

  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p>Loading schedule…</p>;

  const scheduledEvents = map.data?.events ?? data.events;

  return (
    <div className="grid gap-4">
      <div>
        <p className="text-sm font-bold uppercase tracking-wider text-orange-700">Official schedule · view only</p>
        <h1 className="text-2xl font-bold">Events & Route</h1>
      </div>

      {map.error ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{map.error}</p> : null}
      {map.data ? (
        <ManagerScopedMap
          data={map.data}
          variant="events"
          focusedBookingId={focusedBookingId}
          onFocusBooking={setFocusedBookingId}
        />
      ) : map.loading ? <p className="text-sm text-slate-500">Loading map…</p> : null}

      {data.route ? (
        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-bold">{data.route.trip.name}</h2>
          <p className="text-sm text-slate-600">{data.route.trip.startLabel} → {data.route.trip.endLabel}</p>
          {data.route.segments.map((segment: any) => (
            <p key={segment.id} className="mt-2 text-sm">{segment.fromLabel} → {segment.toLabel}{segment.overrideMiles ?? segment.miles ? ` · ${segment.overrideMiles ?? segment.miles} mi` : ""}</p>
          ))}
        </section>
      ) : <p>No current or upcoming route.</p>}

      <section className="grid gap-2">
        <h2 className="text-lg font-bold">Scheduled events</h2>
        {scheduledEvents.length ? scheduledEvents.map((event: any) => (
          <button
            key={event.bookingId}
            className={`rounded-xl border bg-white p-4 text-left ${focusedBookingId === event.bookingId ? "ring-2 ring-orange-400" : ""}`}
            onClick={() => setFocusedBookingId(event.bookingId)}
            type="button"
          >
            <h3 className="font-bold">{event.bookingName}</h3>
            <p className="text-sm text-slate-600">{event.city}, {event.region}</p>
            <p className="text-sm">{event.startsAt ? new Date(event.startsAt).toLocaleString() : "Date not set"}</p>
          </button>
        )) : <p>No scheduled events.</p>}
      </section>
      <ReportScheduleIssue tripId={data.route?.trip.id ?? null} />
    </div>
  );
}
