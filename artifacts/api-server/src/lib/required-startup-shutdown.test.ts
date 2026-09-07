import { afterEach, describe, expect, it, vi } from "vitest";

import { exitAfterRequiredStartupFailure } from "./required-startup-shutdown";

describe("exitAfterRequiredStartupFailure", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("forces process failure when graceful shutdown never settles", async () => {
    vi.useFakeTimers();
    const exitError = new Error("process exited");
    const exit = vi.fn((code: number): never => {
      expect(code).toBe(1);
      throw exitError;
    });

    const result = exitAfterRequiredStartupFailure({
      shutdown: () => new Promise<void>(() => undefined),
      exit,
      timeoutMs: 100,
    });
    const assertion = expect(result).rejects.toBe(exitError);
    await vi.advanceTimersByTimeAsync(100);

    await assertion;
    expect(exit).toHaveBeenCalledOnce();
  });
});
