import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const contextRow = readFileSync("src/components/calls/call-context-row.tsx", "utf8");
const flowCss = readFileSync("src/call-workspace-flow.css", "utf8");
const phoneActions = readFileSync("src/components/calls/phone-actions.tsx", "utf8");

describe("Call Profile Card", () => {
  it("turns the old context strip into a profile-style call identity card", () => {
    expect(contextRow).toContain("Call profile");
    expect(contextRow).toContain("UserRound");
    expect(contextRow).toContain("Last contacted:");
    expect(contextRow).toContain("/profiles/");
    expect(contextRow).toContain("/bookings/");
    expect(contextRow).toContain("bookingStatusLabel");
    expect(contextRow).toContain("travelLeg");
    expect(contextRow).toContain("Last Resort");
  });

  it("visually joins the identity header to the existing phone controls", () => {
    expect(flowCss).toContain('section[aria-label="Call profile"]');
    expect(flowCss).toContain('section[aria-labelledby="phone-actions-title"]');
    expect(flowCss).toContain("margin-top: -1.25rem");
    expect(flowCss).toContain('section[aria-labelledby="phone-actions-title"] > h2');
  });

  it("makes the actual call action primary while leaving copy as secondary", () => {
    expect(phoneActions).toContain("PhoneCall");
    expect(phoneActions).toContain('className="button-primary');
    expect(phoneActions).toContain('className="button-secondary"');
  });
});
