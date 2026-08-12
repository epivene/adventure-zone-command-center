import { describe, expect, it, vi } from "vitest";

import {
  APPLY_BATCH_SIZE,
  applyNextWithTransientRecovery,
  safeImportApprovalRequestKey,
  trackApplyCursorProgress,
  shouldReuseSafeImportApproval,
} from "./safe-import-recovery";

describe("shouldReuseSafeImportApproval", () => {
  it("reuses approval for a normal import that is already applying", () => {
    expect(
      shouldReuseSafeImportApproval({
        phase: "applying",
        retryFailed: false,
      }),
    ).toBe(true);
  });

  it("requires approval for a new import or explicit failed-operation retry", () => {
    expect(
      shouldReuseSafeImportApproval({
        phase: "ready_to_apply",
        retryFailed: false,
      }),
    ).toBe(false);
    expect(
      shouldReuseSafeImportApproval({
        phase: "complete_with_issues",
        retryFailed: true,
      }),
    ).toBe(false);
  });
});

describe("safeImportApprovalRequestKey", () => {
  it("reuses one approval coordinator after durable import progress changes", () => {
    const beforeProgress = safeImportApprovalRequestKey({
      runId: "run-1",
      manifestDigest: "digest-1",
      retryFailed: false,
    });
    const afterProgress = safeImportApprovalRequestKey({
      runId: "run-1",
      manifestDigest: "digest-1",
      retryFailed: false,
    });

    expect(beforeProgress).toBe("act-safe-run-1-digest-1-apply");
    expect(afterProgress).toBe(beforeProgress);
  });

  it("keeps failed-operation retries separate from the normal import", () => {
    expect(
      safeImportApprovalRequestKey({
        runId: "run-1",
        manifestDigest: "digest-1",
        retryFailed: true,
      }),
    ).toBe("act-safe-run-1-digest-1-retry");
  });
});

describe("safe import transient recovery", () => {
  it("refreshes durable progress before continuing after a lost response", async () => {
    const apply = vi
      .fn<() => Promise<{ nextCursor: number }>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ nextCursor: 20 });
    const refreshState = vi
      .fn()
      .mockResolvedValue({ cursor: 2_425, done: false });

    await expect(
      applyNextWithTransientRecovery({
        apply,
        refreshState,
      }),
    ).resolves.toEqual({ nextCursor: 20 });

    expect(APPLY_BATCH_SIZE).toBe(10);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(refreshState).toHaveBeenCalledTimes(1);
  });

  it("stops after three consecutive transient apply failures", async () => {
    const apply = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const refreshState = vi.fn().mockResolvedValue({ cursor: 0, done: false });

    await expect(
      applyNextWithTransientRecovery({
        apply,
        refreshState,
      }),
    ).rejects.toThrow("Failed to fetch");

    expect(apply).toHaveBeenCalledTimes(3);
    expect(refreshState).toHaveBeenCalledTimes(2);
  });

  it("does not retry a server-declared apply error", async () => {
    const locked = Object.assign(new Error("act_apply_disabled"), {
      code: "act_apply_disabled",
    });
    const apply = vi.fn<() => Promise<never>>().mockRejectedValue(locked);
    const refreshState = vi.fn().mockResolvedValue({ cursor: 0, done: false });

    await expect(
      applyNextWithTransientRecovery({
        apply,
        refreshState,
      }),
    ).rejects.toBe(locked);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(refreshState).not.toHaveBeenCalled();
  });

  it("does not retry when refresh proves the lost response completed the import", async () => {
    const apply = vi
      .fn<() => Promise<{ nextCursor: number }>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const refreshState = vi.fn().mockResolvedValue({ cursor: 42, done: true });

    await expect(
      applyNextWithTransientRecovery({
        apply,
        refreshState,
      }),
    ).resolves.toBeNull();

    expect(apply).toHaveBeenCalledTimes(1);
    expect(refreshState).toHaveBeenCalledTimes(1);
  });
});


describe("trackApplyCursorProgress", () => {
  it("accepts a replayed cursor after a lost apply response", () => {
    const advanced = trackApplyCursorProgress({
      previousCursor: null,
      nextCursor: 100,
      consecutiveReplays: 0,
    });

    const replayed = trackApplyCursorProgress({
      previousCursor: advanced.cursor,
      nextCursor: 100,
      consecutiveReplays: advanced.consecutiveReplays,
    });

    expect(replayed).toEqual({ cursor: 100, consecutiveReplays: 1 });
  });

  it("resets the replay guard when the cursor advances", () => {
    expect(
      trackApplyCursorProgress({
        previousCursor: 100,
        nextCursor: 110,
        consecutiveReplays: 2,
      }),
    ).toEqual({ cursor: 110, consecutiveReplays: 0 });
  });

  it("stops after three consecutive cursor replays", () => {
    expect(() =>
      trackApplyCursorProgress({
        previousCursor: 100,
        nextCursor: 100,
        consecutiveReplays: 2,
      }),
    ).toThrow("apply_cursor_stalled");
  });
});
