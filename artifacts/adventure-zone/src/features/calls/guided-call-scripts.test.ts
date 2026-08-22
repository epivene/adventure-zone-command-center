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

  it("adds polished Amy-derived objection branches without replacing the preferred opener", () => {
    const script = getGuidedCallScript("first_outreach");
    expect(script.nodes.opening.say).toContain("whether we might be a good fit");
    expect(script.nodes.already_booked_response.say).toContain("Would it be useful for me to check back for next season?");
    expect(script.nodes.space_constraint.say).toContain("smaller Mini Zone");
    expect(script.nodes.budget_constraint.say).toContain("I don't want to promise an option before I check the event details");
    expect(script.nodes.event_not_happening.say).toContain("return next year");
    expect(script.nodes.policy_restriction.say).toContain("insurance and safety information");
    expect(script.nodes.past_customer_feedback.say).toContain("what went wrong");
  });

  it("maps new objections to deliberate outcomes instead of dead ends", () => {
    const script = getGuidedCallScript("first_outreach");
    expect(script.nodes.already_booked_response.responses).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "check_next_season", suggestion: expect.objectContaining({ followUpPreset: "next_season" }) }),
      expect.objectContaining({ id: "do_not_contact", suggestion: expect.objectContaining({ disposition: "do_not_call" }) }),
    ]));
    expect(script.nodes.budget_constraint.responses).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "research_options", suggestion: expect.objectContaining({ nextAction: "research" }) }),
    ]));
    expect(script.nodes.past_customer_feedback.responses).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "record_feedback", suggestion: expect.objectContaining({ nextAction: "owner_follow_up" }) }),
    ]));
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
