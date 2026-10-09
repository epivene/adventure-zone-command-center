import type { ManagerCrewLocationResponse } from "@/components/profiles/crew-location-api";
import { openManagerDb } from "./manager-offline-db";

export type CrewSnapshot = { key: string; legId: string; loadedAt: string; data: ManagerCrewLocationResponse };
const STORE = "crew-snapshots";
const epochs = new Map<string, number>();
const assignments = new Map<string, Set<string>>();
const key = (legId: string, bookingId: string) => JSON.stringify([legId, bookingId]);
export const crewCacheEpoch = (legId: string) => epochs.get(legId) ?? 0;
export function activateCrewCache(legId: string) {
  epochs.set(legId, crewCacheEpoch(legId) + 1);
  assignments.delete(legId);
}

// Explicit allowlist: never persist an expanded CRM response or provider suggestions.
export function crewCacheData(data: ManagerCrewLocationResponse): ManagerCrewLocationResponse {
  const crew = data.crewLocation;
  return {
    bookingId: data.bookingId, year: data.year,
    crewLocation: crew ? {
      venue: crew.venue, editionUpdatedAt: crew.editionUpdatedAt,
      location: crew.location ? { latitude: crew.location.latitude, longitude: crew.location.longitude, displayName: crew.location.displayName } : null,
      stops: crew.stops.map(s => ({
        id: s.id, updatedAt: s.updatedAt, expectedUpdatedAt: null,
        name: s.name, category: s.category, address: s.address,
        latitude: s.latitude, longitude: s.longitude, notes: s.notes,
        rigFit: s.rigFit, hookups: s.hookups, overnight: s.overnight,
        rigFitConfirmedOn: s.rigFit === "unknown" ? null : s.rigFitConfirmedOn ?? null,
        hookupsConfirmedOn: s.hookups === "unknown" ? null : s.hookupsConfirmedOn ?? null,
        overnightConfirmedOn: s.overnight === "unknown" ? null : s.overnightConfirmedOn ?? null,
        maxRigLengthFeet: s.maxRigLengthFeet, phone: s.phone, website: s.website,
        sourceKey: s.sourceKey, sourceUrl: s.sourceUrl,
      })),
    } : null,
  };
}

async function transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  const db = await openManagerDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Private cache unavailable")); };
  });
}

export async function listCrewSnapshots(legId: string): Promise<CrewSnapshot[]> {
  const rows = await transaction("readonly", store => store.getAll()) as CrewSnapshot[] | undefined;
  return (rows ?? []).filter(row => row.legId === legId);
}
export async function getCrewSnapshot(legId: string, bookingId: string) {
  return (await transaction("readonly", store => store.get(key(legId, bookingId))) as CrewSnapshot | undefined) ?? null;
}
export async function saveCrewSnapshot(legId: string, data: ManagerCrewLocationResponse, epoch: number) {
  if (typeof indexedDB === "undefined") return null;
  const row: CrewSnapshot = { key: key(legId, data.bookingId), legId, loadedAt: new Date().toISOString(), data: crewCacheData(data) };
  await transaction("readwrite", store => epoch === crewCacheEpoch(legId) && (!assignments.has(legId) || assignments.get(legId)!.has(data.bookingId)) ? store.put(row) : store.get(row.key));
  window.dispatchEvent(new Event("manager-crew-cache-changed"));
  return row;
}
export async function removeCrewSnapshot(legId: string, bookingId: string) {
  await transaction("readwrite", store => store.delete(key(legId, bookingId)));
}
export async function pruneCrewAssignments(legId: string, bookingIds: string[]) {
  const allowed = new Set(bookingIds);
  assignments.set(legId, allowed);
  window.dispatchEvent(new CustomEvent("manager-crew-assignments", { detail: { legId, bookingIds } }));
  await transaction("readwrite", store => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const row = cursor.value as CrewSnapshot;
      if (row.legId === legId && !allowed.has(row.data.bookingId)) cursor.delete();
      cursor.continue();
    };
    return request;
  });
  window.dispatchEvent(new Event("manager-crew-cache-changed"));
}
export async function clearCrewCache(legId: string) {
  epochs.set(legId, crewCacheEpoch(legId) + 1);
  await pruneCrewAssignments(legId, []);
}
