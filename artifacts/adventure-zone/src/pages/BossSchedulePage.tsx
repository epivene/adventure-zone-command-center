import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { RefreshCw } from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { bossGet } from "@/lib/boss-auth-context";
import type { BossBooking, BossSchedule, ScheduleLeg } from "@/lib/boss-types";
import { EventCalendar, type CalendarEvent } from "@/components/calendar/event-calendar";
import { EventMap } from "@/components/routes/event-map";
import { RouteConflictWarning } from "@/components/routes/route-conflict-warning";
import { ScheduleViewToggle, type ScheduleView } from "@/components/schedule/schedule-view-toggle";
import { asScheduleCalendarEvent, isBookedForSchedule } from "@/features/calendar/schedule-booking-state";
import type { MapEvent } from "@/features/routes/map-data";
import { findSameLegDateConflicts } from "@/features/routes/route-conflicts";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";

function LegCard({ leg }: { leg: ScheduleLeg }) {
  const stops = leg.stops ?? [];
  const bookings = leg.bookings ?? [];
  const legName = leg.name ?? `Leg ${leg.id}`;
  const dateLabel = leg.startDate || leg.endDate
    ? [
        leg.startDate ? new Date(leg.startDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null,
        leg.endDate ? new Date(leg.endDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null,
      ].filter(Boolean).join(" – ")
    : null;

  return (
    <details
      className="group overflow-hidden rounded-xl border border-slate-200 bg-white"
      data-testid={`leg-card-${leg.id}`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 text-left">
        <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: leg.color ?? "#64748b" }} />
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-slate-900">{legName}</span>
          <span className="mt-0.5 block text-sm text-slate-600">
            {leg.archivedAt ? "Archived" : "Active"}
            {leg.defaultVehicleName ? ` · ${leg.defaultVehicleName}` : ""}
            {` · ${bookings.length} event${bookings.length === 1 ? "" : "s"}`}
          </span>
        </span>
        <span aria-hidden="true" className="text-slate-400 transition group-open:rotate-180">⌄</span>
      </summary>

      <div className="grid gap-4 border-t border-slate-100 p-4">
        {dateLabel || leg.route ? (
          <div>
            {dateLabel ? <p className="text-sm font-semibold text-slate-700">{dateLabel}</p> : null}
            {leg.route ? <p className="mt-1 text-sm text-slate-600">{leg.route}</p> : null}
          </div>
        ) : null}

        <div className="grid gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-3">
          <div><p className="text-xs font-bold uppercase text-slate-500">Base address</p><p className="mt-1 text-slate-800">{leg.baseAddress || "Not set"}</p></div>
          <div><p className="text-xs font-bold uppercase text-slate-500">Vehicle</p><p className="mt-1 text-slate-800">{leg.defaultVehicleName || "Not set"}</p></div>
          <div><p className="text-xs font-bold uppercase text-slate-500">MPG</p><p className="mt-1 text-slate-800">{leg.defaultMpg ?? "Not set"}</p></div>
        </div>

        {stops.length ? (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Stops ({stops.length})</p>
            <ol className="grid gap-2">
              {stops.map((stop, index) => (
                <li className="flex items-start gap-2 text-sm" data-testid={`stop-${stop.id}`} key={stop.id}>
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-black text-white" style={{ backgroundColor: leg.color ?? "#64748b" }}>{index + 1}</span>
                  <span><span className="font-semibold text-slate-900">{stop.name ?? stop.city ?? `Stop ${index + 1}`}</span>{stop.city || stop.region ? <span className="ml-1.5 text-slate-500">{[stop.city, stop.region].filter(Boolean).join(", ")}</span> : null}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Events assigned by Desie ({bookings.length})</p>
          {bookings.length ? (
            <div className="grid gap-2">
              {bookings.map((booking) => (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2" key={booking.id}>
                  <div>{booking.organizationId ? <Link className="text-sm font-semibold text-slate-900 hover:text-orange-700" href={`/boss/profiles/${encodeURIComponent(booking.organizationId)}`}>{booking.name ?? "Event"}</Link> : <p className="text-sm font-semibold text-slate-900">{booking.name ?? "Event"}</p>}{booking.startsAt ? <p className="text-xs text-slate-500">{new Date(booking.startsAt).toLocaleDateString()}</p> : null}</div>
                  {booking.status ? <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold capitalize text-slate-700">{booking.status.replaceAll("_", " ")}</span> : null}
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-slate-500">No events are assigned to this leg.</p>}
        </div>
      </div>
    </details>
  );
}

function asMapEvent(booking: BossBooking): MapEvent {
  return {
    id: booking.id,
    organizationId: booking.organizationId ?? booking.organization?.id ?? null,
    name: booking.name ?? "Event",
    city: booking.city ?? "",
    region: booking.region ?? "",
    latitude: booking.latitude ?? null,
    longitude: booking.longitude ?? null,
    status: (booking.status ?? "new_lead") as MapEvent["status"],
    probability: booking.probability ?? "possible",
    travelLegId: booking.travelLegId ?? null,
    travelLegName: booking.travelLegName ?? booking.legName ?? null,
    travelLegColor: booking.travelLegColor ?? null,
    travelLegAssignmentKind: booking.travelLegAssignmentKind ?? null,
    legAssignmentWarning: booking.legAssignmentWarning ?? null,
    legAssignmentExplanation: booking.legAssignmentExplanation ?? null,
    routeBucket: booking.routeBucket,
    locationQuality: booking.locationQuality,
    locationLabel: booking.locationLabel ?? null,
    mappingState: booking.mappingState,
    seasonYear: booking.seasonYear ?? null,
    startsAt: booking.startsAt ? new Date(booking.startsAt) : null,
    endsAt: booking.endsAt ? new Date(booking.endsAt) : null,
  };
}

function asTravelLeg(leg: ScheduleLeg, index: number): TravelLeg {
  return {
    id: leg.id,
    name: leg.name ?? `Leg ${index + 1}`,
    color: leg.color ?? "#64748b",
    sortOrder: leg.sortOrder ?? index + 1,
    archivedAt: leg.archivedAt ? new Date(leg.archivedAt) : null,
    baseAddress: leg.baseAddress ?? null,
    defaultVehicleName: leg.defaultVehicleName ?? null,
    defaultMpg: leg.defaultMpg ?? null,
  };
}

export default function BossSchedulePage() {
  const currentYear = String(new Date().getFullYear());
  const [schedule, setSchedule] = useState<BossSchedule | null>(null);
  const [view, setView] = useState<ScheduleView>("calendar");
  const [season, setSeason] = useState(currentYear);
  const [legId, setLegId] = useState("");
  const [status, setStatus] = useState("all");
  const [showPotential, setShowPotential] = useState(false);
  const [activeMonth, setActiveMonth] = useState(`${currentYear}-${String(new Date().getMonth() + 1).padStart(2, "0")}`);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await bossGet<{ legs: ScheduleLeg[]; bookings?: BossBooking[]; displaySettings?: BossSchedule["displaySettings"] }>("/boss/legs");
      setSchedule({
        legs: Array.isArray(data.legs) ? data.legs : [],
        bookings: Array.isArray(data.bookings) ? data.bookings : [],
        displaySettings: data.displaySettings,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load schedule.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const mapEvents = useMemo(() => (schedule?.bookings ?? []).map(asMapEvent), [schedule?.bookings]);
  const travelLegs = useMemo(() => (schedule?.legs ?? []).map(asTravelLeg), [schedule?.legs]);
  const activeLegs = travelLegs.filter((leg) => !leg.archivedAt);
  const scopedEvents = useMemo(() => mapEvents.filter((event) => {
    if (legId && event.travelLegId !== legId) return false;
    if (status !== "all") {
      if (status === "confirmed" ? !isBookedForSchedule(event) : event.status !== status) return false;
    }
    if (event.startsAt && String(event.startsAt.getFullYear()) !== season) return false;
    return true;
  }), [legId, mapEvents, season, status]);
  const potentialCount = scopedEvents.filter((event) => !isBookedForSchedule(event)).length;
  const routeConflicts = useMemo(() => findSameLegDateConflicts(scopedEvents), [scopedEvents]);
  const extraFilterCount = Number(Boolean(legId)) + Number(status !== "all");
  const calendarEvents = useMemo(() => {
    const visible = status !== "all" || showPotential
      ? scopedEvents
      : scopedEvents.filter((event) => isBookedForSchedule(event));
    return visible.map((event) => asScheduleCalendarEvent(event)) as CalendarEvent[];
  }, [scopedEvents, showPotential, status]);

  function changeSeason(nextSeason: string) {
    setSeason(nextSeason);
    const nextMonth = nextSeason === currentYear
      ? `${currentYear}-${String(new Date().getMonth() + 1).padStart(2, "0")}`
      : `${nextSeason}-01`;
    setActiveMonth(nextMonth);
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-4" data-testid="boss-schedule-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Schedule</h1>
        <ScheduleViewToggle view={view} onChange={setView} />
      </header>

      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <span>Season</span>
            <select aria-label="Season" className="min-h-9 py-1" value={season} onChange={(event) => changeSeason(event.target.value)}>
              {[Number(currentYear) - 1, Number(currentYear), Number(currentYear) + 1, Number(currentYear) + 2].map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <details className="group ml-auto">
            <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Filters
              {extraFilterCount ? <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-800">{extraFilterCount}</span> : null}
              <span className="text-slate-400 group-open:rotate-180">⌄</span>
            </summary>
            <div className="mt-2 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-semibold">Leg
                <select aria-label="Leg" value={legId} onChange={(event) => setLegId(event.target.value)}>
                  <option value="">All legs</option>
                  {activeLegs.map((leg) => <option key={leg.id} value={leg.id}>{leg.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-semibold">Status
                <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="possible">Possible</option>
                  <option value="pending_decision">Pending decision</option>
                  <option value="pending_contract">Pending contract</option>
                </select>
              </label>
            </div>
          </details>
        </div>
        {extraFilterCount ? (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
            {legId ? <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{activeLegs.find((leg) => leg.id === legId)?.name ?? "Selected leg"}</span> : null}
            {status !== "all" ? <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold capitalize text-slate-700">{status.replaceAll("_", " ")}</span> : null}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert">
          <span className="text-destructive">{error}</span>
          <Button onClick={() => void load()} variant="outline" size="sm" className="ml-3"><RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry</Button>
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-3">{[1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
      ) : (
        <>
          {view === "calendar" ? (
            <section className="grid gap-3">
              {status === "all" && potentialCount > 0 ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${showPotential ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`} onClick={() => setShowPotential((value) => !value)} type="button">
                    {showPotential ? "Hide potential" : `Show potential (${potentialCount})`}
                  </button>
                </div>
              ) : null}
              <EventCalendar colors={schedule?.displaySettings} events={calendarEvents} initialMonth={activeMonth} onMonthChange={setActiveMonth} profileBasePath="/boss/profiles" readOnly />
            </section>
          ) : (
            <section aria-labelledby="boss-event-map-title" className="grid gap-4">
              <div>
                <h2 className="text-xl font-bold" id="boss-event-map-title">Route Map</h2>
                <p className="mt-1 text-sm text-slate-600">Confirmed and potential route context across the selected season and leg.</p>
              </div>
              <RouteConflictWarning conflicts={routeConflicts} readOnly />
              <EventMap events={scopedEvents} profileBasePath="/boss/profiles" readOnly requestedSeasonYear={Number(season)} travelLegs={travelLegs} />
            </section>
          )}

          <details className="group rounded-xl border border-slate-200 bg-white shadow-sm" data-testid="boss-travel-legs">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">Legs &amp; operations</p>
                <h2 className="mt-1 text-xl font-bold text-slate-900">Managers &amp; travel legs</h2>
              </div>
              <span className="shrink-0 text-sm font-semibold text-slate-500">{schedule?.legs.length ?? 0} legs <span aria-hidden="true" className="inline-block transition group-open:rotate-180">⌄</span></span>
            </summary>
            <div className="grid gap-3 border-t border-slate-100 p-4">
              <p className="text-sm text-slate-600">Open a leg to view its route defaults, stops, and assigned events.</p>
              {(schedule?.legs ?? []).length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center" data-testid="legs-empty"><p className="text-sm text-slate-500">No legs in the schedule yet.</p></div>
              ) : (schedule?.legs ?? []).map((leg) => <LegCard key={leg.id} leg={leg} />)}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
