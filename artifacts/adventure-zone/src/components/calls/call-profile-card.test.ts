import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspace = readFileSync("src/components/calls/call-workspace.tsx", "utf8");
const card = readFileSync("src/components/calls/call-profile-card.tsx", "utf8");
const phoneActions = readFileSync("src/components/calls/phone-actions.tsx", "utf8");

describe("Call Profile Card", () => {
  it("replaces the separate context strip and Phone utility box", () => {
    expect(workspace).toContain("CallProfileCard");
    expect(workspace).not.toContain("<CallContextRow");
    expect(workspace).not.toContain('id="phone-actions-title">Phone</h2>');
  });

  it("keeps profile identity and call controls together", () => {
    expect(card).toContain("Call profile");
    expect(card).toContain("Last contacted:");
    expect(card).toContain("Phone number");
    expect(card).toContain("PhoneActions");
    expect(card).toContain("/profiles/");
    expect(card).toContain("/bookings/");
    expect(card).toContain("bookingStatusLabel");
    expect(card).toContain("travelLeg");
  });

  it("allows the call action to be visually prominent without changing default PhoneActions styling", () => {
    expect(phoneActions).toContain("prominentCall");
    expect(phoneActions).toContain('prominentCall ? "button-primary" : "button-secondary"');
  });
});
