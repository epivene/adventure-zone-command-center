import { describe, expect, it, vi } from "vitest";
import { runStartupStep } from "./startup-step";

describe("runStartupStep", () => {
  it("fails with the step name when startup work exceeds its timeout", async () => {
    await expect(
      runStartupStep("act review migrations", () => new Promise<never>(() => undefined), 10),
    ).rejects.toThrow("Startup step timed out: act review migrations");
  });

  it("runs timeout cancellation before rejecting", async () => {
    const controller = new AbortController();
    const aborted = vi.fn();
    await expect(
      runStartupStep(
        "blocked schema",
        () =>
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener(
              "abort",
              () => {
                aborted();
                reject(controller.signal.reason);
              },
              { once: true },
            );
          }),
        10,
        (error) => controller.abort(error),
      ),
    ).rejects.toThrow("Startup step timed out: blocked schema");
    expect(aborted).toHaveBeenCalledOnce();
  });

  it("returns successful startup work unchanged", async () => {
    await expect(runStartupStep("schema check", async () => 42, 100)).resolves.toBe(42);
  });
});
