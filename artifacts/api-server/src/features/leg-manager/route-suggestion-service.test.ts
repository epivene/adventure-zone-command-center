import { describe, expect, it } from "vitest";
import { ManagerRouteSuggestionService } from "./route-suggestion-service";
import type { ManagerRouteSuggestion, ManagerRouteSuggestionStore } from "./route-suggestion-repository";

function fakeRepository(): ManagerRouteSuggestionStore & { rows: ManagerRouteSuggestion[] } {
  const rows: ManagerRouteSuggestion[] = [];
  return {
    rows,
    async create(input) {
      const row: ManagerRouteSuggestion = {
        id: `suggestion-${rows.length + 1}`,
        ...input,
        status: "pending",
        reviewedBy: null,
        reviewedAt: null,
        adminResponse: null,
        stale: false,
        createdAt: new Date("2026-08-15T20:00:00Z"),
      };
      rows.push(row);
      return row;
    },
    async get(id) { return rows.find((row) => row.id === id) ?? null; },
    async listForLeg(legId) { return rows.filter((row) => row.legId === legId); },
    async listPending() { return rows.filter((row) => row.status === "pending"); },
    async markApproved(id, reviewedBy) {
      const row = rows.find((item) => item.id === id && item.status === "pending");
      if (!row) return null;
      row.status = "approved"; row.reviewedBy = reviewedBy; row.reviewedAt = new Date(); row.stale = false; return row;
    },
    async markRejected(id, reviewedBy, adminResponse) {
      const row = rows.find((item) => item.id === id && item.status === "pending");
      if (!row) return null;
      row.status = "rejected"; row.reviewedBy = reviewedBy; row.reviewedAt = new Date(); row.adminResponse = adminResponse; return row;
    },
    async markStale(id) {
      const row = rows.find((item) => item.id === id && item.status === "pending");
      if (!row) return null;
      row.stale = true; return row;
    },
  };
}

const legA = "00000000-0000-4000-8000-000000000001";
const legB = "00000000-0000-4000-8000-000000000002";

function setup(targetLeg = legA) {
  const repository = fakeRepository();
  let snapshot: Record<string, unknown> = { tripId: "trip-a", stopId: "stop-a", sortOrder: 1 };
  let applyCount = 0;
  const service = new ManagerRouteSuggestionService(
    repository,
    { async resolve() { return { legIds: [targetLeg], snapshot }; } },
    { async apply() { applyCount += 1; return { ok: true }; } },
  );
  return { repository, service, getApplyCount: () => applyCount, setSnapshot: (next: Record<string, unknown>) => { snapshot = next; } };
}

describe("ManagerRouteSuggestionService", () => {
  it("submitting a suggestion creates pending review without applying the route change", async () => {
    const ctx = setup();
    const suggestion = await ctx.service.submitManagerSuggestion({
      managerLegId: legA,
      targetType: "trip_stop",
      targetId: "00000000-0000-4000-8000-000000000101",
      kind: "reorder_stop",
      proposedJson: { sortOrder: 3 },
      reason: "Construction makes this order easier",
    });
    expect(suggestion.status).toBe("pending");
    expect(suggestion.beforeJson).toEqual({ tripId: "trip-a", stopId: "stop-a", sortOrder: 1 });
    expect(ctx.getApplyCount()).toBe(0);
  });

  it("rejects a suggestion targeting another leg", async () => {
    const ctx = setup(legB);
    await expect(ctx.service.submitManagerSuggestion({
      managerLegId: legA,
      targetType: "trip_stop",
      targetId: "00000000-0000-4000-8000-000000000102",
      kind: "reorder_stop",
      proposedJson: { sortOrder: 2 },
      reason: "test",
    })).rejects.toThrow(/outside your leg/i);
  });

  it("admin rejection leaves the mutation adapter untouched", async () => {
    const ctx = setup();
    const suggestion = await ctx.service.submitManagerSuggestion({ managerLegId: legA, targetType: "trip_stop", targetId: "00000000-0000-4000-8000-000000000103", kind: "remove_stop", proposedJson: { remove: true }, reason: "Road closure" });
    const result = await ctx.service.rejectAdminSuggestion({ suggestionId: suggestion.id, reviewedBy: "admin", adminResponse: "Keep official order" });
    expect(result.ok).toBe(true);
    expect(ctx.repository.rows[0]?.status).toBe("rejected");
    expect(ctx.getApplyCount()).toBe(0);
  });

  it("blocks stale approvals instead of blindly applying", async () => {
    const ctx = setup();
    const suggestion = await ctx.service.submitManagerSuggestion({ managerLegId: legA, targetType: "trip_stop", targetId: "00000000-0000-4000-8000-000000000104", kind: "reorder_stop", proposedJson: { sortOrder: 2 }, reason: "Better route" });
    ctx.setSnapshot({ tripId: "trip-a", stopId: "stop-a", sortOrder: 4 });
    const result = await ctx.service.approveAdminSuggestion({ suggestionId: suggestion.id, reviewedBy: "admin" });
    expect(result).toEqual({ ok: false, code: "STALE" });
    expect(ctx.repository.rows[0]?.stale).toBe(true);
    expect(ctx.getApplyCount()).toBe(0);
  });

  it("applies once then marks the suggestion approved", async () => {
    const ctx = setup();
    const suggestion = await ctx.service.submitManagerSuggestion({ managerLegId: legA, targetType: "trip_stop", targetId: "00000000-0000-4000-8000-000000000105", kind: "reorder_stop", proposedJson: { sortOrder: 2 }, reason: "Better route" });
    const result = await ctx.service.approveAdminSuggestion({ suggestionId: suggestion.id, reviewedBy: "admin" });
    expect(result.ok).toBe(true);
    expect(ctx.repository.rows[0]?.status).toBe("approved");
    expect(ctx.getApplyCount()).toBe(1);
  });
});
