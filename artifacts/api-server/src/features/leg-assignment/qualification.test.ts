import { describe, expect, it } from "vitest";

import { shouldEvaluateLegAssignment } from "./qualification";

describe("shouldEvaluateLegAssignment", () => {
  it.each(["new_lead", "researching", "contact_due", "contacted"])(
    "does not evaluate unqualified status %s",
    (nextStatus) => {
      expect(shouldEvaluateLegAssignment({
        previousStatus: "new_lead",
        nextStatus,
        manuallyAssignedLegId: null,
      })).toBe(false);
    },
  );

  it.each([
    "interested",
    "possible",
    "quote_sent",
    "pending_decision",
    "pending_contract",
    "contract_received",
    "confirmed",
  ])("evaluates qualified status %s", (nextStatus) => {
    expect(shouldEvaluateLegAssignment({
      previousStatus: "contacted",
      nextStatus,
      manuallyAssignedLegId: null,
    })).toBe(true);
  });

  it("does not overwrite an existing manual leg assignment", () => {
    expect(shouldEvaluateLegAssignment({
      previousStatus: "contacted",
      nextStatus: "interested",
      manuallyAssignedLegId: "leg-kristy",
    })).toBe(false);
  });

  it("does not reevaluate when the status did not change", () => {
    expect(shouldEvaluateLegAssignment({
      previousStatus: "interested",
      nextStatus: "interested",
      manuallyAssignedLegId: null,
    })).toBe(false);
  });
});
