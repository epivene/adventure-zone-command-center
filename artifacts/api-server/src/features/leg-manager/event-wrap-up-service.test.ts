import { describe, expect, it } from "vitest";
import {
  EventWrapUpService,
  type EventWrapUp,
  type EventWrapUpSource,
  type EventWrapUpStore,
} from "./event-wrap-up-service";

function fakeStore(): EventWrapUpStore & { rows: Map<string, EventWrapUp>; audit: string[] } {
  const rows = new Map<string, EventWrapUp>();
  const audit: string[] = [];
  let counter = 0;
  return {
    rows,
    audit,
    async get(bookingId) { return rows.get(bookingId) ?? null; },
    async saveDraft(input) {
      const now = new Date("2026-08-16T04:00:00Z");
      const previous = rows.get(input.bookingId);
      const row: EventWrapUp = {
        id: previous?.id ?? `wrap-${++counter}`,
        bookingId: input.bookingId,
        legId: input.legId,
        tripId: input.tripId,
        status: previous?.status ?? "draft",
        ratingStars: input.ratingStars,
        ratingNotes: input.ratingNotes,
        actualCashOnHandCents: input.actualCashOnHandCents,
        cashDifferenceNote: input.cashDifferenceNote,
        submittedAt: previous?.submittedAt ?? null,
        submittedBy: previous?.submittedBy ?? null,
        reviewedAt: previous?.reviewedAt ?? null,
        reviewedBy: previous?.reviewedBy ?? null,
        reviewedSourceFingerprint: previous?.reviewedSourceFingerprint ?? null,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      rows.set(input.bookingId, row);
      return row;
    },
    async markSubmitted(bookingId, submittedBy) {
      const row = rows.get(bookingId); if (!row || row.status !== "draft") return null;
      const next = { ...row, status: "submitted" as const, submittedAt: new Date(), submittedBy, updatedAt: new Date() };
      rows.set(bookingId, next); audit.push(`submitted:${bookingId}`); return next;
    },
    async markReviewed(bookingId, reviewedBy, fingerprint) {
      const row = rows.get(bookingId); if (!row || row.status !== "submitted") return null;
      const next = { ...row, status: "reviewed" as const, reviewedAt: new Date(), reviewedBy, reviewedSourceFingerprint: fingerprint, updatedAt: new Date() };
      rows.set(bookingId, next); audit.push(`reviewed:${bookingId}`); return next;
    },
    async reopen(bookingId, actor) {
      const row = rows.get(bookingId); if (!row || row.status !== "reviewed") return null;
      const next = { ...row, status: "draft" as const, reviewedAt: null, reviewedBy: null, reviewedSourceFingerprint: row.reviewedSourceFingerprint, updatedAt: new Date() };
      rows.set(bookingId, next); audit.push(`reopened:${bookingId}:${actor}`); return next;
    },
    async listSubmitted() { return [...rows.values()].filter((row) => row.status === "submitted"); },
    async averageRatingForFamily(_familyId) {
      const ratings = [...rows.values()].map((row) => row.ratingStars).filter((value): value is number => value !== null);
      return ratings.length ? { average: ratings.reduce((a, b) => a + b, 0) / ratings.length, count: ratings.length } : { average: null, count: 0 };
    },
    async getTravelOverride() { return null; }, async saveTravelOverride() { throw new Error("unused"); },
    async getOverhead() { return null; }, async saveOverhead() { throw new Error("unused"); },
    async listAdjustments() { return []; }, async addAdjustment() { throw new Error("unused"); }, async deleteAdjustment() { return false; },
  };
}

function fakeSource(): EventWrapUpSource & { fingerprints: Map<string, string> } {
  const fingerprints = new Map([["booking-a", "fp-a"], ["booking-b", "fp-b"], ["booking-c", "fp-c"]]);
  return {
    fingerprints,
    async bookingContext(bookingId) {
      if (bookingId === "booking-a") return { bookingId, legId: "leg-a", tripId: "trip-a", familyId: "family-1" };
      if (bookingId === "booking-b") return { bookingId, legId: "leg-b", tripId: "trip-b", familyId: "family-1" };
      if (bookingId === "booking-c") return { bookingId, legId: "leg-a", tripId: null, familyId: "family-1" };
      return null;
    },
    async sourceFingerprint(bookingId) { return fingerprints.get(bookingId) ?? "missing"; },
  };
}

const draft = { ratingStars: 5, ratingNotes: "Strong year", actualCashOnHandCents: 100_000, cashDifferenceNote: null };

describe("EventWrapUpService", () => {
  it("lets a manager create and update a draft for an own-leg booking", async () => {
    const service = new EventWrapUpService(fakeStore(), fakeSource());
    const first = await service.saveManagerDraft({ bookingId: "booking-a", managerLegId: "leg-a", managerId: null, input: draft });
    const second = await service.saveManagerDraft({ bookingId: "booking-a", managerLegId: "leg-a", managerId: null, input: { ...draft, ratingStars: 4 } });
    expect(first.status).toBe("draft");
    expect(second.ratingStars).toBe(4);
  });

  it("rejects a manager trying to edit another leg's booking", async () => {
    const service = new EventWrapUpService(fakeStore(), fakeSource());
    await expect(service.saveManagerDraft({ bookingId: "booking-b", managerLegId: "leg-a", managerId: null, input: draft })).rejects.toThrow(/outside your leg/i);
  });

  it("allows a manager report to submit while office cash closeout is still incomplete", async () => {
    const service = new EventWrapUpService(fakeStore(), fakeSource());
    await service.saveManagerDraft({ bookingId: "booking-a", managerLegId: "leg-a", managerId: null, input: { ...draft, actualCashOnHandCents: null } });
    await expect(service.submitManagerWrapUp({ bookingId: "booking-a", managerLegId: "leg-a", managerId: null })).resolves.toMatchObject({ status: "submitted", actualCashOnHandCents: null });
  });

  it("requeues an admin-reviewed event when the manager later adds information", async () => {
    const store = fakeStore(); const service = new EventWrapUpService(store, fakeSource());
    await service.saveManagerDraft({ bookingId: "booking-a", managerLegId: "leg-a", managerId: "manager-a", input: draft });
    await service.submitManagerWrapUp({ bookingId: "booking-a", managerLegId: "leg-a", managerId: "manager-a" });
    await service.reviewAdminWrapUp("booking-a", "owner");

    const updated = await service.saveManagerDraft({
      bookingId: "booking-a",
      managerLegId: "leg-a",
      managerId: "manager-a",
      input: { ...draft, ratingNotes: "Use the east gate next year" },
    });

    expect(updated.status).toBe("submitted");
    expect(updated.ratingNotes).toBe("Use the east gate next year");
    expect(store.audit).toEqual([
      "submitted:booking-a",
      "reviewed:booking-a",
      "reopened:booking-a:manager-a",
      "submitted:booking-a",
    ]);
  });

  it("moves submitted to reviewed and allows admin reopen while preserving audit", async () => {
    const store = fakeStore(); const service = new EventWrapUpService(store, fakeSource());
    await service.saveManagerDraft({ bookingId: "booking-a", managerLegId: "leg-a", managerId: null, input: draft });
    await service.submitManagerWrapUp({ bookingId: "booking-a", managerLegId: "leg-a", managerId: null });
    const reviewed = await service.reviewAdminWrapUp("booking-a", "owner");
    expect(reviewed.status).toBe("reviewed");
    const reopened = await service.reopenAdminWrapUp("booking-a", "owner");
    expect(reopened.status).toBe("draft");
    expect(store.audit).toEqual(["submitted:booking-a", "reviewed:booking-a", "reopened:booking-a:owner"]);
  });

  it("does not expose any manager method that can mark a wrap-up reviewed", async () => {
    const service = new EventWrapUpService(fakeStore(), fakeSource());
    expect("reviewManagerWrapUp" in service).toBe(false);
  });

  it("averages rated occurrences and excludes unrated ones", async () => {
    const store = fakeStore(); const service = new EventWrapUpService(store, fakeSource());
    await service.saveManagerDraft({ bookingId: "booking-a", managerLegId: "leg-a", managerId: null, input: { ...draft, ratingStars: 5 } });
    await service.saveManagerDraft({ bookingId: "booking-b", managerLegId: "leg-b", managerId: null, input: { ...draft, ratingStars: 3 } });
    await service.saveManagerDraft({ bookingId: "booking-c", managerLegId: "leg-a", managerId: null, input: { ...draft, ratingStars: null } });
    expect(await service.averageRatingForFamily("family-1")).toEqual({ average: 4, count: 2 });
  });

  it("flags reviewed source data when the fingerprint changes without changing status", async () => {
    const store = fakeStore(); const source = fakeSource(); const service = new EventWrapUpService(store, source);
    await service.saveManagerDraft({ bookingId: "booking-a", managerLegId: "leg-a", managerId: null, input: draft });
    await service.submitManagerWrapUp({ bookingId: "booking-a", managerLegId: "leg-a", managerId: null });
    await service.reviewAdminWrapUp("booking-a", "owner");
    source.fingerprints.set("booking-a", "fp-a-changed");
    const loaded = await service.loadAdminWrapUp("booking-a");
    expect(loaded.wrapUp?.status).toBe("reviewed");
    expect(loaded.sourceDataChanged).toBe(true);
  });
});
