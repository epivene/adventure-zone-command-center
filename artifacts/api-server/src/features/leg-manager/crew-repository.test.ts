import { describe, expect, it } from "vitest";
import {
  deleteManagerNoteAsManager,
  deleteWorkHistoryAsManager,
  listWorkersForManager,
  updateManagerNoteAsManager,
  updateWorkHistoryAsManager,
  type CrewRepositoryStore,
} from "./crew-repository";

function fakeStore(): CrewRepositoryStore {
  const workers = [{
    id: "worker-a", name: "Jamie Worker", phone: "7015551234", normalizedPhone: "7015551234", email: null,
    city: "Bismarck", region: "ND", locationText: "Bismarck, ND", rehireStatus: "rehirable" as const,
  }];
  const history = [{
    id: "history-a", workerId: "worker-a", legId: "leg-a", bookingId: null, tripId: null, role: "Setup crew",
    startedAt: new Date("2026-07-01T12:00:00Z"), endedAt: new Date("2026-07-01T20:00:00Z"), rating: 5, note: "Strong worker",
  }];
  const notes = [{ id: "note-a", workerId: "worker-a", legId: "leg-a", bookingId: null, note: "Would call again" }];

  return {
    async listWorkers() { return workers; },
    async listWorkHistory() { return history; },
    async listManagerNotes() { return notes; },
    async getWorkHistory(id) { return history.find((entry) => entry.id === id) ?? null; },
    async updateWorkHistory(id, patch) { const row = history.find((entry) => entry.id === id); if (!row) return null; Object.assign(row, patch); return row; },
    async deleteWorkHistory(id) { const index = history.findIndex((entry) => entry.id === id); if (index < 0) return false; history.splice(index, 1); return true; },
    async getManagerNote(id) { return notes.find((entry) => entry.id === id) ?? null; },
    async updateManagerNote(id, patch) { const row = notes.find((entry) => entry.id === id); if (!row) return null; Object.assign(row, patch); return row; },
    async deleteManagerNote(id) { const index = notes.findIndex((entry) => entry.id === id); if (index < 0) return false; notes.splice(index, 1); return true; },
  };
}

describe("shared crew directory scope", () => {
  it("lets Leg B see a worker and history created by Leg A", async () => {
    const result = await listWorkersForManager(fakeStore(), "leg-b");
    expect(result).toContainEqual(expect.objectContaining({
      id: "worker-a",
      workHistory: expect.arrayContaining([expect.objectContaining({ id: "history-a", legId: "leg-a" })]),
      managerNotes: expect.arrayContaining([expect.objectContaining({ id: "note-a", note: "Would call again" })]),
    }));
  });

  it("does not let Leg B modify Leg A work history", async () => {
    expect(await updateWorkHistoryAsManager(fakeStore(), "leg-b", "history-a", { note: "Changed by wrong leg" })).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("lets the originating leg modify its own history", async () => {
    expect(await updateWorkHistoryAsManager(fakeStore(), "leg-a", "history-a", { note: "Updated by owning leg" })).toEqual(expect.objectContaining({ ok: true, entry: expect.objectContaining({ note: "Updated by owning leg" }) }));
  });

  it("does not let another leg delete work history", async () => {
    expect(await deleteWorkHistoryAsManager(fakeStore(), "leg-b", "history-a")).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("lets the originating leg delete its own work history", async () => {
    const store = fakeStore();
    expect(await deleteWorkHistoryAsManager(store, "leg-a", "history-a")).toEqual({ ok: true });
    expect(await store.getWorkHistory("history-a")).toBeNull();
  });

  it("lets the originating leg edit its manager note but blocks other legs", async () => {
    expect(await updateManagerNoteAsManager(fakeStore(), "leg-b", "note-a", "Nope")).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await updateManagerNoteAsManager(fakeStore(), "leg-a", "note-a", "Call first")).toEqual(expect.objectContaining({ ok: true, note: expect.objectContaining({ note: "Call first" }) }));
  });

  it("lets the originating leg delete its manager note but blocks other legs", async () => {
    expect(await deleteManagerNoteAsManager(fakeStore(), "leg-b", "note-a")).toEqual({ ok: false, code: "FORBIDDEN" });
    const store = fakeStore();
    expect(await deleteManagerNoteAsManager(store, "leg-a", "note-a")).toEqual({ ok: true });
    expect(await store.getManagerNote("note-a")).toBeNull();
  });
});
