import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DEFAULT_ROUTE_TILE_ATTRIBUTION, DEFAULT_ROUTE_TILE_URL } from "@/components/routes/manager-route-map-shell";

export type CrewMapPoint = { id: string; name: string; latitude: number; longitude: number; kind: "venue" | "saved" | "suggested" };
const STYLE = {
  venue: { fill: "hsl(var(--foreground))", radius: 10 },
  saved: { fill: "hsl(var(--primary))", radius: 8 },
  suggested: { fill: "hsl(var(--accent))", radius: 6 },
} as const;

export function FestivalCrewMap({ points }: { points: CrewMapPoint[] }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!host.current || failed) return undefined;
    try {
      const m = L.map(host.current, { scrollWheelZoom: false }).setView([39, -98], 4);
      map.current = m;
      L.tileLayer(import.meta.env.VITE_ROUTE_TILE_URL?.trim() || DEFAULT_ROUTE_TILE_URL, { maxZoom: 18, attribution: import.meta.env.VITE_ROUTE_TILE_ATTRIBUTION?.trim() || DEFAULT_ROUTE_TILE_ATTRIBUTION }).on("tileerror", () => setFailed(true)).addTo(m);
      layer.current = L.layerGroup().addTo(m);
      map.current = m;
      const ro = new ResizeObserver(() => m.invalidateSize());
      ro.observe(host.current);
      return () => { ro.disconnect(); m.remove(); map.current = null; layer.current = null; };
    } catch { map.current?.remove(); map.current = null; layer.current = null; setFailed(true); return undefined; }
  }, [failed]);
  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const bounds: L.LatLngTuple[] = [];
    for (const p of points) {
      const s = STYLE[p.kind];
      const marker = L.circleMarker([p.latitude, p.longitude], { radius: s.radius, weight: 2, fillOpacity: 0.9 }).addTo(g);
      const el = marker.getElement() as SVGElement | undefined;
      if (el) { el.style.fill = s.fill; el.style.stroke = "hsl(var(--card))"; }
      const pop = document.createElement("div");
      pop.textContent = `${p.kind === "venue" ? "Venue: " : ""}${p.name}`;
      marker.bindPopup(pop);
      bounds.push([p.latitude, p.longitude]);
    }
    m.invalidateSize();
    if (bounds.length) m.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
  }, [points]);
  if (failed) return <p role="alert" className="rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">The map could not load. The lists and directions below still work.</p>;
  return <div ref={host} role="img" aria-label="Map of venue and crew stops" className="relative z-0 h-64 w-full overflow-hidden rounded-md border border-border sm:h-80" />;
}
