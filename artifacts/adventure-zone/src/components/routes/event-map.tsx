"use client";

import { Link } from "wouter";
import { useEffect, useMemo, useState } from "react";
import { eventMatchesOperationsSeason, operationsDateKey, operationsProfileHref } from '@/features/bookings/operations-navigation';
import { currentOperationsSeason } from '@/features/bookings/select-profile-operations-booking';

import { apiPost } from "@/lib/auth-token";
import type { EquipmentHandoffView } from "@/components/routes/equipment-handoffs";
import {
  filterMapEvents,
  toMapDataset,
  type MapEvent,
  type MapFilters,
  type RouteMappingState,
} from "@/features/routes/map-data";
import {
  classifyRouteBucket,
  routeEmphasis,
  type RouteEmphasis,
  type RouteViewMode,
} from "@/features/routes/route-view";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";
import { primaryViewportEvents, routeScopeSummary, viewportTarget } from "@/features/routes/map-focus";
import { ManagerRouteMapShell } from "./manager-route-map-shell";
import {
  ManagerRouteMapLayers,
  ManagerTripNavigationActions,
  type FocusedTripMapData,
} from "./manager-route-map-layers";

const initialFilters: MapFilters = {
  statuses: [],
  travelLegIds: [],
  dateFrom: null,
  dateTo: null,
  regions: [],
};

function formatLabel(value: string) {
  return value
    .split("_")
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

function eventSeasonYear(event: MapEvent) {
  return event.startsAt && Number.isFinite(event.startsAt.getTime()) ? Number(operationsDateKey(event.startsAt).slice(0, 4)) : null;
}

function mappingReason(state?: RouteMappingState) {
  switch (state) {
    case "needs_mapping_no_results": return "No map result found for this location.";
    case "needs_mapping_provider_unavailable": return "Map lookup is temporarily unavailable.";
    case "needs_mapping_missing_location": return "Add a city/state or event address.";
    default: return "This booking could not be placed on the map yet.";
  }
}

function canRetryMapping(state?: RouteMappingState) {
  return state === "needs_mapping_no_results" || state === "needs_mapping_provider_unavailable";
}

function eventDetailsHref(event: MapEvent, profileBasePath: string) {
  if (event.organizationId) return operationsProfileHref(profileBasePath, event.organizationId, event.id, event.startsAt, event.travelLegId, event.dateOnly);
  return profileBasePath === "/profiles" ? `/bookings/${encodeURIComponent(event.id)}` : null;
}

type PlanningEvent = MapEvent & {
  planningEmphasis: Exclude<RouteEmphasis, "hidden">;
  routeStopNumber: number | null;
};

type UnnumberedPlanningEvent = Omit<PlanningEvent, "routeStopNumber">;

function compareRouteStops(a: MapEvent, b: MapEvent) {
  const timeDifference = (a.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
  return timeDifference || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function addRouteStopNumbers(events: UnnumberedPlanningEvent[]): PlanningEvent[] {
  const confirmedByLeg = new Map<string, UnnumberedPlanningEvent[]>();
  for (const event of events) {
    if (
      event.routeBucket !== "confirmed" ||
      !event.travelLegId ||
      event.latitude === null ||
      event.longitude === null
    ) continue;
    confirmedByLeg.set(event.travelLegId, [...(confirmedByLeg.get(event.travelLegId) ?? []), event]);
  }

  const numberByEventId = new Map<string, number>();
  for (const group of confirmedByLeg.values()) {
    group.sort(compareRouteStops);
    group.forEach((event, index) => numberByEventId.set(event.id, index + 1));
  }

  return events.map((event) => ({
    ...event,
    routeStopNumber: numberByEventId.get(event.id) ?? null,
  }));
}

type RouteLineCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "LineString"; coordinates: [number, number][] };
    properties: { legId: string; color: string; emphasis: "primary" | "dimmed" };
  }>;
};

type HandoffFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: { id: string; label: string; status: EquipmentHandoffView["status"]; band: EquipmentHandoffView["opportunityBand"] };
  }>;
};

function EventRows({
  events,
  unmapped,
  retryingId,
  focusedEventId,
  onRetry,
  onFocus,
  showBookingLinks,
  profileBasePath,
}: {
  events: PlanningEvent[];
  unmapped: boolean;
  retryingId: string | null;
  focusedEventId: string | null;
  onRetry?: (event: PlanningEvent) => void;
  onFocus?: (event: PlanningEvent) => void;
  showBookingLinks: boolean;
  profileBasePath: string;
}) {
  return (
    <ul className="grid gap-2">
      {events.map((event) => (
        <li
          className={`rounded-lg border border-slate-200 p-3 transition ${event.planningEmphasis === "dimmed" ? "opacity-40" : ""}`}
          data-emphasis={event.planningEmphasis}
          key={event.id}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
              {event.routeStopNumber ? (
                <span
                  aria-label={`Stop ${event.routeStopNumber}`}
                  className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-white text-sm font-black text-white shadow"
                  style={{ backgroundColor: event.travelLegColor || "#64748b" }}
                >
                  {event.routeStopNumber}
                </span>
              ) : null}
              <div>
                {showBookingLinks && eventDetailsHref(event, profileBasePath) ? (
                  <Link className="font-bold text-slate-950 hover:text-orange-700" href={eventDetailsHref(event, profileBasePath)!}>
                    {event.name}
                  </Link>
                ) : <span className="font-bold text-slate-950">{event.name}</span>}
                <p className="mt-0.5 text-sm text-slate-600">
                  {[event.city, event.region].filter(Boolean).join(", ")}
                  {event.travelLegName ? ` · ${event.travelLegName}` : ""}
                </p>
                {!event.startsAt ? <p className="text-xs font-semibold text-amber-700">Needs dates</p> : null}
                {!event.travelLegId ? <p className="text-xs font-semibold text-amber-700">Needs leg</p> : null}
                {unmapped ? <p className="text-xs font-semibold text-amber-700">Needs mapping</p> : null}
                {!unmapped && onFocus ? (
                  <button className="button-secondary mt-2" onClick={() => onFocus(event)} type="button">
                    {focusedEventId === event.id ? "Focused on map" : "Focus on map"}
                  </button>
                ) : null}
                {unmapped ? (
                  <div className="mt-1 grid gap-2">
                    <p className="text-xs font-semibold text-amber-700">
                      {event.locationLabel ? `${event.locationLabel} — ` : ""}{mappingReason(event.mappingState)}
                    </p>
                    {canRetryMapping(event.mappingState) && onRetry ? (
                      <button
                        className="button-secondary w-fit"
                        disabled={retryingId === event.id}
                        onClick={() => onRetry(event)}
                        type="button"
                      >
                        {retryingId === event.id ? "Retrying…" : "Retry location"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <span
              className={
                event.routeBucket === "confirmed"
                  ? "rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800"
                  : event.routeBucket === "history"
                    ? "rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700"
                    : "rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800"
              }
            >
              {event.routeBucket === "confirmed" ? "Confirmed" : formatLabel(event.status)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function EventList({
  events,
  title,
  unmapped = false,
  retryingId = null,
  focusedEventId = null,
  onRetry,
  onFocus,
  groupByLeg = false,
  legOrderById,
  showBookingLinks = true,
  profileBasePath,
}: {
  events: PlanningEvent[];
  title: string;
  unmapped?: boolean;
  retryingId?: string | null;
  focusedEventId?: string | null;
  onRetry?: (event: PlanningEvent) => void;
  onFocus?: (event: PlanningEvent) => void;
  groupByLeg?: boolean;
  legOrderById?: ReadonlyMap<string, number>;
  showBookingLinks?: boolean;
  profileBasePath: string;
}) {
  const groups = groupByLeg
    ? [...events.reduce((byLeg, event) => {
        const key = event.travelLegId || "unassigned";
        const current = byLeg.get(key) ?? {
          id: key,
          name: event.travelLegName || "Unassigned",
          color: event.travelLegColor || "#64748b",
          events: [] as PlanningEvent[],
        };
        current.events.push(event);
        byLeg.set(key, current);
        return byLeg;
      }, new Map<string, { id: string; name: string; color: string; events: PlanningEvent[] }>()).values()]
        .sort((a, b) => (
          (legOrderById?.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (legOrderById?.get(b.id) ?? Number.MAX_SAFE_INTEGER)
        ) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        .map((group) => ({ ...group, events: [...group.events].sort(compareRouteStops) }))
    : [{ id: "events", name: null, color: null, events }];

  const content = events.length ? (
    <div className={groupByLeg ? "grid gap-2" : ""}>
      {groups.map((group) => groupByLeg && group.name ? (
        <details
          className="group overflow-hidden rounded-xl border border-slate-200 bg-white"
          data-testid={`route-event-leg-${group.id}`}
          key={group.id}
        >
          <summary className="flex cursor-pointer list-none items-center gap-3 p-3 text-left">
            <span className="size-3 shrink-0 rounded-full border border-slate-900" style={{ backgroundColor: group.color ?? undefined }} />
            <h3 className="min-w-0 flex-1 font-bold text-slate-900">{group.name}</h3>
            <span className="text-xs font-semibold text-slate-500">{group.events.length} event{group.events.length === 1 ? "" : "s"}</span>
            <span aria-hidden="true" className="text-slate-400 transition group-open:rotate-180">⌄</span>
          </summary>
          <div className="border-t border-slate-100 p-3">
            <EventRows events={group.events} unmapped={unmapped} retryingId={retryingId} focusedEventId={focusedEventId} onRetry={onRetry} onFocus={onFocus} showBookingLinks={showBookingLinks} profileBasePath={profileBasePath} />
          </div>
        </details>
      ) : (
        <EventRows key={group.id} events={group.events} unmapped={unmapped} retryingId={retryingId} focusedEventId={focusedEventId} onRetry={onRetry} onFocus={onFocus} showBookingLinks={showBookingLinks} profileBasePath={profileBasePath} />
      ))}
    </div>
  ) : <p className="text-sm text-slate-600">No events in this group.</p>;

  if (unmapped) {
    return (
      <details className="group rounded-xl border border-slate-200 bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <span className="text-sm font-semibold text-slate-500">{events.length} event{events.length === 1 ? "" : "s"} <span aria-hidden="true" className="inline-block transition group-open:rotate-180">⌄</span></span>
        </summary>
        <div className="border-t border-slate-100 p-4">{content}</div>
      </details>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-3">{content}</div>
    </section>
  );
}

export function EventMap({
  events,
  travelLegs,
  handoffs = [],
  focusedTrip = null,
  focusedTripCoordinates = null,
  onClearTripFocus,
  readOnly = false,
  requestedSeasonYear,
  controlledSeasonYear,
  onSeasonYearChange,
  profileBasePath = "/profiles",
}: {
  events: MapEvent[];
  travelLegs: TravelLeg[];
  handoffs?: EquipmentHandoffView[];
  focusedTrip?: FocusedTripMapData | null;
  focusedTripCoordinates?: [number, number][] | null;
  onClearTripFocus?: () => void;
  readOnly?: boolean;
  requestedSeasonYear?: number;
  controlledSeasonYear?: number;
  onSeasonYearChange?: (year: number) => void;
  profileBasePath?: string;
}) {
  const currentYear = currentOperationsSeason();
  const [filters, setFilters] = useState<MapFilters>(initialFilters);
  const [mode, setMode] = useState<RouteViewMode>("full");
  const [localSeasonYear, setLocalSeasonYear] = useState(requestedSeasonYear ?? currentYear);
  const seasonYear = controlledSeasonYear ?? localSeasonYear;
  function setSeasonYear(year: number) {
    if (controlledSeasonYear === undefined) setLocalSeasonYear(year);
    onSeasonYearChange?.(year);
  }
  const [focusedLegId, setFocusedLegId] = useState<string | null>(null);
  const [focusedEventId, setFocusedEventId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [eventOverrides, setEventOverrides] = useState<Record<string, Pick<MapEvent, "latitude" | "longitude" | "mappingState" | "locationQuality" | "locationLabel">>>({});
  const [retryError, setRetryError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (requestedSeasonYear && controlledSeasonYear === undefined) setLocalSeasonYear(requestedSeasonYear);
  }, [requestedSeasonYear, controlledSeasonYear]);

  const effectiveEvents = useMemo(
    () => events.map((event) => Number.isFinite(event.latitude) && Number.isFinite(event.longitude) ? event : ({ ...event, ...eventOverrides[event.id] })),
    [eventOverrides, events],
  );

  async function retryLocation(event: MapEvent) {
    setRetryingId(event.id);
    setRetryError(null);
    try {
      const response = await apiPost<{ event: Omit<MapEvent, "startsAt" | "endsAt" | "reservedStartsAt" | "reservedEndsAt"> & { startsAt: string | Date | null; endsAt: string | Date | null; reservedStartsAt?: string | Date | null; reservedEndsAt?: string | Date | null } }>(
        `/routes/events/${event.id}/retry-location`,
        {},
      );
      const refreshed: MapEvent = {
        ...response.event,
        startsAt: response.event.startsAt ? new Date(response.event.startsAt) : null,
        endsAt: response.event.endsAt ? new Date(response.event.endsAt) : null,
        reservedStartsAt: response.event.reservedStartsAt ? new Date(response.event.reservedStartsAt) : null,
        reservedEndsAt: response.event.reservedEndsAt ? new Date(response.event.reservedEndsAt) : null,
      };
      setEventOverrides((current) => ({ ...current, [event.id]: { latitude: refreshed.latitude, longitude: refreshed.longitude, mappingState: refreshed.mappingState, locationQuality: refreshed.locationQuality, locationLabel: refreshed.locationLabel } }));
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "Could not retry this location.");
    } finally {
      setRetryingId(null);
    }
  }

  const regions = useMemo(
    () => [...new Set(effectiveEvents.map((event) => event.region).filter(Boolean))].sort(),
    [effectiveEvents],
  );

  const seasonYears = useMemo(() => {
    const years = new Set<number>([currentYear, seasonYear]);
    for (const event of effectiveEvents) {
      const year = eventSeasonYear(event);
      if (year !== null) years.add(year);
    }
    for (const handoff of handoffs) years.add(new Date(handoff.windowStartsAt).getFullYear());
    return [...years].sort((a, b) => b - a);
  }, [currentYear, seasonYear, effectiveEvents, handoffs]);

  const filteredEvents = useMemo(
    () => filterMapEvents(effectiveEvents, filters),
    [effectiveEvents, filters],
  );

  const planningEvents = useMemo(() => {
    const result: UnnumberedPlanningEvent[] = [];
    for (const event of filteredEvents) {
      if (!eventMatchesOperationsSeason(event, seasonYear)) continue;
      const bucket = event.routeBucket ?? classifyRouteBucket(event.status, event.probability);
      const emphasis = routeEmphasis({ bucket, mode, eventLegId: event.travelLegId, focusedLegId });
      if (emphasis === "hidden") continue;
      result.push({
        ...event,
        routeBucket: bucket,
        locationLabel: event.locationLabel ?? ([event.city, event.region].filter(Boolean).join(", ") || null),
        locationQuality:
          event.locationQuality ??
          (event.latitude !== null && event.longitude !== null ? "coordinates" : event.city ? "city" : "missing"),
        mappingState:
          event.mappingState ??
          (event.latitude !== null && event.longitude !== null
            ? "mapped_coordinates"
            : event.city || event.region
              ? "needs_mapping_no_results"
              : "needs_mapping_missing_location"),
        seasonYear: eventSeasonYear(event),
        planningEmphasis: emphasis,
      });
    }
    return addRouteStopNumbers(result);
  }, [filteredEvents, focusedLegId, mode, seasonYear]);

  const primaryEvents = useMemo(
    () => primaryViewportEvents(planningEvents, mode, focusedLegId),
    [focusedLegId, mode, planningEvents],
  );

  const currentViewport = useMemo(
    () => viewportTarget({ primaryEvents, explicitEventId: focusedEventId, tripCoordinates: focusedTripCoordinates }),
    [focusedEventId, focusedTripCoordinates, primaryEvents],
  );

  const focusedLegName = focusedLegId
    ? travelLegs.find((leg) => leg.id === focusedLegId)?.name ?? null
    : null;
  const legOrderById = useMemo(
    () => new Map(travelLegs.map((leg) => [leg.id, leg.sortOrder])),
    [travelLegs],
  );
  const scopeSummary = routeScopeSummary({
    mode,
    seasonYear,
    focusedLegName,
    region: filters.regions[0] ?? null,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  });

  function focusLeg(legId: string | null) {
    setFocusedLegId(legId);
    setFocusedEventId(null);
    if (focusedTripCoordinates) onClearTripFocus?.();
  }

  function resetScope() {
    setFilters(initialFilters);
    setMode("full");
    if (controlledSeasonYear === undefined) setSeasonYear(currentYear);
    setFocusedLegId(null);
    setFocusedEventId(null);
    onClearTripFocus?.();
  }

  const activeFilterCount = [
    mode !== "full",
    seasonYear !== currentYear,
    focusedLegId !== null,
    Boolean(filters.regions.length),
    Boolean(filters.dateFrom),
    Boolean(filters.dateTo),
  ].filter(Boolean).length;

  const dataset = useMemo(() => {
    const base = toMapDataset(planningEvents);
    const emphasis = new Map(planningEvents.map((event) => [event.id, event.planningEmphasis]));
    return {
      ...base,
      geoJson: {
        ...base.geoJson,
        features: base.geoJson.features.map((feature) => ({
          ...feature,
          properties: {
            ...feature.properties,
            emphasis: emphasis.get(feature.properties.id) ?? "primary",
          },
        })),
      },
    };
  }, [planningEvents]);

  const mappedIds = useMemo(
    () => new Set(dataset.geoJson.features.map((feature) => feature.properties.id)),
    [dataset.geoJson.features],
  );
  const mappedEvents = planningEvents.filter((event) => mappedIds.has(event.id));
  const unmappedEvents = planningEvents.filter((event) => !mappedIds.has(event.id));

  const routeLines = useMemo<RouteLineCollection>(() => {
    const groups = new Map<string, PlanningEvent[]>();
    for (const event of mappedEvents) {
      if (!event.travelLegId || event.routeBucket !== "confirmed") continue;
      groups.set(event.travelLegId, [...(groups.get(event.travelLegId) ?? []), event]);
    }
    const features: RouteLineCollection["features"] = [];
    for (const [legId, group] of groups) {
      group.sort(compareRouteStops);
      for (let index = 0; index < group.length - 1; index += 1) {
        const from = group[index]!;
        const to = group[index + 1]!;
        if (from.latitude === null || from.longitude === null || to.latitude === null || to.longitude === null) continue;
        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [[from.longitude, from.latitude], [to.longitude, to.latitude]],
          },
          properties: {
            legId,
            color: from.travelLegColor ?? to.travelLegColor ?? "#64748b",
            emphasis: focusedLegId && legId !== focusedLegId ? "dimmed" : "primary",
          },
        });
      }
    }
    return { type: "FeatureCollection", features };
  }, [focusedLegId, mappedEvents]);

  const handoffFeatures = useMemo<HandoffFeatureCollection>(() => ({
    type: "FeatureCollection",
    features: handoffs
      .filter((handoff) => handoff.status !== "dismissed")
      .filter((handoff) => new Date(handoff.windowStartsAt).getFullYear() === seasonYear)
      .map((handoff) => ({
        type: "Feature" as const,
        id: handoff.id,
        geometry: {
          type: "Point" as const,
          coordinates: [handoff.meetupLongitude, handoff.meetupLatitude] as [number, number],
        },
        properties: {
          id: handoff.id,
          label: handoff.meetupLabel,
          status: handoff.status,
          band: handoff.opportunityBand,
        },
      })),
  }), [handoffs, seasonYear]);

  const planningRouteLines = useMemo(
    () => routeLines.features.map((feature) => ({
      coordinates: feature.geometry.coordinates,
      color: feature.properties.color,
      emphasis: feature.properties.emphasis,
    })),
    [routeLines.features],
  );

  return (
    <div className="grid gap-5">
      {retryError ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{retryError}</p> : null}
      {mapError ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{mapError}</p> : null}

      <p aria-live="polite" className="text-sm text-slate-600">
        {primaryEvents.length} primary {primaryEvents.length === 1 ? "event" : "events"} · {mappedEvents.length} mapped · {unmappedEvents.length} needing map location · {handoffFeatures.features.length} equipment meetup {handoffFeatures.features.length === 1 ? "marker" : "markers"}
      </p>
      {planningEvents.length === 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">No matching route events</p>
      ) : null}

      <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-bold text-slate-900">
          <span>Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}</span>
          <span className="text-xs font-normal text-slate-500">{scopeSummary}</span>
        </summary>
        <div className="grid gap-4 border-t border-slate-200 p-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Route view</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["full", "confirmed", "potential", "history"] as RouteViewMode[]).map((value) => (
                <button
                  aria-pressed={mode === value}
                  className={mode === value ? "button-primary px-4" : "button-secondary px-4"}
                  key={value}
                  onClick={() => { setMode(value); setFocusedEventId(null); }}
                  type="button"
                >
                  {value === "full" ? "Full" : formatLabel(value)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-1 text-sm font-semibold">
              Season/year
              <select onChange={(event) => { setSeasonYear(Number(event.target.value)); setFocusedEventId(null); }} value={seasonYear}>
                {seasonYears.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Leg focus
              <select onChange={(event) => focusLeg(event.target.value || null)} value={focusedLegId ?? ""}>
                <option value="">All legs</option>
                {travelLegs.filter((leg) => !leg.archivedAt).map((leg) => (
                  <option key={leg.id} value={leg.id}>{leg.name}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              State
              <select
                onChange={(event) => { setFilters({ ...filters, regions: event.target.value ? [event.target.value] : [] }); setFocusedEventId(null); }}
                value={filters.regions[0] ?? ""}
              >
                <option value="">All states</option>
                {regions.map((region) => <option key={region} value={region}>{region}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              After
              <input
                onChange={(event) => { setFilters({ ...filters, dateFrom: event.target.value || null }); setFocusedEventId(null); }}
                type="date"
                value={filters.dateFrom ?? ""}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Before
              <input
                onChange={(event) => { setFilters({ ...filters, dateTo: event.target.value || null }); setFocusedEventId(null); }}
                type="date"
                value={filters.dateTo ?? ""}
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            {focusedEventId ? <button className="button-secondary" onClick={() => setFocusedEventId(null)} type="button">Clear event focus</button> : null}
            {focusedTripCoordinates ? <button className="button-secondary" onClick={onClearTripFocus} type="button">Clear trip focus</button> : null}
            <button className="button-secondary" onClick={resetScope} type="button">Reset filters</button>
          </div>
        </div>
      </details>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-3 py-3 sm:px-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Focus a route</p>
          <div aria-label="Route legs" className="flex gap-2 overflow-x-auto pb-1" role="group">
            <button
              aria-pressed={focusedLegId === null}
              className="shrink-0 rounded-full border-2 bg-white px-3 py-2 text-sm font-bold text-slate-900"
              onClick={() => focusLeg(null)}
              style={{ borderColor: "#0f172a", boxShadow: focusedLegId === null ? "0 0 0 2px #0f172a" : undefined }}
              type="button"
            >
              All routes
            </button>
            {travelLegs.filter((leg) => !leg.archivedAt).map((leg) => (
              <button
                aria-pressed={focusedLegId === leg.id}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border-2 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                key={leg.id}
                onClick={() => focusLeg(leg.id)}
                style={{ borderColor: leg.color, boxShadow: focusedLegId === leg.id ? `0 0 0 2px ${leg.color}` : undefined }}
                type="button"
              >
                <span className="size-3 rounded-full" style={{ backgroundColor: leg.color }} />
                {leg.name} route
                {focusedLegId === leg.id ? <span aria-hidden="true">✓</span> : null}
              </button>
            ))}
          </div>
        </div>
        <details className="border-b border-slate-200">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-bold text-slate-700">
            <span>Map key</span>
            <span className="text-xs font-normal text-slate-500">Stops, opportunities & handoffs</span>
          </summary>
          <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 px-4 py-3 text-xs font-semibold text-slate-600">
            <span className="inline-flex items-center gap-1.5"><span className="size-5 rounded-full border-2 border-white bg-slate-500 text-center text-[10px] font-black leading-4 text-white ring-1 ring-slate-400">1</span>Confirmed stop</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-slate-500 opacity-70 ring-1 ring-slate-300" />Potential / history</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-full border-2 border-white bg-orange-500 ring-1 ring-orange-300" />Suggested handoff</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-full border-2 border-slate-900 bg-sky-500" />Approved handoff</span>
            <span className="inline-flex items-center gap-1.5 opacity-40"><span className="size-3 rounded-full bg-slate-500" />Other legs dimmed</span>
          </div>
        </details>
        <ManagerRouteMapShell viewport={currentViewport} onTileError={() => setMapError("The map background could not be loaded.")}>
          <ManagerRouteMapLayers
            events={planningEvents}
            handoffs={handoffs.filter((handoff) => new Date(handoff.windowStartsAt).getFullYear() === seasonYear)}
            routeLines={planningRouteLines}
            focusedEventId={focusedEventId}
            managerMode="on-road"
            focusedTrip={focusedTrip}
            onFocusEvent={setFocusedEventId}
            profileBasePath={profileBasePath}
            showBookingDetailsLink
          />
        </ManagerRouteMapShell>
      </div>

      <ManagerTripNavigationActions trip={focusedTrip} mode="on-road" />

      <div className="grid gap-5 xl:grid-cols-2">
        <EventList events={mappedEvents.filter(event => event.startsAt)} title="Route events · travel order" groupByLeg legOrderById={legOrderById} focusedEventId={focusedEventId} onFocus={(event) => setFocusedEventId(event.id)} profileBasePath={profileBasePath} showBookingLinks />
        {mappedEvents.some(event => !event.startsAt) ? <EventList events={mappedEvents.filter(event => !event.startsAt)} title="Dates not recorded" profileBasePath={profileBasePath} showBookingLinks /> : null}
        <EventList
          events={unmappedEvents}
          title="Location needs mapping"
          unmapped
          retryingId={retryingId}
          onRetry={readOnly ? undefined : (event) => { void retryLocation(event); }}
          profileBasePath={profileBasePath}
          showBookingLinks
        />
      </div>
    </div>
  );
}
