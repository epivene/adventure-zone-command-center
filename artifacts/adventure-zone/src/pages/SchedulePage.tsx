import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { CalendarContent } from "./CalendarPage";
import { RoutesContent } from "./RoutesPage";
import { ScheduleViewToggle, type ScheduleView } from "@/components/schedule/schedule-view-toggle";

type Leg = { id: string; name: string; archivedAt?: string | null };

export default function SchedulePage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const initialView: ScheduleView = params.get("view") === "map" ? "map" : "calendar";
  const [view, setView] = useState<ScheduleView>(initialView);
  const [season, setSeason] = useState(params.get("season") ?? String(new Date().getFullYear()));
  const [legId, setLegId] = useState(params.get("leg") ?? "");
  const [status, setStatus] = useState(params.get("status") ?? "all");
  const [legs, setLegs] = useState<Leg[]>([]);

  useEffect(() => {
    apiGet<any>("/routes").then((data) => setLegs((data.travelLegs ?? []).filter((leg: Leg) => !leg.archivedAt))).catch(() => setLegs([]));
  }, []);

  function syncUrl(next: { view?: ScheduleView; season?: string; legId?: string; status?: string }) {
    const nextView = next.view ?? view;
    const nextSeason = next.season ?? season;
    const nextLeg = next.legId ?? legId;
    const nextStatus = next.status ?? status;
    const query = new URLSearchParams();
    if (nextView !== "calendar") query.set("view", nextView);
    if (nextSeason) query.set("season", nextSeason);
    if (nextLeg) query.set("leg", nextLeg);
    if (nextStatus !== "all") query.set("status", nextStatus);
    const value = query.toString();
    setLocation(value ? `/schedule?${value}` : "/schedule", { replace: true });
  }

  function changeView(next: ScheduleView) { setView(next); syncUrl({ view: next }); }

  return (
    <div className="mx-auto grid max-w-7xl gap-5">
      <header className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Schedule</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Calendar & Route</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">One workspace for event dates and the route they create.</p>
        </div>
        <ScheduleViewToggle view={view} onChange={changeView} />
      </header>

      <section aria-label="Schedule filters" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3">
        <label className="grid gap-1 text-sm font-semibold">Season
          <select aria-label="Season" value={season} onChange={(event) => { setSeason(event.target.value); syncUrl({ season: event.target.value }); }}>
            {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1, new Date().getFullYear() + 2].map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
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
      </section>

      {view === "calendar" ? <CalendarContent embedded legId={legId || undefined} season={season} status={status} /> : <RoutesContent embedded legId={legId || undefined} season={season} status={status} />}
    </div>
  );
}
