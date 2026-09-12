import { describe, expect, it } from "vitest";

import { organizationListQuerySchema } from "./last-resort-input";

describe("profile quick filter input", () => {
  it.each([
    "deadline_soon",
    "pay_per_play",
    "needs_follow_up",
    "booked",
  ] as const)("keeps %s in the existing organization query", (quick) => {
    expect(organizationListQuerySchema.parse({ quick }).quickFilter).toBe(
      quick,
    );
  });

  it("treats an unknown quick filter as no quick filter", () => {
    expect(
      organizationListQuerySchema.parse({ quick: "invented" }).quickFilter,
    ).toBeNull();
  });
});
