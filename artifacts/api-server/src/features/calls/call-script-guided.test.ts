import { describe, expect, it } from "vitest";

import { selectGuidedCallScriptKind } from "./call-script";

describe("selectGuidedCallScriptKind", () => {
  it("uses follow-up wording when a new-lead record already has prior contact", () => {
    expect(selectGuidedCallScriptKind({
      direction: "outgoing",
      followUpKind: "call",
      bookingStatus: "new_lead",
      priorCompletedCallCount: 1,
    })).toBe("follow_up");
  });

  it("uses first outreach when no prior contact is recorded", () => {
    expect(selectGuidedCallScriptKind({
      direction: "outgoing",
      followUpKind: "call",
      bookingStatus: "new_lead",
      priorCompletedCallCount: 0,
    })).toBe("first_outreach");
  });

  it("keeps proposal and callback reasons higher priority than generic history", () => {
    expect(selectGuidedCallScriptKind({
      direction: "outgoing",
      followUpKind: "check_contract",
      bookingStatus: "interested",
      priorCompletedCallCount: 2,
    })).toBe("proposal_contract");
    expect(selectGuidedCallScriptKind({
      direction: "outgoing",
      followUpKind: "callback",
      bookingStatus: "new_lead",
      priorCompletedCallCount: 2,
    })).toBe("callback");
  });
});
