import { describe, expect, it } from "vitest";

import { getGuidedCallScript } from "./guided-call-scripts";
import { chooseGuidedResponse, createGuidedCallState } from "./guided-call-state";

describe("guided call state", () => {
  it("stages suggestions without performing persistence", () => {
    const script = getGuidedCallScript("first_outreach");
    const initial = createGuidedCallState(script);
    const next = chooseGuidedResponse(script, initial, "need_pricing");

    expect(next.nodeId).toBe("pricing");
    expect(next.staged.disposition).toBe("interested");
    expect(next.staged.noteFragments).toContain("Contact asked about pricing.");
    expect(next.staged.collect).toContain("attendance");
  });

  it("stages a future-season follow-up through the dedicated already-booked response", () => {
    const script = getGuidedCallScript("first_outreach");
    const opening = createGuidedCallState(script);
    const alreadyBooked = chooseGuidedResponse(script, opening, "already_booked");
    const future = chooseGuidedResponse(script, alreadyBooked, "check_next_season");

    expect(alreadyBooked.nodeId).toBe("already_booked_response");
    expect(future.staged.disposition).toBe("follow_up_needed");
    expect(future.staged.followUpPreset).toBe("next_season");
    expect(future.staged.nextAction).toBe("call");
  });
});
