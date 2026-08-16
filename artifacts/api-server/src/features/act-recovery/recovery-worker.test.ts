import { describe, expect, it, vi } from "vitest";

import { ActArchiveRecoveryWorker } from "./recovery-worker";
import type { RecoveryCandidate } from "./recovery-types";

function candidate(streamType: string): RecoveryCandidate {
  return {
    itemId: `item-${streamType}`,
    runId: "run-1",
    sourceRecordId: `source-${streamType}`,
    sourceVersionId: `version-${streamType}`,
    streamType,
    actRecordId: `${streamType}-1`,
    rawSnapshot: {},
    relationshipEvidence: {},
    leaseToken: `lease-${streamType}`,
  };
}

function harness(queue: RecoveryCandidate[]) {
  const claimNext = vi.fn(async () => queue.shift() ?? null);
  const complete = vi.fn(async () => undefined);
  const failRetryable = vi.fn(async () => undefined);
  const recoverEntity = vi.fn(async () => ({
    state: "recovered" as const,
    targetSummary: { route: "entity" },
  }));
  const recoverRelationship = vi.fn(async () => ({
    state: "already_present" as const,
    targetSummary: { route: "relationship" },
  }));
  const recoverTimeline = vi.fn(async () => ({
    state: "recovered" as const,
    targetSummary: { route: "timeline" },
  }));
  const worker = new ActArchiveRecoveryWorker({
    repository: { claimNext, complete, failRetryable },
    entityRecovery: { recoverEntity },
    relationshipRecovery: { recoverRelationship },
    timelineRecovery: { recoverTimeline },
  });
  return {
    worker,
    claimNext,
    complete,
    failRetryable,
    recoverEntity,
    recoverRelationship,
    recoverTimeline,
  };
}

describe("ActArchiveRecoveryWorker", () => {
  it("dispatches roots, timeline records, and relationship records to the right recovery path", async () => {
    const items = [
      candidate("company"),
      candidate("opportunity"),
      candidate("history"),
      candidate("company_contact"),
    ];
    const state = harness([...items]);
    const now = new Date("2026-08-16T14:00:00.000Z");

    for (let index = 0; index < items.length; index += 1) {
      await expect(state.worker.runOne({ workerId: "recovery-worker", now })).resolves.toEqual({ kind: "progress" });
    }

    expect(state.recoverEntity).toHaveBeenCalledTimes(2);
    expect(state.recoverTimeline).toHaveBeenCalledTimes(1);
    expect(state.recoverRelationship).toHaveBeenCalledTimes(1);
    expect(state.complete).toHaveBeenCalledTimes(4);
    expect(state.failRetryable).not.toHaveBeenCalled();
  });

  it("classifies an unsupported archive stream instead of crashing the worker", async () => {
    const item = candidate("mystery_stream");
    const state = harness([item]);
    const now = new Date("2026-08-16T14:00:00.000Z");

    await expect(state.worker.runOne({ workerId: "recovery-worker", now })).resolves.toEqual({ kind: "progress" });

    expect(state.complete).toHaveBeenCalledWith(expect.objectContaining({
      itemId: item.itemId,
      leaseToken: item.leaseToken,
      state: "dropped_unusable",
      targetSummary: { reason: "unsupported_archive_stream", streamType: "mystery_stream" },
      now,
    }));
  });

  it("records transient recovery failures for bounded retry and later returns idle when no work is claimable", async () => {
    const item = candidate("history");
    const state = harness([item]);
    state.recoverTimeline.mockRejectedValueOnce(Object.assign(new Error("temporary database failure"), { code: "db_temporarily_unavailable" }));
    const now = new Date("2026-08-16T14:00:00.000Z");

    await expect(state.worker.runOne({ workerId: "recovery-worker", now })).resolves.toEqual({ kind: "progress" });

    expect(state.failRetryable).toHaveBeenCalledWith(expect.objectContaining({
      itemId: item.itemId,
      leaseToken: item.leaseToken,
      errorCode: "db_temporarily_unavailable",
      now,
      retryAfter: new Date("2026-08-16T14:00:30.000Z"),
    }));
    expect(state.complete).not.toHaveBeenCalled();

    await expect(state.worker.runOne({ workerId: "recovery-worker", now })).resolves.toEqual({ kind: "idle" });
  });
});
