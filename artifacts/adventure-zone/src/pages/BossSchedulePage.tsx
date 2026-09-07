import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { bossGet, bossPatch, bossPut } from "@/lib/boss-auth-context";
import type { BossBooking, BossSchedule, ScheduleLeg } from "@/lib/boss-types";
import { EventCalendar, type CalendarEvent } from "@/components/calendar/event-calendar";
import { EventMap } from "@/components/routes/event-map";
import { RouteConflictWarning } from "@/components/routes/route-conflict-warning";
import { ScheduleViewToggle, type ScheduleView } from "@/components/schedule/schedule-view-toggle";
import { asScheduleCalendarEvent, isBookedForSchedule } from "@/features/calendar/schedule-booking-state";
import type { MapEvent } from "@/features/routes/map-data";
import { findSameLegDateConflicts } from "@/features/routes/route-conflicts";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";

function LegCard({ leg, allLegs, onChanged }: { leg: ScheduleLeg; allLegs: ScheduleLeg[]; onChanged(): Promise<void> }) {
  const stops = leg.stops ?? [];
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(leg.name ?? "");
  const [baseAddress, setBaseAddress] = useState(leg.baseAddress ?? "");
  const [vehicle, setVehicle] = useState(leg.defaultVehicleName ?? "");
  const [mpg, setMpg] = useState(leg.defaultMpg == null ? "" : String(leg.defaultMpg));
  const [saving, setSaving] = useState(false);
  const [movingBookingId, setMovingBookingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function reassignBooking(bookingId: string, travelLegId: string) {
    if (!travelLegId || travelLegId === leg.id) return;
    setMovingBookingId(bookingId);
    setError("");
    try {
      await bossPut(`/boss/bookings/${bookingId}/leg`, { travelLegId });
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reassign event.");
    } finally {
      setMovingBookingId(null);
    }
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await bossPatch(`/boss/legs/${leg.id}`, {
        name: name.trim(),
        baseAddress: baseAddress.trim() || null,
        defaultVehicleName: vehicle.trim() || null,
        defaultMpg: mpg ? Number(mpg) : null,
      });
      setEditing(false);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save leg.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchived() {
    setSaving(true);
    setError("");
    try {
      await bossPatch(`/boss/legs/${leg.id}`, {
        archivedAt: leg.archivedAt ? null : new Date().toISOString(),
      });
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update leg.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
      data-testid={`leg-card-${leg.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold text-foreground">{leg.name ?? `Leg ${leg.id}`}</p>
          {leg.startDate || leg.endDate ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {leg.startDate ? new Date(leg.startDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}
              {leg.startDate && leg.endDate ? " – " : ""}
              {leg.endDate ? new Date(leg.endDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : ""}
            </p>
          ) : null}
        </div>
        <Badge variant="outline" className="capitalize">{leg.archivedAt ? "Archived" : "Active"}</Badge>
      </div>

      {editing ? (
        <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold text-foreground">Leg name<Input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="grid gap-1 text-sm font-semibold text-foreground">Vehicle<Input value={vehicle} onChange={(event) => setVehicle(event.target.value)} /></label>
          <label className="grid gap-1 text-sm font-semibold text-foreground sm:col-span-2">Base address<Input value={baseAddress} onChange={(event) => setBaseAddress(event.target.value)} /></label>
          <label className="grid gap-1 text-sm font-semibold text-foreground">Default MPG<Input inputMode="decimal" value={mpg} onChange={(event) => setMpg(event.target.value)} /></label>
          <div className="flex items-end gap-2">
            <Button size="sm" disabled={saving || !name.trim() || (mpg !== "" && (!Number.isFinite(Number(mpg)) || Number(mpg) <= 0))} onClick={() => void save()}>Save leg</Button>
            <Button size="sm" variant="outline" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {leg.route ? (
        <p className="mt-2 text-sm text-muted-foreground">{leg.route}</p>
      ) : null}

      {stops.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Stops ({stops.length})
          </p>
          <ol className="grid gap-1.5">
            {stops.map((stop, idx) => (
              <li
                key={stop.id}
                className="flex items-start gap-2 text-sm"
                data-testid={`stop-${stop.id}`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {idx + 1}
                </span>
                <div>
                  <span className="font-semibold text-foreground">{stop.name ?? stop.city ?? `Stop ${idx + 1}`}</span>
                  {stop.city || stop.region ? (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {[stop.city, stop.region].filter(Boolean).join(", ")}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {leg.bookings?.length ? (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Events assigned by Desie</p>
          <div className="grid gap-2">
            {leg.bookings.map((booking) => (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2" key={booking.id}>
                <div>
                  <p className="text-sm font-semibold text-foreground">{booking.name ?? "Event"}</p>
                  {booking.startsAt ? <p className="text-xs text-muted-foreground">{new Date(booking.startsAt).toLocaleDateString()}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  {booking.status ? <Badge variant="outline" className="capitalize">{booking.status}</Badge> : null}
                  <label className="sr-only" htmlFor={`booking-leg-${booking.id}`}>Reassign {booking.name ?? "event"}</label>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                    disabled={movingBookingId === booking.id}
                    id={`booking-leg-${booking.id}`}
                    onChange={(event) => void reassignBooking(booking.id, event.target.value)}
                    value={leg.id}
                  >
                    {allLegs.filter((candidate) => !candidate.archivedAt).map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>{candidate.name ?? "Unnamed leg"}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : <p className="mt-3 text-xs text-muted-foreground">No events have been assigned to this leg by Desie.</p>}
      {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
      <div className="mt-3 flex gap-2 border-t border-border pt-3">
        <Button size="sm" variant="outline" disabled={saving} onClick={() => setEditing((value) => !value)} data-testid={`button-leg-edit-${leg.id}`}>Edit leg</Button>
        <Button size="sm" variant="outline" disabled={saving} onClick={() => void toggleArchived()} data-testid={`button-leg-archive-${leg.id}`}>
          {leg.archivedAt ? "Restore leg" : "Archive leg"}
        </Button>
      </div>
    </section>
  );
}

function asMapEvent(booking: BossBooking): MapEvent {
  return {
    id: booking.id,
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
              <EventCalendar colors={schedule?.displaySettings} events={calendarEvents} initialMonth={activeMonth} onMonthChange={setActiveMonth} readOnly />
            </section>
          ) : (
            <section aria-labelledby="boss-event-map-title" className="grid gap-4">
              <div>
                <h2 className="text-xl font-bold" id="boss-event-map-title">Route Map</h2>
                <p className="mt-1 text-sm text-slate-600">Confirmed and potential route context across the selected season and leg.</p>
              </div>
              <RouteConflictWarning conflicts={routeConflicts} readOnly />
              <EventMap events={scopedEvents} readOnly requestedSeasonYear={Number(season)} travelLegs={travelLegs} />
            </section>
          )}

          <details className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <summary className="cursor-pointer text-sm font-bold uppercase tracking-wide text-muted-foreground">Manage legs ({schedule?.legs.length ?? 0})</summary>
            <div className="mt-4 grid gap-3">
              {(schedule?.legs ?? []).length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center" data-testid="legs-empty"><p className="text-sm text-muted-foreground">No legs in the schedule yet.</p></div>
              ) : (schedule?.legs ?? []).map((leg) => <LegCard key={leg.id} leg={leg} allLegs={schedule?.legs ?? []} onChanged={load} />)}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
