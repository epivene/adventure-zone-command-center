import { describe, expect, it, vi } from "vitest";

import { ActArchiveRecoveryWorker } from "./recovery-worker";
import type { RecoveryCandidate } from "./recovery-types";

function candidate(rawSnapshot: Record<string, unknown>): RecoveryCandidate {
  return {
    itemId: "10000000-0000-4000-8000-000000000001",
    runId: "10000000-0000-4000-8000-000000000002",
    sourceRecordId: "10000000-0000-4000-8000-000000000003",
    sourceVersionId: "10000000-0000-4000-8000-000000000004",
    streamType: "contact",
    actRecordId: "act-contact-1",
    rawSnapshot,
    relationshipEvidence: {},
    leaseToken: "10000000-0000-4000-8000-000000000005",
  };
}

function workerFor(rawSnapshot: Record<string, unknown>, complete: ReturnType<typeof vi.fn>) {
  return new ActArchiveRecoveryWorker({
    repository: {
      claimNext: vi.fn().mockResolvedValue(candidate(rawSnapshot)),
      complete,
      failRetryable: vi.fn().mockResolvedValue(undefined),
    },
    entityRecovery: {
      recoverEntity: vi.fn().mockResolvedValue({
        state: "needs_review",
        targetSummary: { reason: "ambiguous_exact_match" },
      }),
    },
    relationshipRecovery: { recoverRelationship: vi.fn() },
    timelineRecovery: { recoverTimeline: vi.fn() },
  });
}

describe("recovery review readability", () => {
  it("automatically drops a needs-review item that would show 'No readable ACT text'", async () => {
    const complete = vi.fn().mockResolvedValue(undefined);
    const worker = workerFor(
      { id: "act-contact-1", createDate: "2024-02-23T00:00:00Z" },
      complete,
    );

    await worker.runOne({ workerId: "test-worker", now: new Date("2026-08-16T18:00:00Z") });

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      state: "dropped_unusable",
      targetSummary: expect.objectContaining({ reason: "no_readable_act_text" }),
    }));
  });

  it("keeps a needs-review item when ACT preserved text that the review card can show", async () => {
    const complete = vi.fn().mockResolvedValue(undefined);
    const worker = workerFor(
      { id: "act-contact-1", details: "Useful archived context" },
      complete,
    );

    await worker.runOne({ workerId: "test-worker", now: new Date("2026-08-16T18:00:00Z") });

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ state: "needs_review" }));
  });
});
