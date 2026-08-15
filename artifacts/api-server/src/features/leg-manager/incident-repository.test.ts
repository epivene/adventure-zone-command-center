import { describe, expect, it } from "vitest";
import { createIncidentForManager, type IncidentStore } from "./incident-repository";

function fakeStore(): IncidentStore & { rows: any[] } {
  const rows: any[] = [];
  return {
    rows,
    async findByMutation(legId, clientMutationId) {
      return rows.find((row) => row.legId === legId && row.clientMutationId === clientMutationId) ?? null;
    },
    async bookingBelongsToLeg(bookingId, legId) {
      return bookingId !== "booking-b" && legId === "leg-a";
    },
    async tripBelongsToLeg(tripId, legId) {
      return tripId !== "trip-b" && legId === "leg-a";
    },
    async insertIncident(input) {
      const row = { ...input, createdAt: new Date(), updatedAt: new Date() };
      rows.push(row);
      return row;
    },
    async listAll() { return rows; },
  };
}

const input = {
  id: "00000000-0000-4000-8000-000000000100",
  type: "injury",
  occurredAt: new Date("2026-08-15T17:00:00Z"),
  bookingId: "booking-a",
  tripId: null,
  locationText: "Fargo fairgrounds",
  peopleInvolved: "Guest and staff",
  description: "Minor ankle injury",
  actionTaken: "First aid provided",
  followUpNeeded: true,
  clientMutationId: "00000000-0000-4000-8000-000000000101",
};

describe("incident repository", () => {
  it("deduplicates offline retries", async () => {
    const store = fakeStore();
    const first = await createIncidentForManager(store, "leg-a", input);
    const second = await createIncidentForManager(store, "leg-a", input);
    expect(first.ok && first.idempotent).toBe(false);
    expect(second.ok && second.idempotent).toBe(true);
    expect(store.rows).toHaveLength(1);
  });

  it("rejects another leg's booking", async () => {
    const store = fakeStore();
    const result = await createIncidentForManager(store, "leg-a", { ...input, bookingId: "booking-b" });
    expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("owner-level listing can see incidents from every leg", async () => {
    const store = fakeStore();
    store.rows.push({ ...input, legId: "leg-a" }, { ...input, id: "i2", legId: "leg-b" });
    expect((await store.listAll()).map((row) => row.legId)).toEqual(["leg-a", "leg-b"]);
  });
});
