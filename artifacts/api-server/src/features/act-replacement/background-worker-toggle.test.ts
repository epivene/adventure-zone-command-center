import { describe, expect, it } from "vitest";
import { shouldStartActBackgroundWorkers } from "./runtime";

describe("ACT background worker startup", () => {
  it("defaults background workers off", () => {
    expect(shouldStartActBackgroundWorkers({})).toBe(false);
  });

  it("starts them only when explicitly enabled", () => {
    expect(shouldStartActBackgroundWorkers({ ACT_BACKGROUND_WORKERS_ENABLED: "true" })).toBe(true);
    expect(shouldStartActBackgroundWorkers({ ACT_BACKGROUND_WORKERS_ENABLED: "false" })).toBe(false);
  });
});
