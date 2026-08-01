"use client";

import { useEffect, useRef } from "react";
import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";

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

type RoutePoint = {
  label: string;
  latitude: number;
  longitude: number;
  kind: "start" | "stop" | "end";
  order?: number; // 1-based, only for stops
};

export type TripRouteStop = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  sortOrder: number;
};

type Props = {
  start?: { label: string; latitude: number | null; longitude: number | null };
  end?: { label: string; latitude: number | null; longitude: number | null };
  stops: TripRouteStop[];
};

function buildPoints(
  start: Props["start"],
  end: Props["end"],
  stops: TripRouteStop[],
): RoutePoint[] {
  const pts: RoutePoint[] = [];
  if (start?.latitude != null && start.longitude != null) {
    pts.push({
      label: start.label,
      latitude: start.latitude,
      longitude: start.longitude,
      kind: "start",
    });
  }
  const ordered = [...stops]
    .filter((s) => s.latitude != null && s.longitude != null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  ordered.forEach((stop, i) => {
    pts.push({
      label: stop.name,
      latitude: stop.latitude!,
      longitude: stop.longitude!,
      kind: "stop",
      order: i + 1,
    });
  });
  if (end?.latitude != null && end.longitude != null) {
    pts.push({
      label: end.label,
      latitude: end.latitude,
      longitude: end.longitude,
      kind: "end",
    });
  }
  return pts;
}

function makeMarkerEl(pt: RoutePoint): HTMLDivElement {
  const el = document.createElement("div");
  if (pt.kind === "start" || pt.kind === "end") {
    const bg = pt.kind === "start" ? "#16a34a" : "#dc2626";
    Object.assign(el.style, {
      width: "28px",
      height: "28px",
      borderRadius: "50%",
      background: bg,
      border: "2px solid white",
      boxShadow: "0 1px 4px rgba(0,0,0,0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "white",
      fontSize: "10px",
      fontWeight: "700",
      fontFamily: "sans-serif",
      cursor: "default",
      userSelect: "none",
    });
    el.textContent = pt.kind === "start" ? "S" : "E";
  } else {
    Object.assign(el.style, {
      width: "24px",
      height: "24px",
      borderRadius: "50%",
      background: "#1e293b",
      border: "2px solid white",
      boxShadow: "0 1px 4px rgba(0,0,0,0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "white",
      fontSize: "10px",
      fontWeight: "700",
      fontFamily: "sans-serif",
      cursor: "default",
      userSelect: "none",
    });
    el.textContent = String(pt.order ?? "");
  }
  return el;
}

const LINE_SOURCE = "trip-route";
const LINE_LAYER = "trip-route-line";

export function TripRouteMap({ start, end, stops }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<{ remove(): void }[]>([]);
  const pointsRef = useRef<RoutePoint[]>([]);

  // Serialized so we can detect changes in the update effect.
  const pts = buildPoints(start, end, stops);
  const ptsKey = JSON.stringify(pts);

  // ── Mount / unmount ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !("WebGLRenderingContext" in window)) return;
    let cancelled = false;

    void import("maplibre-gl").then((ml) => {
      if (cancelled || !containerRef.current) return;

      const map = new ml.Map({
        container: containerRef.current,
        center: [-98.5, 39.5],
        zoom: 3,
        style: process.env.NEXT_PUBLIC_MAP_STYLE_URL || fallbackStyle,
      });
      mapRef.current = map;
      map.addControl(new ml.NavigationControl(), "top-right");

      map.on("load", () => {
        if (cancelled) return;

        // Add an empty line source; the update effect will populate it.
        map.addSource(LINE_SOURCE, {
          type: "geojson",
          data: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} },
        });
        map.addLayer({
          id: LINE_LAYER,
          type: "line",
          source: LINE_SOURCE,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#f97316",
            "line-width": 3,
            "line-opacity": 0.85,
          },
        });

        // Populate immediately with whatever points are available now.
        applyPoints(map, ml, pointsRef.current, markersRef);
      });
    });

    return () => {
      cancelled = true;
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update when points change ──────────────────────────────────────────────
  useEffect(() => {
    const current: RoutePoint[] = JSON.parse(ptsKey);
    pointsRef.current = current;

    const map = mapRef.current;
    if (!map || !map.loaded()) return; // map not ready yet; load handler will call applyPoints

    void import("maplibre-gl").then((ml) => {
      if (!mapRef.current) return;
      applyPoints(mapRef.current, ml, current, markersRef);
    });
  }, [ptsKey]);

  return (
    <div>
      <div
        aria-label="Trip route map"
        className="h-[24rem] min-h-80 w-full overflow-hidden rounded-lg bg-slate-200"
        ref={containerRef}
        role="img"
      />
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-flex size-4 items-center justify-center rounded-full text-[8px] font-bold text-white"
            style={{ background: "#16a34a" }}
          >
            S
          </span>
          Start
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex size-4 items-center justify-center rounded-full bg-slate-900 text-[8px] font-bold text-white">
            1
          </span>
          Stops (in order)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-flex size-4 items-center justify-center rounded-full text-[8px] font-bold text-white"
            style={{ background: "#dc2626" }}
          >
            E
          </span>
          End
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-6 rounded" style={{ background: "#f97316" }} />
          Planned route (stop order)
        </span>
      </div>
    </div>
  );
}

function applyPoints(
  map: MapLibreMap,
  ml: typeof import("maplibre-gl"),
  pts: RoutePoint[],
  markersRef: React.MutableRefObject<{ remove(): void }[]>,
) {
  // Update line
  const lineSource = map.getSource(LINE_SOURCE) as GeoJSONSource | undefined;
  if (lineSource) {
    lineSource.setData({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: pts.length >= 2 ? pts.map((p) => [p.longitude, p.latitude]) : [],
      },
      properties: {},
    });
  }

  // Replace markers
  for (const m of markersRef.current) m.remove();
  markersRef.current = [];

  for (const pt of pts) {
    const el = makeMarkerEl(pt);
    const marker = new ml.Marker({ element: el })
      .setLngLat([pt.longitude, pt.latitude])
      .setPopup(new ml.Popup({ offset: 14 }).setText(pt.label))
      .addTo(map);
    markersRef.current.push(marker);
  }

  // Fit the map to show all points
  if (pts.length === 1) {
    map.flyTo({ center: [pts[0].longitude, pts[0].latitude], zoom: 8 });
  } else if (pts.length >= 2) {
    const lngs = pts.map((p) => p.longitude);
    const lats = pts.map((p) => p.latitude);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 60, maxZoom: 12, duration: 500 },
    );
  }
}
