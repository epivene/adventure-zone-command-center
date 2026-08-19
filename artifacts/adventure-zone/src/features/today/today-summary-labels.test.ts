import { describe, expect, it } from "vitest";
import { classifyTodayEventTiming, countQueueNewLeads } from "./today-summary-labels";

describe("Today summary semantics", () => {
  it("counts only new leads actually represented in Today's Queue", () => {
    const count = countQueueNewLeads(
      [
        { id: "lead-a", status: "new_lead" },
        { id: "lead-b", status: "new_lead" },
        { id: "other", status: "confirmed" },
      ],
      [
        { bookingId: "lead-b", bookingStatus: "new_lead" },
        { bookingId: "lead-c", bookingStatus: "new_lead" },
        { bookingId: "lead-c", bookingStatus: "new_lead" },
      ],
    );

    expect(count).toBe(3);
  });

  it("labels a multi-day event spanning today as in progress", () => {
    const today = new Date("2026-08-19T16:00:00.000Z");
    expect(classifyTodayEventTiming({
      startsAt: new Date("2026-08-18T12:00:00.000Z"),
      endsAt: new Date("2026-08-20T23:00:00.000Z"),
    }, today)).toBe("in_progress");
  });

  it("labels a later event as upcoming", () => {
    const today = new Date("2026-08-19T16:00:00.000Z");
    expect(classifyTodayEventTiming({
      startsAt: new Date("2026-08-22T12:00:00.000Z"),
      endsAt: new Date("2026-08-22T23:00:00.000Z"),
    }, today)).toBe("upcoming");
  });
});
