import { describe, expect, it, vi } from "vitest";

import { OfficeEmailDispatcherLoop } from "./office-email-dispatcher-loop";

describe("Office email dispatcher loop", () => {
  it("polls quickly after progress and slowly when idle", async () => {
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const scheduler = {
      schedule: vi.fn((callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return scheduled.length;
      }),
      cancel: vi.fn(),
    };
    const runOne = vi
      .fn()
      .mockResolvedValueOnce("sent")
      .mockResolvedValueOnce("idle");
    const loop = new OfficeEmailDispatcherLoop({
      runOne,
      workerId: "worker-1",
      scheduler,
    });
    loop.start();
    expect(scheduled[0]?.delayMs).toBe(0);
    scheduled.shift()!.callback();
    await vi.waitFor(() => expect(scheduled[0]?.delayMs).toBe(1_000));
    scheduled.shift()!.callback();
    await vi.waitFor(() => expect(scheduled[0]?.delayMs).toBe(15_000));
    loop.stop();
  });

  it("backs off unexpected loop errors", async () => {
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const scheduler = {
      schedule: (callback: () => void, delayMs: number) => {
        scheduled.push({ callback, delayMs });
        return scheduled.length;
      },
      cancel: vi.fn(),
    };
    const onError = vi.fn();
    const loop = new OfficeEmailDispatcherLoop({
      runOne: vi.fn().mockRejectedValue(new Error("database unavailable")),
      workerId: "worker-1",
      scheduler,
      onError,
    });
    loop.start();
    scheduled.shift()!.callback();
    await vi.waitFor(() => expect(scheduled[0]?.delayMs).toBe(60_000));
    expect(onError).toHaveBeenCalledOnce();
    loop.stop();
  });
});
