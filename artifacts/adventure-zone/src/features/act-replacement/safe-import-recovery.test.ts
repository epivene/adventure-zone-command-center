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
    const refreshCursor = vi.fn().mockResolvedValue(10);
    const refreshedCursors: number[] = [];

    await expect(
      applyNextWithTransientRecovery({
        apply,
        refreshCursor,
        onRefreshedCursor: (cursor) => refreshedCursors.push(cursor),
      }),
    ).resolves.toEqual({ nextCursor: 20 });

    expect(APPLY_BATCH_SIZE).toBe(10);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(refreshCursor).toHaveBeenCalledTimes(1);
    expect(refreshedCursors).toEqual([10]);
  });

  it("stops after three consecutive transient apply failures", async () => {
    const apply = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const refreshCursor = vi.fn().mockResolvedValue(0);

    await expect(
      applyNextWithTransientRecovery({
        apply,
        refreshCursor,
        onRefreshedCursor: vi.fn(),
      }),
    ).rejects.toThrow("Failed to fetch");

    expect(apply).toHaveBeenCalledTimes(3);
    expect(refreshCursor).toHaveBeenCalledTimes(2);
  });

  it("does not retry a server-declared apply error", async () => {
    const locked = Object.assign(new Error("act_apply_disabled"), {
      code: "act_apply_disabled",
    });
    const apply = vi.fn<() => Promise<never>>().mockRejectedValue(locked);
    const refreshCursor = vi.fn().mockResolvedValue(0);

    await expect(
      applyNextWithTransientRecovery({
        apply,
        refreshCursor,
        onRefreshedCursor: vi.fn(),
      }),
    ).rejects.toBe(locked);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(refreshCursor).not.toHaveBeenCalled();
  });
});
