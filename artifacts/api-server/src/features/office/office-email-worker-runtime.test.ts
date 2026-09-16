import { describe, expect, it, vi } from "vitest";

import { startOfficeEmailWorkerRuntime } from "./office-email-worker-runtime";

describe("Office email worker runtime", () => {
  it("starts once and closes cleanly on a process signal", async () => {
    const listeners = new Map<string, () => void>();
    const signals = {
      on: vi.fn((signal: string, listener: () => void) =>
        listeners.set(signal, listener),
      ),
      off: vi.fn((signal: string) => listeners.delete(signal)),
    };
    const loop = { start: vi.fn(), stop: vi.fn() };
    const close = vi.fn().mockResolvedValue(undefined);
    const runtime = startOfficeEmailWorkerRuntime({ loop, close, signals });
    expect(loop.start).toHaveBeenCalledOnce();
    listeners.get("SIGTERM")?.();
    await runtime.stop();
    expect(loop.stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(signals.off).toHaveBeenCalledTimes(2);
  });
});
