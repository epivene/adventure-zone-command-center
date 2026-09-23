import { describe, expect, it } from "vitest";

import { deriveTodayFocus } from "./today-focus";

const base = {
  overdueFollowUpCount: 0,
  dueTodayFollowUpCount: 0,
  laterFollowUpCount: 0,
  followUpCount: 0,
  contractCount: 0,
  decisionCount: 0,
  upcomingEventCount: 0,
};

describe("deriveTodayFocus", () => {
  it("counts only overdue and due-today follow-ups as attention work", () => {
    expect(deriveTodayFocus({
      ...base,
      overdueFollowUpCount: 7,
      dueTodayFollowUpCount: 4,
      laterFollowUpCount: 39,
      followUpCount: 50,
    })).toMatchObject({
      kind: "overdue_followups",
      headline: "11 need attention",
      detail: "7 overdue · 4 due today · 39 scheduled for later",
      primaryLabel: "Start",
    });
  });

  it("prioritizes overdue follow-ups above every other workload", () => {
    expect(deriveTodayFocus({
      ...base,
      overdueFollowUpCount: 2,
      dueTodayFollowUpCount: 3,
      followUpCount: 5,
      contractCount: 3,
      decisionCount: 4,
      upcomingEventCount: 6,
    }).kind).toBe("overdue_followups");
  });

  it("uses due-today follow-ups before contracts or decisions", () => {
    expect(deriveTodayFocus({
      ...base,
      dueTodayFollowUpCount: 5,
      followUpCount: 12,
      laterFollowUpCount: 7,
      contractCount: 3,
      decisionCount: 4,
    }).kind).toBe("followups");
  });

  it("does not treat future follow-ups or contract counts as today's active workload", () => {
    expect(deriveTodayFocus({
      ...base,
      followUpCount: 39,
      laterFollowUpCount: 39,
      contractCount: 2,
    })).toMatchObject({
      kind: "caught_up",
      headline: "You're caught up for now",
      primaryHref: "#later-work",
    });
  });

  it("shows future follow-ups as scheduled context when active work is caught up", () => {
    expect(deriveTodayFocus({
      ...base,
      followUpCount: 39,
      laterFollowUpCount: 39,
    })).toMatchObject({
      kind: "caught_up",
      headline: "You're caught up for now",
      detail: "39 follow-ups are scheduled for later.",
      primaryLabel: "View later",
      primaryHref: "#later-work",
    });
  });

  it("presents a single due-today follow-up as one attention item", () => {
    expect(deriveTodayFocus({ ...base, dueTodayFollowUpCount: 1, followUpCount: 1 })).toMatchObject({
      headline: "1 needs attention",
      detail: "1 due today",
      primaryLabel: "Start",
    });
  });

  it("keeps contract counts out of Today action prioritization", () => {
    expect(deriveTodayFocus({ ...base, contractCount: 3, decisionCount: 4 }).kind).toBe("decisions");
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
