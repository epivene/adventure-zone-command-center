import { describe, expect, it, vi } from "vitest";

import {
  APPLY_BATCH_SIZE,
  applyNextWithTransientRecovery,
} from "./safe-import-recovery";

describe("safe import transient recovery", () => {
  it("refreshes durable progress before continuing after a lost response", async () => {
    const apply = vi
      .fn<() => Promise<{ nextCursor: number }>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ nextCursor: 20 });
    const refreshState = vi.fn().mockResolvedValue({ cursor: 10, done: false });
    const refreshedCursors: number[] = [];

    await expect(
      applyNextWithTransientRecovery({
        apply,
        refreshState,
        onRefreshedCursor: (cursor) => refreshedCursors.push(cursor),
      }),
    ).resolves.toEqual({ nextCursor: 20 });

    expect(APPLY_BATCH_SIZE).toBe(10);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(refreshState).toHaveBeenCalledTimes(1);
    expect(refreshedCursors).toEqual([10]);
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
        onRefreshedCursor: vi.fn(),
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
        onRefreshedCursor: vi.fn(),
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
        onRefreshedCursor: vi.fn(),
      }),
    ).resolves.toBeNull();

    expect(apply).toHaveBeenCalledTimes(1);
    expect(refreshState).toHaveBeenCalledTimes(1);
  });
});
