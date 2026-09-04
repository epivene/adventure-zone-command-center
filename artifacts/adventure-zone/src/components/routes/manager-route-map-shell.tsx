"use client";

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import L, { type Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

import type { MapViewportTarget } from "@/features/routes/map-focus";

export const DEFAULT_ROUTE_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const DEFAULT_ROUTE_TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const US_MAX_BOUNDS: L.LatLngBoundsExpression = [
  [18, -130],
  [55, -62],
];

const MapContext = createContext<LeafletMap | null>(null);

export function useManagerRouteMap() {
  return useContext(MapContext);
}

export function applyLeafletViewport(map: Pick<LeafletMap, "setView" | "fitBounds">, viewport: MapViewportTarget) {
  if (viewport.kind === "none") return;
  if (viewport.kind === "center") {
    const [lng, lat] = viewport.center;
    map.setView([lat, lng], viewport.zoom, { animate: false });
    return;
  }
  const latLngs = viewport.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
  if (!latLngs.length) return;
  map.fitBounds(latLngs, { padding: [48, 48], maxZoom: 10, animate: false });
}

export function ManagerRouteMapShell({
  viewport,
  children,
  onTileError,
}: {
  viewport: MapViewportTarget;
  children?: ReactNode;
  onTileError?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tileErrorRef = useRef(onTileError);
  const [map, setMap] = useState<LeafletMap | null>(null);

  useEffect(() => {
    tileErrorRef.current = onTileError;
  }, [onTileError]);

  useEffect(() => {
    if (!containerRef.current) return;

    const instance = L.map(containerRef.current, {
      center: [40.2, -111.9],
      zoom: 6,
      minZoom: 4,
      maxZoom: 18,
      maxBounds: US_MAX_BOUNDS,
      maxBoundsViscosity: 1,
      worldCopyJump: false,
    });

    const tileUrl = import.meta.env.VITE_ROUTE_TILE_URL?.trim() || DEFAULT_ROUTE_TILE_URL;
    const attribution = import.meta.env.VITE_ROUTE_TILE_ATTRIBUTION?.trim() || DEFAULT_ROUTE_TILE_ATTRIBUTION;
    const tiles = L.tileLayer(tileUrl, {
      attribution,
      noWrap: true,
      maxZoom: 19,
    });
    tiles.on("tileerror", () => tileErrorRef.current?.());
    tiles.addTo(instance);
    setMap(instance);
    applyLeafletViewport(instance, viewport);

    return () => {
      instance.remove();
      setMap(null);
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    applyLeafletViewport(map, viewport);
  }, [map, viewport]);

  useEffect(() => {
    if (!map) return;
    const id = window.setTimeout(() => map.invalidateSize(), 0);
    return () => window.clearTimeout(id);
  }, [map]);

  return (
    <MapContext.Provider value={map}>
      <div className="relative h-[32rem] min-h-[28rem] w-full bg-slate-100 sm:h-[38rem]">
        <div aria-label="Adventure Zone route map" className="absolute inset-0" ref={containerRef} role="img" />
        {children}
      </div>
    </MapContext.Provider>
  );
}
