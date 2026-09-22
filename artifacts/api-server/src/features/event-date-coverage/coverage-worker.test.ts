import { describe, expect, it, vi } from "vitest";
import { CoverageWorker } from "./coverage-worker";

function setup(evidence: any[], publicResolution: "complete" | "needs_review" = "complete") {
  const jobs = {
    claimNext: vi.fn(async () => ({ id: "item-1", organizationId: "org-1", attempts: 1 })),
    completeItem: vi.fn(async () => null),
    failItem: vi.fn(async () => null),
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
    expect(setupResult.internal.apply).toHaveBeenCalledWith("org-1", expect.objectContaining({ resolution: "confirmed" }));
    expect(setupResult.publicResearch.research).not.toHaveBeenCalled();
    expect(setupResult.jobs.completeItem).toHaveBeenCalledWith("item-1", "complete", expect.any(Date));
  });

  it("calls public research only when the internal audit remains missing", async () => {
    const setupResult = setup([], "needs_review");
    await setupResult.worker.runOne({ workerId: "worker", now: new Date("2026-09-21T00:00:00Z") });
    expect(setupResult.publicResearch.research).toHaveBeenCalledWith("org-1");
    expect(setupResult.jobs.completeItem).toHaveBeenCalledWith("item-1", "needs_review", expect.any(Date));
  });

  it("uses bounded exponential retry delays", async () => {
    const setupResult = setup([]);
    setupResult.publicResearch.research.mockRejectedValueOnce(new Error("quota"));
    const result = await setupResult.worker.runOne({ workerId: "worker", now: new Date("2026-09-21T00:00:00Z") });
    expect(result).toEqual({ kind: "failed", retryAfterMs: 2_000 });
    expect(setupResult.jobs.failItem).toHaveBeenCalledWith("item-1", "quota", expect.any(Date), 3);
  });
});
