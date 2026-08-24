import { describe, expect, it } from "vitest";

import {
  detectFollowUpOpeningMode,
  followUpOpeningFor,
} from "./follow-up-opening";

describe("contextual follow-up opening", () => {
  it("detects voicemail and no-answer outcomes conservatively", () => {
    expect(detectFollowUpOpeningMode("left_voicemail")).toBe("left_voicemail");
    expect(detectFollowUpOpeningMode("no_answer")).toBe("no_answer");
  });

  it("treats clearly spoken outcomes as a prior conversation", () => {
    expect(detectFollowUpOpeningMode("spoke_with_contact")).toBe("spoke_before");
    expect(detectFollowUpOpeningMode("interested")).toBe("spoke_before");
  });

  it("does not invent a callback request from an ambiguous follow-up outcome", () => {
    expect(detectFollowUpOpeningMode("follow_up_needed")).toBe("generic");
  });

  it("uses the requested manual opener instead of auto detection", () => {
    const result = followUpOpeningFor({ mode: "requested_callback", lastOutcome: "no_answer" });
    expect(result.mode).toBe("requested_callback");
    expect(result.say).toContain("asked me to check back");
  });

  it("uses voicemail-specific natural wording in auto mode", () => {
    const result = followUpOpeningFor({ mode: "auto", lastOutcome: "left_voicemail" });
    expect(result.say).toContain("left you a voicemail");
    expect(result.say).toContain("try you again");
  });
});
