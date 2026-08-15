import { describe, expect, it } from "vitest";
import {
  listWorkersForManager,
  updateWorkHistoryAsManager,
  type CrewRepositoryStore,
} from "./crew-repository";

function fakeStore(): CrewRepositoryStore {
  const workers = [
    {
      id: "worker-a",
      name: "Jamie Worker",
      phone: "7015551234",
      normalizedPhone: "7015551234",
      email: null,
      city: "Bismarck",
      region: "ND",
      locationText: "Bismarck, ND",
      rehireStatus: "rehirable" as const,
    },
  ];
  const history = [
    {
      id: "history-a",
      workerId: "worker-a",
      legId: "leg-a",
      bookingId: null,
      tripId: null,
      role: "Setup crew",
      startedAt: new Date("2026-07-01T12:00:00Z"),
      endedAt: new Date("2026-07-01T20:00:00Z"),
      rating: 5,
      note: "Strong worker",
    },
  ];
  const notes = [
    {
      id: "note-a",
      workerId: "worker-a",
      legId: "leg-a",
      bookingId: null,
      note: "Would call again",
    },
  ];

  return {
    async listWorkers() {
      return workers;
    },
    async listWorkHistory() {
      return history;
    },
    async listManagerNotes() {
      return notes;
    },
    async getWorkHistory(id) {
      return history.find((entry) => entry.id === id) ?? null;
    },
    async updateWorkHistory(id, patch) {
      const row = history.find((entry) => entry.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    },
  };
}

describe("shared crew directory scope", () => {
  it("lets Leg B see a worker and history created by Leg A", async () => {
    const result = await listWorkersForManager(fakeStore(), "leg-b");
    expect(result).toContainEqual(
      expect.objectContaining({
        id: "worker-a",
        workHistory: expect.arrayContaining([
          expect.objectContaining({ id: "history-a", legId: "leg-a" }),
        ]),
      }),
    );
  });

  it("does not let Leg B modify Leg A work history", async () => {
    const result = await updateWorkHistoryAsManager(
      fakeStore(),
      "leg-b",
      "history-a",
      { note: "Changed by wrong leg" },
    );
    expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("lets the originating leg modify its own history", async () => {
    const result = await updateWorkHistoryAsManager(
      fakeStore(),
      "leg-a",
      "history-a",
      { note: "Updated by owning leg" },
    );
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        entry: expect.objectContaining({ note: "Updated by owning leg" }),
      }),
    );
  });
});
