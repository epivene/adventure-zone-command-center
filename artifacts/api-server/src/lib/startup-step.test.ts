import { describe, expect, it, vi } from "vitest";
import { runStartupStep } from "./startup-step";

describe("runStartupStep", () => {
  it("fails with the step name when startup work exceeds its timeout", async () => {
    await expect(
      runStartupStep("act review migrations", () => new Promise<never>(() => undefined), 10),
    ).rejects.toThrow("Startup step timed out: act review migrations");
  });

  it("aborts timed-out startup work before rejecting", async () => {
    const aborted = vi.fn();
    await expect(
      runStartupStep(
        "blocked schema",
        (signal) =>
          new Promise<never>((_, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                aborted();
                reject(signal.reason);
              },
              { once: true },
            );
          }),
        10,
      ),
    ).rejects.toThrow("Startup step timed out: blocked schema");
    expect(aborted).toHaveBeenCalledOnce();
  });

  it("returns successful startup work unchanged", async () => {
    await expect(runStartupStep("schema check", async () => 42, 100)).resolves.toBe(42);
  });
});
