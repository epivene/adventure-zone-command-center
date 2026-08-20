import { describe, expect, it } from "vitest";

import {
  GUIDED_CALL_SCRIPT_KINDS,
  getGuidedCallScript,
  renderGuidedText,
  validateGuidedCallScript,
} from "./guided-call-scripts";

describe("guided call scripts", () => {
  it.each(GUIDED_CALL_SCRIPT_KINDS)("has a complete branch graph for %s", (kind) => {
    expect(validateGuidedCallScript(getGuidedCallScript(kind))).toEqual([]);
  });

  it("uses a relationship-aware rebooking opening", () => {
    const script = getGuidedCallScript("rebooking");
    const opening = script.nodes[script.startNodeId];
    expect(opening.say.toLowerCase()).toContain("been part of");
    expect(opening.say.toLowerCase()).not.toContain("introduce");
  });

  it("keeps proposal follow-up focused on the proposal", () => {
    const script = getGuidedCallScript("proposal_contract");
    const opening = script.nodes[script.startNodeId];
    expect(opening.say.toLowerCase()).toContain("proposal or contract");
    expect(opening.say.toLowerCase()).not.toContain("how many people");
  });

  it("offers to email detailed pricing options instead of overexplaining on the phone", () => {
    const script = getGuidedCallScript("first_outreach");
    expect(script.nodes.pricing.say).toContain("I can email you more detailed info on the options we have and we can go from there.");
  });

  it("renders only trusted placeholders supplied by the workspace", () => {
    expect(renderGuidedText(
      "Hi {{contactName}}, I'm calling about {{eventName}}.",
      { contactName: "Sarah", eventName: "River Days" },
    )).toBe("Hi Sarah, I'm calling about River Days.");
  });
});