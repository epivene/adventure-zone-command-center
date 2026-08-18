import { describe, expect, it } from "vitest";
import { runStartupStep } from "./startup-step";

describe("runStartupStep", () => {
  it("fails with the step name when startup work exceeds its timeout", async () => {
    await expect(
      runStartupStep("act review migrations", () => new Promise<never>(() => undefined), 10),
    ).rejects.toThrow("Startup step timed out: act review migrations");
  });

  it("returns successful startup work unchanged", async () => {
    await expect(runStartupStep("schema check", async () => 42, 100)).resolves.toBe(42);
  });
});
