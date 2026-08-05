import { describe, expect, it } from "vitest";
import { reduceSourceOutcome } from "./source-outcome-reducer";

describe("reduceSourceOutcome", () => {
  it.each([
    [[{ requiredForSourceOutcome: true, executionState: "pending", blockReason: null }], "ready"],
    [[{ requiredForSourceOutcome: true, executionState: "applied", blockReason: null }], "applied"],
    [[{ requiredForSourceOutcome: true, executionState: "already_present", blockReason: null }], "already_present"],
    [[{ requiredForSourceOutcome: true, executionState: "failed", blockReason: null }], "failed"],
    [[{ requiredForSourceOutcome: true, executionState: "blocked", blockReason: "dependency" }], "awaiting_review"],
    [[{ requiredForSourceOutcome: true, executionState: "applied", blockReason: null }, { requiredForSourceOutcome: true, executionState: "already_present", blockReason: null }], "applied"],
    [[{ requiredForSourceOutcome: false, executionState: "failed", blockReason: null }, { requiredForSourceOutcome: true, executionState: "already_present", blockReason: null }], "already_present"],
  ] as const)("reduces %j to %s", (operations, expected) => {
    expect(reduceSourceOutcome(operations)).toBe(expected);
  });
});
