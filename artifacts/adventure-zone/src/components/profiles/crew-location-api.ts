import type { FestivalCrewLocation, FestivalCrewStop, FestivalCrewStopInput, FestivalNearbySuggestion, FestivalStopCategory, FestivalVenuePin, SearchFestivalNearbyStops200, SearchFestivalVenue200, ManagerFestivalCrewLocation } from "@workspace/api-zod";
import { apiFetch } from "@/lib/auth-token";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
    const msg = typeof data?.error === "string" ? data.error : typeof data?.message === "string" ? data.message : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
export type ManagerCrewLocationResponse = ManagerFestivalCrewLocation;
const base = (id: string, year: number) => `/event-profiles/${id}/editions/${year}`;
export const crewApi = {
  getForManager: (bookingId: string, managerApi: <T>(path: string) => Promise<T>) => managerApi<ManagerCrewLocationResponse>(`/manager/bookings/${encodeURIComponent(bookingId)}/crew-location`),
  get: (id: string, year: number) => request<FestivalCrewLocation>("GET", `${base(id, year)}/crew-location`),
  searchVenue: (id: string, year: number, query: string) => request<SearchFestivalVenue200>("POST", `${base(id, year)}/crew-location/search`, { query }),
  savePin: (id: string, year: number, pin: FestivalVenuePin, expectedUpdatedAt: string) => request<FestivalCrewLocation>("PUT", `${base(id, year)}/crew-location`, { ...pin, expectedUpdatedAt }),
  nearby: (id: string, year: number, radiusMiles: 10 | 25 | 50) => request<SearchFestivalNearbyStops200>("POST", `${base(id, year)}/nearby/search`, { radiusMiles }),
  createStop: (id: string, year: number, data: FestivalCrewStopInput) => request<FestivalCrewStop>("POST", `${base(id, year)}/crew-stops`, data),
  updateStop: (id: string, year: number, stopId: string, data: FestivalCrewStopInput) => request<FestivalCrewStop>("PUT", `${base(id, year)}/crew-stops/${stopId}`, data),
  removeStop: (id: string, year: number, stopId: string, expectedUpdatedAt: string) => request<void>("DELETE", `${base(id, year)}/crew-stops/${stopId}`, { expectedUpdatedAt }),
};
export const CATEGORY_LABELS: Record<FestivalStopCategory, string> = { rv_park: "RV parks", walmart: "Walmart", mechanic: "Mechanics", tires: "Tires", oil_change: "Oil change", hardware: "Hardware", bathroom: "Restrooms", fuel: "Fuel" };
export const CATEGORIES = Object.keys(CATEGORY_LABELS) as FestivalStopCategory[];
export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try { const u = new URL(value); return u.protocol === "http:" || u.protocol === "https:" ? u.href : null; } catch { return null; }
}
export function directionsUrl(s: { latitude: number | null; longitude: number | null; address: string; name?: string }): string | null {
  const dest = s.latitude != null && s.longitude != null ? `${s.latitude},${s.longitude}` : s.address.trim() ? encodeURIComponent(s.address.trim()) : null;
  return dest ? `https://www.google.com/maps/dir/?api=1&destination=${dest}` : null;
}
export function suggestionToInput(s: FestivalNearbySuggestion): FestivalCrewStopInput {
  return { name: s.name, category: s.category, address: s.address, latitude: s.latitude, longitude: s.longitude, sourceKey: s.sourceKey, sourceUrl: s.sourceUrl, phone: s.phone, website: s.website, notes: "", rigFit: "unknown", hookups: "unknown", overnight: "unknown", maxRigLengthFeet: null, expectedUpdatedAt: null };
}
