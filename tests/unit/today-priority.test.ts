import { describe, expect, it } from "vitest";

import {
  selectFutureIncompleteFollowUp,
  sortFollowUpsForToday,
  type FollowUpSummary,
} from "@/features/follow-ups/today-query";
import { needsFollowUpPlan } from "@/features/follow-ups/follow-up-policy";

function item(
  id: string,
  dueAt: string,
  status: FollowUpSummary["status"],
  overrides: Partial<FollowUpSummary> = {},
): FollowUpSummary {
  return {
    id,
    contactId: null,
    bookingId: `booking-${id}`,
    bookingName: `Booking ${id}`,
    kind: "call",
    dueAt: new Date(dueAt),
    createdAt: new Date("2026-08-01T12:00:00Z"),
    status,
    probability: "possible",
    ...overrides,
  };
}

describe("sortFollowUpsForToday", () => {
  it("uses Chicago dates when separating overdue, due-today, and future work", () => {
    const result = sortFollowUpsForToday(
      [
        item("future", "2026-08-04T17:00:00Z", "due"),
        item("today", "2026-08-03T17:00:00Z", "due"),
        item("overdue", "2026-08-02T17:00:00Z", "due"),
      ],
      new Date("2026-08-04T04:30:00Z"),
    );

    expect(result.map((entry) => entry.id)).toEqual([
      "overdue",
      "today",
      "future",
    ]);
  });

  it("orders overdue calls before calls due today and quiet leads", () => {
    const result = sortFollowUpsForToday(
      [
        item("quiet", "2026-08-10T15:00:00Z", "quiet_lead"),
        item("today", "2026-08-03T17:00:00Z", "due"),
        item("overdue", "2026-08-02T17:00:00Z", "due"),
      ],
      new Date("2026-08-03T14:00:00Z"),
    );

    expect(result.map((entry) => entry.id)).toEqual(["overdue", "today", "quiet"]);
  });

  it("uses each explicit bucket, then due date and creation time", () => {
    const result = sortFollowUpsForToday(
      [
        item("other", "2026-08-04T18:00:00Z", "other"),
        item("quiet", "2026-08-04T18:00:00Z", "quiet_lead"),
        item("likely", "2026-08-04T18:00:00Z", "due", { probability: "likely" }),
        item("deadline", "2026-08-04T18:00:00Z", "deadline"),
        item("today-later", "2026-08-03T18:00:00Z", "due"),
        item("today-earlier-created", "2026-08-03T18:00:00Z", "due", {
          createdAt: new Date("2026-07-31T12:00:00Z"),
        }),
        item("overdue", "2026-08-02T18:00:00Z", "due"),
      ],
      new Date("2026-08-03T14:00:00Z"),
    );

    expect(result.map((entry) => entry.id)).toEqual([
      "overdue",
      "today-earlier-created",
      "today-later",
      "deadline",
      "likely",
      "quiet",
      "other",
    ]);
  });

  it("orders same-day follow-ups by their stored instant within the today bucket", () => {
    const result = sortFollowUpsForToday(
      [
        item("today", "2026-08-03T15:00:00Z", "due"),
        item("late", "2026-08-03T13:59:59Z", "due"),
        item("future-deadline", "2026-08-04T13:00:00Z", "deadline"),
      ],
      new Date("2026-08-03T14:00:00Z"),
    );

    expect(result.map((entry) => entry.id)).toEqual([
      "late",
      "today",
      "future-deadline",
    ]);
  });

  it("keeps an earlier same-day follow-up ahead of a later one", () => {
    const result = sortFollowUpsForToday(
      [
        item("later-today", "2026-08-03T15:00:00Z", "due"),
        item("earlier-today", "2026-08-03T13:59:59Z", "due"),
      ],
      new Date("2026-08-03T14:00:00Z"),
    );

    expect(result.map((entry) => entry.id)).toEqual([
      "earlier-today",
      "later-today",
    ]);
  });
});

describe("selectFutureIncompleteFollowUp", () => {
  it("keeps a booking planned when it has both overdue and future open follow-ups", () => {
    const result = selectFutureIncompleteFollowUp(
      [
        {
          id: "overdue",
          dueAt: new Date("2026-08-03T13:00:00Z"),
          completedAt: null,
        },
        {
          id: "future",
          dueAt: new Date("2026-08-06T15:00:00Z"),
          completedAt: null,
        },
      ],
      new Date("2026-08-03T14:00:00Z"),
    );

    expect(result?.id).toBe("future");
    expect(
      needsFollowUpPlan(
        { status: "interested" },
        result,
        new Date("2026-08-03T14:00:00Z"),
      ),
    ).toBe(false);
  });
});
