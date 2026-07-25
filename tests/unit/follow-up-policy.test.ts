import { describe, expect, it } from "vitest";

import {
  isActiveStatus,
  needsFollowUpPlan,
} from "@/features/follow-ups/follow-up-policy";

describe("isActiveStatus", () => {
  it("treats declined, cancelled, and completed bookings as closed", () => {
    expect(isActiveStatus("declined")).toBe(false);
    expect(isActiveStatus("cancelled")).toBe(false);
    expect(isActiveStatus("completed")).toBe(false);
  });
});

describe("needsFollowUpPlan", () => {
  it("flags an active lead without a future action", () => {
    expect(needsFollowUpPlan({ status: "possible" }, null)).toBe(true);
  });

  it("does not flag a closed lead", () => {
    expect(needsFollowUpPlan({ status: "declined" }, null)).toBe(false);
  });

  it("does not flag an active lead with an incomplete dated action", () => {
    expect(
      needsFollowUpPlan(
        { status: "quote_sent" },
        { dueAt: new Date("2026-08-01T15:00:00Z"), completedAt: null },
        new Date("2026-08-01T14:00:00Z"),
      ),
    ).toBe(false);
  });

  it("flags an active lead when its next action is past due", () => {
    expect(
      needsFollowUpPlan(
        { status: "quote_sent" },
        { dueAt: new Date("2026-08-01T13:59:59Z"), completedAt: null },
        new Date("2026-08-01T14:00:00Z"),
      ),
    ).toBe(true);
  });

  it("flags an active lead when its next action has an invalid date", () => {
    expect(
      needsFollowUpPlan(
        { status: "quote_sent" },
        { dueAt: new Date("not a date"), completedAt: null },
        new Date("2026-08-01T14:00:00Z"),
      ),
    ).toBe(true);
  });

  it("flags an active lead when its supplied next action is already complete", () => {
    expect(
      needsFollowUpPlan(
        { status: "contacted" },
        {
          dueAt: new Date("2026-08-01T15:00:00Z"),
          completedAt: new Date("2026-08-01T16:00:00Z"),
        },
      ),
    ).toBe(true);
  });
});
