import { describe, expect, it } from "vitest";
import {
  earlyBirdPromoDates,
  earlyBirdPromoEligibility,
  formatEarlyBirdPromoDeadline,
  removeEarlyBirdPromoBlock,
  upsertEarlyBirdPromoBlock,
} from "./early-bird-promo-policy";

describe("Early Bird Promo policy", () => {
  it("adds calendar days in Chicago without shifting across DST", () => {
    expect(earlyBirdPromoDates(new Date("2026-10-25T06:30:00Z"))).toEqual({
      deadlineDate: "2026-11-24",
      reminderDate: "2026-11-09",
      expiresAt: new Date("2026-11-25T06:00:00.000Z"),
      reminderDueAt: new Date("2026-11-09T06:00:00.000Z"),
    });
    expect(earlyBirdPromoDates(new Date("2027-02-28T18:00:00Z"))).toEqual({
      deadlineDate: "2027-03-30",
      reminderDate: "2027-03-15",
      expiresAt: new Date("2027-03-31T05:00:00.000Z"),
      reminderDueAt: new Date("2027-03-15T05:00:00.000Z"),
    });
  });

  it("treats March 31 as the final Chicago enrollment day", () => {
    const context = {
      category: "convention",
      code: "met_at_convention",
      alreadyPaid: false,
    };
    expect(earlyBirdPromoEligibility({
      ...context,
      sentAt: new Date("2027-04-01T04:59:59Z"),
    })).toBe(true);
    expect(earlyBirdPromoEligibility({
      ...context,
      sentAt: new Date("2027-04-01T05:00:00Z"),
    })).toBe(false);
  });

  it("excludes paid and operational messages", () => {
    expect(earlyBirdPromoEligibility({
      sentAt: new Date("2026-10-01T15:00:00Z"),
      category: "payment",
      code: "deposit_received",
      alreadyPaid: false,
    })).toBe(false);
    expect(earlyBirdPromoEligibility({
      sentAt: new Date("2026-10-01T15:00:00Z"),
      category: "outreach",
      code: "new_event_intro",
      alreadyPaid: true,
    })).toBe(false);
  });

  it("inserts one general-campaign block before a plain-text signature", () => {
    const original = "Hi Taylor,\n\nWould you like package information?\n\nThanks,\nDesiree";
    const once = upsertEarlyBirdPromoBlock(original, "2026-10-31");
    const twice = upsertEarlyBirdPromoBlock(once, "2026-11-01");

    expect(once).toContain("Early Bird Promo:");
    expect(once).toContain("10% off bookings");
    expect(once).toContain("October 31, 2026");
    expect(once).not.toContain("30 days");
    expect(twice.match(/Early Bird Promo:/g)).toHaveLength(1);
    expect(twice).toContain("November 1, 2026");
    expect(twice.indexOf("Early Bird Promo:")).toBeLessThan(twice.indexOf("Thanks,"));
    expect(removeEarlyBirdPromoBlock(twice)).toBe(original);
  });

  it("preserves rich convention markup outside the replaceable promo markers", () => {
    const original = '<html><body><style>.card{animation:float 4s infinite}@media(max-width:480px){.card{width:100%}}</style><div class="card"><img src="https://example.com/ride.gif"><a href="https://example.com">See packages</a></div><footer>Adventure Zone</footer></body></html>';
    const decorated = upsertEarlyBirdPromoBlock(original, "2026-10-31");

    expect(decorated).toContain("<!-- early-bird-promo:start -->");
    expect(decorated).toContain("<!-- early-bird-promo:end -->");
    expect(decorated.indexOf("Early Bird Promo")).toBeLessThan(decorated.indexOf("<footer>"));
    expect(removeEarlyBirdPromoBlock(decorated)).toBe(original);
  });

  it("formats deadline dates without exposing implementation timing", () => {
    expect(formatEarlyBirdPromoDeadline("2027-04-30")).toBe("April 30, 2027");
  });
});
