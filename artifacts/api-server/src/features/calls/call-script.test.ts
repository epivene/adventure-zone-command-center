import { describe, expect, it } from "vitest";

import { selectCallScript } from "./call-script";

describe("selectCallScript", () => {
  it("selects an incoming inquiry script for incoming calls", () => {
    expect(selectCallScript({ direction: "incoming", followUpKind: null, bookingStatus: null })).toBe("incoming_inquiry");
  });
  it("selects first outreach for a new lead", () => {
    expect(selectCallScript({ direction: "outgoing", followUpKind: "call", bookingStatus: "new_lead" })).toBe("first_outreach");
  });
  it("selects a contract follow-up for contract work", () => {
    expect(selectCallScript({ direction: "outgoing", followUpKind: "check_contract", bookingStatus: "pending_contract" })).toBe("contract_follow_up");
  });
  it("selects a general follow-up for an interested booking", () => {
    expect(selectCallScript({ direction: "outgoing", followUpKind: "call", bookingStatus: "interested" })).toBe("follow_up");
  });
});
