import { describe, expect, it } from "vitest";

import { getLaterFollowUpCount } from "./follow-up-counts";

describe("getLaterFollowUpCount", () => {
  it("uses the full API totals when the visible page is capped", () => {
    expect(getLaterFollowUpCount({
      followUpTotal: 55,
      actionableTotal: 0,
      loadedLaterCount: 25,
    })).toBe(55);
  });

  it("subtracts overdue and today work from the full open total", () => {
    expect(getLaterFollowUpCount({
      followUpTotal: 55,
      actionableTotal: 7,
      loadedLaterCount: 18,
    })).toBe(48);
  });

  it("falls back to the loaded future count when totals are unavailable", () => {
    expect(getLaterFollowUpCount({
      followUpTotal: undefined,
      actionableTotal: undefined,
      loadedLaterCount: 4,
    })).toBe(4);
  });
});
