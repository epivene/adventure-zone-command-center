import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { CalendarContent } from "./CalendarPage";
import { RoutesContent } from "./RoutesPage";
import { ScheduleViewToggle, type ScheduleView } from "@/components/schedule/schedule-view-toggle";
import { currentOperationsSeason } from '@/features/bookings/select-profile-operations-booking';
import { BookingLegOperationsCard } from '@/components/bookings/leg-operations-panel';
import { ownerOperationsClient } from '@/features/bookings/booking-leg-operations-client';

type Leg = { id: string; name: string; archivedAt?: string | null };

export default function SchedulePage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const initialView: ScheduleView = params.get("view") === "map" ? "map" : "calendar";
  const [view, setView] = useState<ScheduleView>(initialView);
  const [season, setSeason] = useState(params.get("season") ?? String(currentOperationsSeason()));
  const [legId, setLegId] = useState(params.get("leg") ?? "");
  const [status, setStatus] = useState(params.get("status") ?? "all");
  const [legs, setLegs] = useState<Leg[]>([]);
  useEffect(() => {
    const next = new URLSearchParams(search);
    setView(next.get('view') === 'map' ? 'map' : 'calendar');
    setSeason(/^\d{4}$/.test(next.get('season') ?? '') ? next.get('season')! : String(currentOperationsSeason()));
    setLegId(next.get('leg') ?? '');
    setStatus(next.get('status') ?? 'all');
  }, [search]);

  useEffect(() => {
    apiGet<any>("/routes").then((data) => setLegs((data.travelLegs ?? []).filter((leg: Leg) => !leg.archivedAt))).catch(() => setLegs([]));
  }, []);

  function syncUrl(next: { view?: ScheduleView; season?: string; legId?: string; status?: string }) {
    const nextView = next.view ?? view;
    const nextSeason = next.season ?? season;
    const nextLeg = next.legId ?? legId;
    const nextStatus = next.status ?? status;
    const query = new URLSearchParams(search);
    query.delete('view'); query.delete('season'); query.delete('leg'); query.delete('status');
    if (nextView !== "calendar") query.set("view", nextView);
    if (nextSeason) query.set("season", nextSeason);
    if (nextLeg) query.set("leg", nextLeg);
    if (nextStatus !== "all") query.set("status", nextStatus);
    const value = query.toString();
    setLocation(value ? `/schedule?${value}` : "/schedule", { replace: true });
  }

  function changeView(next: ScheduleView) {
    setView(next);
    syncUrl({ view: next });
  }

  function handleCalendarMonthChange(month: string) {
    const visibleSeason = month.slice(0, 4);
    if (!/^\d{4}$/.test(visibleSeason) || visibleSeason === season) return;
    setSeason(visibleSeason);
    syncUrl({ season: visibleSeason });
  }

  const extraFilterCount = Number(Boolean(legId)) + Number(status !== "all");

  return (
    <div className="mx-auto grid max-w-7xl gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Schedule & Routes</h1>
        <ScheduleViewToggle view={view} onChange={changeView} />
      </header>
      <nav aria-label="Schedule tools" className="flex flex-wrap gap-2">
        <Link className="button-secondary" href="/operations/legs">Leg management</Link>
        <Link className="button-secondary" href="/settings/packages-resources">Equipment & capacity</Link>
        <button className="button-secondary" type="button" onClick={() => changeView("map")}>Trips & routes</button>
      </nav>
      <p className="text-xs text-muted-foreground">Missing dates and unverified assignments are unknown capacity. Check the saved leg and resource plans before promising availability.</p>
      {params.get('bookingId') ? <BookingLegOperationsCard bookingId={params.get('bookingId')!} role="owner" client={ownerOperationsClient}/> : null}

      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <span>Season</span>
            <select aria-label="Season" className="min-h-9 py-1" value={season} onChange={(event) => { setSeason(event.target.value); syncUrl({ season: event.target.value }); }}>
              {[...new Set([Number(season), currentOperationsSeason() - 1, currentOperationsSeason(), currentOperationsSeason() + 1, currentOperationsSeason() + 2])].sort((a,b) => a-b).map((year) => <option key={year} value={year}>{year}</option>)}
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
                <select aria-label="Leg" value={legId} onChange={(event) => { setLegId(event.target.value); syncUrl({ legId: event.target.value }); }}>
                  <option value="">All legs</option>
                  {legs.map((leg) => <option key={leg.id} value={leg.id}>{leg.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-semibold">Status
                <select aria-label="Status" value={status} onChange={(event) => { setStatus(event.target.value); syncUrl({ status: event.target.value }); }}>
                  <option value="all">All statuses</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="tentative">Tentative</option>
                  <option value="pending">Pending</option>
                </select>
              </label>
            </div>
          </details>
        </div>
        {extraFilterCount ? <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">{legId ? <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{legs.find((leg) => leg.id === legId)?.name ?? "Selected leg"}</span> : null}{status !== "all" ? <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold capitalize text-slate-700">{status}</span> : null}</div> : null}
      </div>

      {view === "calendar" ? <CalendarContent embedded legId={legId || undefined} season={season} status={status} onVisibleMonthChange={handleCalendarMonthChange} /> : <RoutesContent embedded bookingId={params.get("bookingId") ?? undefined} onLegFocusChange={id => { setLegId(id ?? ""); syncUrl({legId: id ?? ""}); }} legId={legId || undefined} season={season} status={status} onSeasonYearChange={year => { setSeason(String(year)); syncUrl({ season: String(year) }); }} />}
    </div>
  );
}
