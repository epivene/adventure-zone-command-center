"use client";

import { Link } from "wouter";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  StyleSpecification,
} from "maplibre-gl";

import { MapFiltersPanel } from "@/components/routes/map-filters";
import type { EquipmentHandoffView } from "@/components/routes/equipment-handoffs";
import {
  filterMapEvents,
  toMapDataset,
  type MapEvent,
  type MapFeatureCollection,
  type MapFilters,
} from "@/features/routes/map-data";
import {
  classifyRouteBucket,
  routeEmphasis,
  type RouteEmphasis,
  type RouteViewMode,
} from "@/features/routes/route-view";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";

const initialFilters: MapFilters = {
  statuses: [],
  travelLegIds: [],
  dateFrom: null,
  dateTo: null,
  regions: [],
};

const fallbackStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#e2e8f0" },
    },
  ],
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

function MapCanvas({
  geoJson,
  routeLines,
  handoffs,
}: {
  geoJson: MapFeatureCollection;
  routeLines: RouteLineCollection;
  handoffs: HandoffFeatureCollection;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const eventDataRef = useRef(geoJson);
  const routeDataRef = useRef(routeLines);
  const handoffDataRef = useRef(handoffs);

  useEffect(() => {
    if (!containerRef.current || !("WebGLRenderingContext" in window)) return;
    let cancelled = false;

    void import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        center: [-98.5, 39.5],
        zoom: 3,
        style: process.env.NEXT_PUBLIC_MAP_STYLE_URL || fallbackStyle,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl(), "top-right");

      map.on("load", () => {
        if (cancelled) return;
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
      });
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    eventDataRef.current = geoJson;
    const source = mapRef.current?.getSource("events") as GeoJSONSource | undefined;
    source?.setData(geoJson);
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
}: {
  events: PlanningEvent[];
  title: string;
  unmapped?: boolean;
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
                    {event.city}, {event.region}
                    {event.travelLegName ? ` · ${event.travelLegName}` : ""}
                  </p>
                  {unmapped ? (
                    <p className="mt-1 text-xs font-semibold text-amber-700">
                      {event.locationLabel
                        ? `Could not map ${event.locationLabel}`
                        : "Needs a city/state or event address"}
                    </p>
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

  const regions = useMemo(
    () => [...new Set(events.map((event) => event.region).filter(Boolean))].sort(),
    [events],
  );

  const seasonYears = useMemo(() => {
    const years = new Set<number>([currentYear]);
    for (const event of events) {
      const year = eventSeasonYear(event);
      if (year !== null) years.add(year);
    }
    for (const handoff of handoffs) {
      years.add(new Date(handoff.windowStartsAt).getFullYear());
    }
    return [...years].sort((a, b) => b - a);
  }, [currentYear, events, handoffs]);

  const filteredEvents = useMemo(
    () => filterMapEvents(events, filters),
    [events, filters],
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
            : event.city && event.region
              ? "city"
              : "missing"),
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
        <MapCanvas geoJson={dataset.geoJson} routeLines={routeLines} handoffs={handoffFeatures} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <EventList events={mappedEvents} title="Route events" />
        <EventList events={unmappedEvents} title="Events needing map location" unmapped />
      </div>
    </div>
  );
}
