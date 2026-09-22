import { describe, expect, it, vi } from "vitest";
import {
  CoverageWorker,
  ProfileInternalEvidenceService,
  ProfileResearchCoverageProvider,
} from "./coverage-worker";

function setup(evidence: any[], publicResolution: "complete" | "needs_review" = "complete") {
  const jobs = {
    claimNext: vi.fn(async () => ({ id: "item-1", organizationId: "org-1", attempts: 1 })),
    renewLease: vi.fn(async () => ({ id: "item-1" })),
    completeWithLease: vi.fn(async (
      _itemId: string,
      _status: string,
      _now: Date,
      _workerId: string,
      _leaseMs: number,
      work: (transaction: unknown) => Promise<void>,
    ) => {
      await work({ transaction: true });
      return { id: "item-1" };
    }),
    completeItem: vi.fn(async () => ({ id: "item-1" })),
    failItem: vi.fn(async () => ({ id: "item-1" })),
  };
  const internal = { load: vi.fn(async () => evidence), apply: vi.fn(async () => undefined) };
  const publicResearch = { research: vi.fn(async () => publicResolution) };
  return { jobs, internal, publicResearch, worker: new CoverageWorker(jobs as never, internal, publicResearch) };
}

describe("CoverageWorker", () => {
  it("applies resolvable internal evidence without calling the web provider", async () => {
    const setupResult = setup([{
      startsOn: "2027-06-01", endsOn: null, evidenceKind: "published_exact", sourceKind: "internal",
      sourceType: "email", sourceId: "email-1", sourceLabel: "Organizer email", excerpt: "Event date: 2027-06-01",
    }]);
    await setupResult.worker.runOne({ workerId: "worker", now: new Date("2026-09-21T00:00:00Z") });
    expect(setupResult.internal.apply).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ resolution: "confirmed" }),
      expect.anything(),
    );
    expect(setupResult.publicResearch.research).not.toHaveBeenCalled();
    expect(setupResult.jobs.completeWithLease).toHaveBeenCalledWith(
      "item-1", "complete", expect.any(Date), "worker", 300_000, expect.any(Function),
    );
  });

  it("calls public research only when the internal audit remains missing", async () => {
    const setupResult = setup([], "needs_review");
    await setupResult.worker.runOne({ workerId: "worker", now: new Date("2026-09-21T00:00:00Z") });
    expect(setupResult.publicResearch.research).toHaveBeenCalledWith("org-1", { itemId: "item-1", workerId: "worker" });
    expect(setupResult.jobs.completeItem).toHaveBeenCalledWith("item-1", "needs_review", expect.any(Date), "worker");
  });

  it("uses bounded exponential retry delays", async () => {
    const setupResult = setup([]);
    setupResult.publicResearch.research.mockRejectedValueOnce(new Error("quota"));
    const result = await setupResult.worker.runOne({ workerId: "worker", now: new Date("2026-09-21T00:00:00Z") });
    expect(result).toEqual({ kind: "failed", retryAfterMs: 2_000 });
    expect(setupResult.jobs.failItem).toHaveBeenCalledWith("item-1", "quota", expect.any(Date), 3, "worker");
  });

  it("does not apply evidence after its lease is lost", async () => {
    const setupResult = setup([{
      startsOn: "2027-06-01", endsOn: null, evidenceKind: "published_exact", sourceKind: "internal",
      sourceType: "email", sourceId: "email-1", sourceLabel: "Organizer email", excerpt: "Event date: 2027-06-01",
    }]);
    setupResult.jobs.completeWithLease.mockResolvedValueOnce(null as never);

    const result = await setupResult.worker.runOne({ workerId: "worker", now: new Date("2026-09-21T00:00:00Z") });

    expect(result).toEqual({ kind: "lost_lease" });
    expect(setupResult.internal.apply).not.toHaveBeenCalled();
    expect(setupResult.jobs.completeItem).not.toHaveBeenCalled();
  });
});

describe("ProfileInternalEvidenceService", () => {
  it("queues a conflict for review instead of overwriting an active fact", async () => {
    const dates = {
      applyWithoutSupersedingConflict: vi.fn(async () => undefined),
      markNeedsReview: vi.fn(async () => undefined),
    };
    const service = new ProfileInternalEvidenceService({ getEventProfile: vi.fn() }, dates as never);

    await service.apply("org-1", {
      resolution: "confirmed",
      startsOn: "2027-06-08",
      endsOn: null,
      evidence: [{
        startsOn: "2027-06-08", endsOn: null, evidenceKind: "published_exact", sourceKind: "internal",
        sourceType: "email", sourceId: "email-1", sourceLabel: "Organizer email", excerpt: "Event date: 2027-06-08",
      }],
    });

    expect(dates.applyWithoutSupersedingConflict).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      startsOn: "2027-06-08",
      status: "confirmed",
    }), undefined);
  });
});


describe("ProfileResearchCoverageProvider", () => {
  it("applies trustworthy event-date suggestions so researched dates become active facts", async () => {
    const research = {
      start: vi.fn(async () => ({
        id: "research-run-1",
        suggestions: [
          {
            id: "date-suggestion-1",
            targetKind: "event_date_fact",
            confidence: "high",
            conflict: false,
          },
          {
            id: "phone-suggestion-1",
            targetKind: "organization",
            confidence: "high",
            conflict: false,
          },
        ],
      })),
    };
    const apply = {
      apply: vi.fn(async () => ({
        applied: ["date-suggestion-1"], stale: [], invalid: [], missing: [],
      })),
    };
    const provider = new ProfileResearchCoverageProvider(research, apply);

    const status = await provider.research("org-1", { itemId: "item-1", workerId: "worker-1" });

    expect(status).toBe("complete");
    expect(research.start).toHaveBeenCalledWith({
      profileId: "org-1",
      mode: "quick",
      requestedBy: "event-date-coverage-worker",
      coverageLease: { itemId: "item-1", workerId: "worker-1" },
    });
    expect(apply.apply).toHaveBeenCalledWith({
      profileId: "org-1",
      runId: "research-run-1",
      suggestionIds: ["date-suggestion-1"],
    });
  });
});
