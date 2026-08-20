import { describe, expect, it } from "vitest";

import {
  GUIDED_CALL_SCRIPT_KINDS,
  getConfiguredGuidedCallScript,
  getGuidedCallScript,
  renderGuidedText,
  validateGuidedCallScript,
} from "./guided-call-scripts";

describe("guided call scripts", () => {
  it.each(GUIDED_CALL_SCRIPT_KINDS)("has a complete branch graph for %s", (kind) => {
    expect(validateGuidedCallScript(getGuidedCallScript(kind))).toEqual([]);
  });

  it("keeps first outreach short before explaining the attraction mix", () => {
    const script = getGuidedCallScript("first_outreach");
    const opening = script.nodes[script.startNodeId];
    expect(opening.say).toContain("traveling bounce-house carnival");
    expect(opening.say).toContain("whether we might be a good fit");
    expect(opening.say).not.toContain("giant slides");
    expect(script.nodes.details.say).toContain("10–12 attractions");
    expect(script.nodes.details.say).toContain("setup, teardown, and staffing");
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

  it("overrides only editable wording while preserving protected branch behavior", () => {
    const original = getGuidedCallScript("first_outreach");
    const configured = getConfiguredGuidedCallScript("first_outreach", [
      {
        scriptKind: "first_outreach",
        nodeId: "opening",
        sayText: "Hi {{contactName}}, custom opening.",
        coachText: "Custom coaching.",
      },
    ]);

    expect(configured.nodes.opening.say).toBe("Hi {{contactName}}, custom opening.");
    expect(configured.nodes.opening.coach).toBe("Custom coaching.");
    expect(configured.nodes.opening.responses).toEqual(original.nodes.opening.responses);
    expect(configured.nodes.pricing.say).toBe(original.nodes.pricing.say);
  });

  it("ignores overrides for a different script kind or unknown node", () => {
    const original = getGuidedCallScript("follow_up");
    const configured = getConfiguredGuidedCallScript("follow_up", [
      { scriptKind: "first_outreach", nodeId: "opening", sayText: "Wrong script", coachText: null },
      { scriptKind: "follow_up", nodeId: "missing", sayText: "Wrong node", coachText: null },
    ]);
    expect(configured).toEqual(original);
  });

  it("renders only trusted placeholders supplied by the workspace", () => {
    expect(renderGuidedText(
      "Hi {{contactName}}, I'm calling about {{eventName}}.",
      { contactName: "Sarah", eventName: "River Days" },
    )).toBe("Hi Sarah, I'm calling about River Days.");
  });
});