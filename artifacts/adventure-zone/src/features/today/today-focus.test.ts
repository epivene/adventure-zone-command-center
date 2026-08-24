import { describe, expect, it } from "vitest";

import { deriveTodayFocus } from "./today-focus";

const base = {
  overdueFollowUpCount: 0,
  followUpCount: 0,
  contractCount: 0,
  decisionCount: 0,
  upcomingEventCount: 0,
};

describe("deriveTodayFocus", () => {
  it("prioritizes overdue follow-ups above every other workload", () => {
    expect(deriveTodayFocus({ ...base, overdueFollowUpCount: 2, followUpCount: 5, contractCount: 3, decisionCount: 4, upcomingEventCount: 6 }).kind).toBe("overdue_followups");
  });

  it("uses remaining follow-ups before contracts or decisions", () => {
    expect(deriveTodayFocus({ ...base, followUpCount: 5, contractCount: 3, decisionCount: 4 }).kind).toBe("followups");
  });

  it("presents a single follow-up as one compact next task", () => {
    expect(deriveTodayFocus({ ...base, followUpCount: 1 })).toMatchObject({
      headline: "1 task remaining",
      detail: "Next: follow up with your highest-priority event",
      primaryLabel: "Start",
    });
  });

  it("uses contracts before unscheduled next-step decisions", () => {
    expect(deriveTodayFocus({ ...base, contractCount: 3, decisionCount: 4 }).kind).toBe("contracts");
  });

  it("uses decision work before schedule-only context", () => {
    expect(deriveTodayFocus({ ...base, decisionCount: 4, upcomingEventCount: 6 }).kind).toBe("decisions");
  });

  it("falls back to schedule when there is no active work", () => {
    expect(deriveTodayFocus({ ...base, upcomingEventCount: 6 }).kind).toBe("schedule");
  });

  it("shows a caught-up state when there is nothing active or upcoming", () => {
    expect(deriveTodayFocus(base).kind).toBe("caught_up");
  });
});