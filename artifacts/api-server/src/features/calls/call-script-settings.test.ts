import { describe, expect, it } from "vitest";

import {
  CALL_SCRIPT_NODE_IDS,
  CALL_SCRIPT_KINDS,
  callScriptOverrideInputSchema,
  validateCallScriptPlaceholders,
} from "./call-script-settings";

describe("call script settings", () => {
  it("accepts the protected script kinds and nodes used by the guided call graph", () => {
    expect(CALL_SCRIPT_KINDS).toEqual([
      "first_outreach",
      "rebooking",
      "follow_up",
      "proposal_contract",
      "callback",
      "incoming_inquiry",
    ]);
    expect(CALL_SCRIPT_NODE_IDS).toContain("opening");
    expect(CALL_SCRIPT_NODE_IDS).toContain("pricing");
    expect(CALL_SCRIPT_NODE_IDS).toContain("close_declined");
  });

  it("accepts only the trusted placeholders", () => {
    expect(validateCallScriptPlaceholders("Hi {{contactName}}, about {{eventName}}.")).toEqual([]);
    expect(validateCallScriptPlaceholders("See you in {{madeUpField}}.")).toEqual(["madeUpField"]);
  });

  it("requires non-empty say text and rejects unknown placeholders", () => {
    expect(callScriptOverrideInputSchema.safeParse({
      scriptKind: "first_outreach",
      nodeId: "opening",
      sayText: "Hi {{contactName}}",
      coachText: null,
    }).success).toBe(true);

    expect(callScriptOverrideInputSchema.safeParse({
      scriptKind: "first_outreach",
      nodeId: "opening",
      sayText: "   ",
      coachText: null,
    }).success).toBe(false);

    expect(callScriptOverrideInputSchema.safeParse({
      scriptKind: "first_outreach",
      nodeId: "opening",
      sayText: "Hi {{wrongToken}}",
      coachText: null,
    }).success).toBe(false);
  });
});
