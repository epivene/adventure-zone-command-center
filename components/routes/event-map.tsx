"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  StyleSpecification,
} from "maplibre-gl";

import { MapFiltersPanel } from "@/components/routes/map-filters";
import {
  filterMapEvents,
  toMapDataset,
  type MapEvent,
  type MapFeatureCollection,
  type MapFilters,
} from "@/features/routes/map-data";
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

function MapCanvas({ geoJson }: { geoJson: MapFeatureCollection }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const dataRef = useRef(geoJson);

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
        map.addSource("events", {
          type: "geojson",
          data: dataRef.current,
        });
        map.addLayer({
          id: "tentative-events",
          type: "circle",
          source: "events",
          filter: ["!=", ["get", "status"], "confirmed"],
          paint: {
            "circle-color": ["coalesce", ["get", "travelLegColor"], "#64748b"],
            "circle-opacity": 0.65,
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
            "circle-opacity": 1,
            "circle-radius": 9,
            "circle-stroke-color": "#0f172a",
            "circle-stroke-width": 2,
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
    dataRef.current = geoJson;
    const source = mapRef.current?.getSource("events") as GeoJSONSource | undefined;
    source?.setData(geoJson);
  }, [geoJson]);

  return (
    <div
      aria-label="Event map"
      className="h-[24rem] min-h-80 w-full bg-slate-200 sm:h-[34rem]"
      ref={containerRef}
      role="img"
    />
  );
}

function EventList({
  events,
  title,
}: {
  events: MapEvent[];
  title: string;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold">{title}</h2>
      {events.length ? (
        <ul className="mt-3 grid gap-2">
          {events.map((event) => (
            <li className="rounded-lg border border-slate-200 p-3" key={event.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link
                    className="font-bold text-slate-950 hover:text-orange-700"
                    href={`/bookings/${event.id}`}
                  >
                    {event.name}
                  </Link>
                  <p className="mt-0.5 text-sm text-slate-600">
                    {event.city}, {event.region}
                    {event.travelLegName ? ` · ${event.travelLegName}` : ""}
                  </p>
                </div>
                <span
                  className={
                    event.status === "confirmed"
                      ? "rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800"
                      : "rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800"
                  }
                >
                  {event.status === "confirmed"
                    ? "Confirmed"
                    : formatLabel(event.status)}
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
}: {
  events: MapEvent[];
  travelLegs: TravelLeg[];
}) {
  const [filters, setFilters] = useState<MapFilters>(initialFilters);
  const regions = useMemo(
    () => [...new Set(events.map((event) => event.region))].sort(),
    [events],
  );
  const filteredEvents = useMemo(
    () => filterMapEvents(events, filters),
    [events, filters],
  );
  const dataset = useMemo(() => toMapDataset(filteredEvents), [filteredEvents]);
  const mappedIds = useMemo(
    () => new Set(dataset.geoJson.features.map((feature) => feature.properties.id)),
    [dataset.geoJson.features],
  );
  const mappedEvents = filteredEvents.filter((event) => mappedIds.has(event.id));

  return (
    <div className="grid gap-5">
      <MapFiltersPanel
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(initialFilters)}
        regions={regions}
        travelLegs={travelLegs}
      />

      <p aria-live="polite" className="text-sm text-slate-600">
        {mappedEvents.length} mapped {mappedEvents.length === 1 ? "event" : "events"} ·{" "}
        {dataset.unmappedEvents.length} without coordinates
      </p>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-full border-2 border-slate-900 bg-slate-500" />
              Confirmed
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-full border border-white bg-slate-500 opacity-65 ring-1 ring-slate-300" />
              Tentative
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Dots show events only; no optimized routes or travel recommendations.
          </p>
        </div>
        <MapCanvas geoJson={dataset.geoJson} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <EventList events={mappedEvents} title="Mapped events" />
        <EventList
          events={dataset.unmappedEvents}
          title="Events without map coordinates"
        />
      </div>
    </div>
  );
}
