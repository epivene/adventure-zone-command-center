"use client";

import { Link } from "wouter";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
} from "maplibre-gl";

import { apiPost } from "@/lib/auth-token";
import { MapFiltersPanel } from "@/components/routes/map-filters";
import type { EquipmentHandoffView } from "@/components/routes/equipment-handoffs";
import {
  filterMapEvents,
  toMapDataset,
  type MapEvent,
  type MapFeatureCollection,
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

export const DEFAULT_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export function resolveMapStyle(configured?: string) {
  const trimmed = configured?.trim();
  return trimmed || DEFAULT_MAP_STYLE_URL;
}

type StyleReadyMap = {
  isStyleLoaded: () => boolean;
  on: (event: "styledata", handler: () => void) => unknown;
};

export function installMapOverlaysWhenStyleReady(map: StyleReadyMap, install: () => void) {
  if (map.isStyleLoaded()) {
    install();
    return;
  }
  const installWhenLoaded = () => {
    if (map.isStyleLoaded()) install();
  };
  map.on("styledata", installWhenLoaded);
}

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
  return event.seasonYear ?? event.startsAt?.getUTCFullYear() ?? null;
}

function mappingReason(state?: RouteMappingState) {
  switch (state) {
    case "needs_mapping_no_results":
      return "No map result found for this location.";
    case "needs_mapping_provider_unavailable":
      return "Map lookup is temporarily unavailable.";
    case "needs_mapping_missing_location":
      return "Add a city/state or event address.";
    default:
      return "This booking could not be placed on the map yet.";
  }
}

function canRetryMapping(state?: RouteMappingState) {
  return state === "needs_mapping_no_results" || state === "needs_mapping_provider_unavailable";
}

type PlanningEvent = MapEvent & {
  planningEmphasis: Exclude<RouteEmphasis, "hidden">;
};

type RouteLineCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "LineString"; coordinates: [number, number][] };
    properties: {
      legId: string;
      color: string;
      emphasis: "primary" | "dimmed";
    };
  }>;
};

type HandoffFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: {
      id: string;
      label: string;
      status: EquipmentHandoffView["status"];
      band: EquipmentHandoffView["opportunityBand"];
    };
  }>;
};

export function visibleMapCoordinates(
  geoJson: MapFeatureCollection,
  handoffs: HandoffFeatureCollection,
): [number, number][] {
  return [
    ...geoJson.features.map((feature) => feature.geometry.coordinates),
    ...handoffs.features.map((feature) => feature.geometry.coordinates),
  ];
}

export function viewportMode(coordinates: [number, number][]) {
  if (coordinates.length === 0) return { kind: "none" as const };
  if (coordinates.length === 1) {
    return { kind: "center" as const, center: coordinates[0]!, zoom: 10 };
  }
  return { kind: "bounds" as const, coordinates };
}

function MapCanvas({
  geoJson,
  routeLines,
  handoffs,
  onError,
}: {
  geoJson: MapFeatureCollection;
  routeLines: RouteLineCollection;
  handoffs: HandoffFeatureCollection;
  onError?: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const eventDataRef = useRef(geoJson);
  const routeDataRef = useRef(routeLines);
  const handoffDataRef = useRef(handoffs);
  const fitVisibleRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!containerRef.current || !("WebGLRenderingContext" in window)) return;
    let cancelled = false;

    void import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        center: [-98.5, 39.5],
        zoom: 3,
        style: resolveMapStyle(import.meta.env.VITE_MAP_STYLE_URL),
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.on("error", () => {
        onError?.("The map background could not be loaded.");
      });

      const fitVisibleData = () => {
        const coordinates = visibleMapCoordinates(eventDataRef.current, handoffDataRef.current);
        const viewport = viewportMode(coordinates);
        if (viewport.kind === "none") return;
        if (viewport.kind === "center") {
          map.easeTo({ center: viewport.center, zoom: viewport.zoom, duration: 0 });
          return;
        }
        const first = viewport.coordinates[0]!;
        const bounds = new maplibregl.LngLatBounds(first, first);
        for (const coordinate of viewport.coordinates.slice(1)) bounds.extend(coordinate);
        map.fitBounds(bounds, { padding: 48, maxZoom: 10, duration: 0 });
      };
      fitVisibleRef.current = fitVisibleData;

      const installLayers = () => {
        if (cancelled) return;
        if (map.getSource("events")) {
          fitVisibleData();
          return;
        }

        map.addSource("route-lines", { type: "geojson", data: routeDataRef.current });
        map.addLayer({
          id: "route-lines",
          type: "line",
          source: "route-lines",
          paint: {
            "line-color": ["coalesce", ["get", "color"], "#64748b"],
            "line-width": ["case", ["==", ["get", "emphasis"], "dimmed"], 2, 4],
            "line-opacity": ["case", ["==", ["get", "emphasis"], "dimmed"], 0.18, 0.72],
          },
        });

        map.addSource("events", { type: "geojson", data: eventDataRef.current });
        map.addLayer({
          id: "non-confirmed-events",
          type: "circle",
          source: "events",
          filter: ["!=", ["get", "status"], "confirmed"],
          paint: {
            "circle-color": ["coalesce", ["get", "travelLegColor"], "#64748b"],
            "circle-opacity": ["case", ["==", ["get", "emphasis"], "dimmed"], 0.2, 0.72],
            "circle-radius": 7,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1,
          },
        });
        map.addLayer({
          id: "confirmed-events",
          type: "circle",
          source: "events",
          filter: ["==", ["get", "status"], "confirmed"],
          paint: {
            "circle-color": ["coalesce", ["get", "travelLegColor"], "#64748b"],
            "circle-opacity": ["case", ["==", ["get", "emphasis"], "dimmed"], 0.22, 1],
            "circle-radius": ["case", ["==", ["get", "emphasis"], "dimmed"], 7, 9],
            "circle-stroke-color": "#0f172a",
            "circle-stroke-width": 2,
          },
        });

        map.addSource("handoffs", { type: "geojson", data: handoffDataRef.current });
        map.addLayer({
          id: "suggested-handoffs",
          type: "circle",
          source: "handoffs",
          filter: ["!=", ["get", "status"], "approved"],
          paint: {
            "circle-color": "#f97316",
            "circle-radius": 10,
            "circle-opacity": 0.82,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 3,
          },
        });
        map.addLayer({
          id: "approved-handoffs",
          type: "circle",
          source: "handoffs",
          filter: ["==", ["get", "status"], "approved"],
          paint: {
            "circle-color": "#0ea5e9",
            "circle-radius": 11,
            "circle-opacity": 1,
            "circle-stroke-color": "#0f172a",
            "circle-stroke-width": 3,
          },
        });
        fitVisibleData();
      };

      installMapOverlaysWhenStyleReady(map as unknown as StyleReadyMap, installLayers);
    });

    return () => {
      cancelled = true;
      fitVisibleRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [onError]);

  useEffect(() => {
    eventDataRef.current = geoJson;
    const source = mapRef.current?.getSource("events") as GeoJSONSource | undefined;
    source?.setData(geoJson);
    if (source) fitVisibleRef.current?.();
  }, [geoJson]);

  useEffect(() => {
    routeDataRef.current = routeLines;
    const source = mapRef.current?.getSource("route-lines") as GeoJSONSource | undefined;
    source?.setData(routeLines as any);
  }, [routeLines]);

  useEffect(() => {
    handoffDataRef.current = handoffs;
    const source = mapRef.current?.getSource("handoffs") as GeoJSONSource | undefined;
    source?.setData(handoffs as any);
    if (source) fitVisibleRef.current?.();
  }, [handoffs]);

  return (
    <div
      aria-label="Event and equipment route map"
      className="h-[24rem] min-h-80 w-full bg-slate-200 sm:h-[34rem]"
      ref={containerRef}
      role="img"
    />
  );
}

function EventList({
  events,
  title,
  unmapped = false,
  retryingId = null,
  onRetry,
}: {
  events: PlanningEvent[];
  title: string;
  unmapped?: boolean;
  retryingId?: string | null;
  onRetry?: (event: PlanningEvent) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold">{title}</h2>
      {events.length ? (
        <ul className="mt-3 grid gap-2">
          {events.map((event) => (
            <li
              className={`rounded-lg border border-slate-200 p-3 transition ${
                event.planningEmphasis === "dimmed" ? "opacity-40" : ""
              }`}
              data-emphasis={event.planningEmphasis}
              key={event.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link className="font-bold text-slate-950 hover:text-orange-700" href={`/bookings/${event.id}`}>
                    {event.name}
                  </Link>
                  <p className="mt-0.5 text-sm text-slate-600">
                    {[event.city, event.region].filter(Boolean).join(", ")}
                    {event.travelLegName ? ` · ${event.travelLegName}` : ""}
                  </p>
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
                <span
                  className={
                    event.status === "confirmed"
                      ? "rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800"
                      : event.routeBucket === "history"
                        ? "rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700"
                        : "rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800"
                  }
                >
                  {event.status === "confirmed" ? "Confirmed" : formatLabel(event.status)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-600">No events in this group.</p>
      )}
    </section>
  );
}

export function EventMap({
  events,
  travelLegs,
  handoffs = [],
}: {
  events: MapEvent[];
  travelLegs: TravelLeg[];
  handoffs?: EquipmentHandoffView[];
}) {
  const currentYear = new Date().getFullYear();
  const [filters, setFilters] = useState<MapFilters>(initialFilters);
  const [mode, setMode] = useState<RouteViewMode>("full");
  const [seasonYear, setSeasonYear] = useState(currentYear);
  const [focusedLegId, setFocusedLegId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [eventOverrides, setEventOverrides] = useState<Record<string, MapEvent>>({});
  const [retryError, setRetryError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const effectiveEvents = useMemo(
    () => events.map((event) => eventOverrides[event.id] ?? event),
    [eventOverrides, events],
  );

  async function retryLocation(event: MapEvent) {
    setRetryingId(event.id);
    setRetryError(null);
    try {
      const response = await apiPost<{ event: Omit<MapEvent, "startsAt" | "endsAt"> & { startsAt: string | Date | null; endsAt: string | Date | null } }>(
        `/routes/events/${event.id}/retry-location`,
        {},
      );
      const refreshed: MapEvent = {
        ...response.event,
        startsAt: response.event.startsAt ? new Date(response.event.startsAt) : null,
        endsAt: response.event.endsAt ? new Date(response.event.endsAt) : null,
      };
      setEventOverrides((current) => ({ ...current, [event.id]: refreshed }));
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
    const years = new Set<number>([currentYear]);
    for (const event of effectiveEvents) {
      const year = eventSeasonYear(event);
      if (year !== null) years.add(year);
    }
    for (const handoff of handoffs) {
      years.add(new Date(handoff.windowStartsAt).getFullYear());
    }
    return [...years].sort((a, b) => b - a);
  }, [currentYear, effectiveEvents, handoffs]);

  const filteredEvents = useMemo(
    () => filterMapEvents(effectiveEvents, filters),
    [effectiveEvents, filters],
  );

  const planningEvents = useMemo(() => {
    const result: PlanningEvent[] = [];
    for (const event of filteredEvents) {
      if (!event.travelLegId) continue;
      if (eventSeasonYear(event) !== seasonYear) continue;
      const bucket = event.routeBucket ?? classifyRouteBucket(event.status);
      const emphasis = routeEmphasis({
        bucket,
        mode,
        eventLegId: event.travelLegId,
        focusedLegId,
      });
      if (emphasis === "hidden") continue;
      result.push({
        ...event,
        routeBucket: bucket,
        locationLabel:
          event.locationLabel ??
          ([event.city, event.region].filter(Boolean).join(", ") || null),
        locationQuality:
          event.locationQuality ??
          (event.latitude !== null && event.longitude !== null
            ? "coordinates"
            : event.city
              ? "city"
              : "missing"),
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
    return result;
  }, [filteredEvents, focusedLegId, mode, seasonYear]);

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
      if (!event.travelLegId) continue;
      groups.set(event.travelLegId, [...(groups.get(event.travelLegId) ?? []), event]);
    }
    const features: RouteLineCollection["features"] = [];
    for (const [legId, group] of groups) {
      group.sort((a, b) => (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0));
      for (let index = 0; index < group.length - 1; index += 1) {
        const from = group[index]!;
        const to = group[index + 1]!;
        if (from.latitude === null || from.longitude === null || to.latitude === null || to.longitude === null) continue;
        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [from.longitude, from.latitude],
              [to.longitude, to.latitude],
            ],
          },
          properties: {
            legId,
            color: from.travelLegColor ?? to.travelLegColor ?? "#64748b",
            emphasis:
              from.planningEmphasis === "dimmed" && to.planningEmphasis === "dimmed"
                ? "dimmed"
                : "primary",
          },
        });
      }
    }
    return { type: "FeatureCollection", features };
  }, [mappedEvents]);

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

  return (
    <div className="grid gap-5">
      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Route view</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["full", "confirmed", "potential", "history"] as RouteViewMode[]).map((value) => (
              <button
                aria-pressed={mode === value}
                className={mode === value ? "button-primary px-4" : "button-secondary px-4"}
                key={value}
                onClick={() => setMode(value)}
                type="button"
              >
                {value === "full" ? "Full" : formatLabel(value)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold">
            Season/year
            <select onChange={(event) => setSeasonYear(Number(event.target.value))} value={seasonYear}>
              {seasonYears.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Leg focus
            <select onChange={(event) => setFocusedLegId(event.target.value || null)} value={focusedLegId ?? ""}>
              <option value="">All legs</option>
              {travelLegs.filter((leg) => !leg.archivedAt).map((leg) => (
                <option key={leg.id} value={leg.id}>{leg.name}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Confirmed, Potential, and leg focus emphasize what you asked for without hiding nearby active legs. History is separated by season.
        </p>
      </section>

      <MapFiltersPanel filters={filters} onChange={setFilters} onReset={() => setFilters(initialFilters)} regions={regions} />

      {retryError ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{retryError}</p> : null}
      {mapError ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{mapError}</p> : null}

      <p aria-live="polite" className="text-sm text-slate-600">
        {mappedEvents.length} mapped {mappedEvents.length === 1 ? "event" : "events"} · {unmappedEvents.length} needing map location · {handoffFeatures.features.length} equipment meetup {handoffFeatures.features.length === 1 ? "marker" : "markers"}
      </p>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-600">
            <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-full border-2 border-slate-900 bg-slate-500" />Confirmed</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-full border border-white bg-slate-500 opacity-70 ring-1 ring-slate-300" />Potential / history</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-full border-2 border-white bg-orange-500 ring-1 ring-orange-300" />Suggested handoff</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-full border-2 border-slate-900 bg-sky-500" />Approved handoff</span>
            <span className="inline-flex items-center gap-1.5 opacity-40"><span className="size-3 rounded-full bg-slate-500" />Context (dimmed)</span>
          </div>
        </div>
        <MapCanvas geoJson={dataset.geoJson} routeLines={routeLines} handoffs={handoffFeatures} onError={setMapError} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <EventList events={mappedEvents} title="Route events" />
        <EventList
          events={unmappedEvents}
          title="Location needs mapping"
          unmapped
          retryingId={retryingId}
          onRetry={(event) => { void retryLocation(event); }}
        />
      </div>
    </div>
  );
}