export type TodayFocusKind =
  | "overdue_followups"
  | "followups"
  | "contracts"
  | "decisions"
  | "schedule"
  | "caught_up";

export type TodayFocusInput = {
  overdueFollowUpCount: number;
  followUpCount: number;
  contractCount: number;
  decisionCount: number;
  upcomingEventCount: number;
};

export type TodayFocus = {
  kind: TodayFocusKind;
  headline: string;
  detail: string;
  primaryLabel: string;
  primaryHref: string;
};

export function deriveTodayFocus(input: TodayFocusInput): TodayFocus {
  if (input.overdueFollowUpCount > 0) {
    return {
      kind: "overdue_followups",
      headline: `${input.followUpCount} task${input.followUpCount === 1 ? "" : "s"} remaining`,
      detail: `${input.overdueFollowUpCount} overdue · Start with your highest-priority follow-up`,
      primaryLabel: "Start",
      primaryHref: "#today-next-task",
    };
  }
  if (input.followUpCount > 0) {
    return {
      kind: "followups",
      headline: `${input.followUpCount} task${input.followUpCount === 1 ? "" : "s"} remaining`,
      detail: "Next: follow up with your highest-priority event",
      primaryLabel: "Start",
      primaryHref: "#today-next-task",
    };
  }
  if (input.contractCount > 0) {
    return {
      kind: "contracts",
      headline: `${input.contractCount} task${input.contractCount === 1 ? "" : "s"} remaining`,
      detail: "Next: work the booking or contract that needs attention",
      primaryLabel: "Start",
      primaryHref: "/bookings",
    };
  }
  if (input.decisionCount > 0) {
    return {
      kind: "decisions",
      headline: `${input.decisionCount} task${input.decisionCount === 1 ? "" : "s"} remaining`,
      detail: "Next: decide what happens with the highest-priority lead or past event",
      primaryLabel: "Start",
      primaryHref: "#my-work-decisions",
    };
  }
  if (input.upcomingEventCount > 0) {
    return {
      kind: "schedule",
      headline: "Your active work is caught up",
      detail: `${input.upcomingEventCount} upcoming event${input.upcomingEventCount === 1 ? "" : "s"} on the schedule`,
      primaryLabel: "View schedule",
      primaryHref: "/schedule",
    };
  }
  return {
    kind: "caught_up",
    headline: "You're caught up for now",
    detail: "Nothing urgent is waiting on you.",
    primaryLabel: "Find opportunities",
    primaryHref: "/research-sources",
  };
}