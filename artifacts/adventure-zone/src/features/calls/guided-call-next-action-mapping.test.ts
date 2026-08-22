import { describe, expect, it } from "vitest";
import { normalizeGuidedNextAction } from "./guided-call-state";

describe("guided call next-action mapping", () => {
  it("maps descriptive objection follow-ups to supported saved action kinds", () => {
    expect(normalizeGuidedNextAction("send_mini_zone_info")).toBe("send_information");
    expect(normalizeGuidedNextAction("send_insurance_safety_info")).toBe("send_information");
    expect(normalizeGuidedNextAction("owner_follow_up")).toBe("call");
  });

  it("maps the existing guided aliases too", () => {
    expect(normalizeGuidedNextAction("send_info")).toBe("send_information");
    expect(normalizeGuidedNextAction("send_proposal")).toBe("prepare_quote");
    expect(normalizeGuidedNextAction("resend_proposal")).toBe("prepare_quote");
    expect(normalizeGuidedNextAction("research")).toBe("send_information");
    expect(normalizeGuidedNextAction("future_season")).toBe("call");
  });
});
