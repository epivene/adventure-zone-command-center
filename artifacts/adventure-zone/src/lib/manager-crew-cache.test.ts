// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { activateCrewCache, clearCrewCache, crewCacheData, crewCacheEpoch, getCrewSnapshot, listCrewSnapshots, pruneCrewAssignments, saveCrewSnapshot } from "./manager-crew-cache";
import type { ManagerCrewLocationResponse } from "@/components/profiles/crew-location-api";
const data: ManagerCrewLocationResponse = {
  bookingId: "booking-a", year: 2026,
  crewLocation: { venue: "Annual venue", editionUpdatedAt: null, location: { latitude: 1, longitude: 2, displayName: "Annual pin" },
    stops: [{ id: "stop", updatedAt: "now", name: "Walmart", category: "walmart", address: "1 Main", latitude: null, longitude: null, sourceKey: null, sourceUrl: "", phone: "", website: "", notes: "Ask before parking", rigFit: "unknown", hookups: "unknown", overnight: "unknown", maxRigLengthFeet: null, expectedUpdatedAt: null }],
  },
};
describe("manager private crew snapshots", () => {
  it("projects only annual venue and saved stop fields, never CRM or suggestions", () => {
    const expanded = { ...data, organizer: { email: "private" }, suggestions: ["not saved"],
      crewLocation: { ...data.crewLocation!, organizerAddress: "mailing address", suggestions: ["external"],
        location: { ...data.crewLocation!.location!, crm: "secret" },
        stops: [{ ...data.crewLocation!.stops[0]!, contactEmail: "secret" }],
      },
    };
    const projected = crewCacheData(expanded);
    expect(projected).toEqual(data);
    expect(JSON.stringify(projected)).not.toMatch(/secret|private|external|mailing/);
  });
  it("persists after reads and isolates legs while preserving unknown overnight facts", async () => {
    await saveCrewSnapshot("leg-a", data, crewCacheEpoch("leg-a"));
    expect(await getCrewSnapshot("leg-b", data.bookingId)).toBeNull();
    const saved = await getCrewSnapshot("leg-a", data.bookingId);
    expect(saved?.data.crewLocation?.stops[0]?.overnight).toBe("unknown");
    expect(saved?.loadedAt).toMatch(/T/);
    expect((await listCrewSnapshots("leg-a"))[0]?.data).toEqual(data);
  });
  it("removes revoked bookings without clearing another leg", async () => {
    await saveCrewSnapshot("leg-a", data, crewCacheEpoch("leg-a"));
    await saveCrewSnapshot("leg-b", data, crewCacheEpoch("leg-b"));
    await pruneCrewAssignments("leg-a", []);
    expect(await getCrewSnapshot("leg-a", data.bookingId)).toBeNull();
    expect(await getCrewSnapshot("leg-b", data.bookingId)).not.toBeNull();
  });
  it("cannot repopulate a signed-out leg from a late request", async () => {
    const epoch = crewCacheEpoch("leg-b");
    await clearCrewCache("leg-b");
    await saveCrewSnapshot("leg-b", data, epoch);
    expect(await getCrewSnapshot("leg-b", data.bookingId)).toBeNull();
  });
  it("cannot repopulate a revoked booking, but allows a newly authorized session", async () => {
    activateCrewCache("leg-c");
    const epoch = crewCacheEpoch("leg-c");
    await pruneCrewAssignments("leg-c", []);
    await saveCrewSnapshot("leg-c", data, epoch);
    expect(await getCrewSnapshot("leg-c", data.bookingId)).toBeNull();
    activateCrewCache("leg-c");
    await saveCrewSnapshot("leg-c", data, crewCacheEpoch("leg-c"));
    expect(await getCrewSnapshot("leg-c", data.bookingId)).not.toBeNull();
  });
});
