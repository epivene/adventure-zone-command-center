import { describe, expect, it } from "vitest";

import { naturalGuidedCallSay } from "./natural-guided-call-copy";

describe("natural guided call copy", () => {
  it("uses conversational wording for the main call types", () => {
    expect(naturalGuidedCallSay({ kind: "first_outreach", nodeId: "opening", fallback: "old" }))
      .toContain("I’m calling from The Adventure Zone");
    expect(naturalGuidedCallSay({ kind: "rebooking", nodeId: "opening", fallback: "old" }))
      .toContain("what you guys are thinking for this year");
    expect(naturalGuidedCallSay({ kind: "proposal_contract", nodeId: "opening", fallback: "old" }))
      .toContain("see if you had any questions");
    expect(naturalGuidedCallSay({ kind: "callback", nodeId: "opening", fallback: "old" }))
      .toContain("see if now is a good time");
  });

  it("uses shorter spoken common branches", () => {
    expect(naturalGuidedCallSay({ kind: "first_outreach", nodeId: "next_step", fallback: "old" }))
      .toContain("anything you need from me right now");
    expect(naturalGuidedCallSay({ kind: "follow_up", nodeId: "callback_time", fallback: "old" }))
      .toBe("No problem. When would be a better time for me to call you back?");
  });

  it("preserves an admin-written override", () => {
    expect(naturalGuidedCallSay({
      kind: "first_outreach",
      nodeId: "opening",
      fallback: "My custom admin wording",
      hasAdminOverride: true,
    })).toBe("My custom admin wording");
  });
});
