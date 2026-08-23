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
      headline: "Start with overdue follow-ups",
      detail: `${input.overdueFollowUpCount} overdue · ${input.followUpCount} total follow-ups`,
      primaryLabel: "Continue follow-ups",
      primaryHref: "#my-work-calls",
    };
  }
  if (input.followUpCount > 0) {
    return {
      kind: "followups",
      headline: "Continue your follow-ups",
      detail: `${input.followUpCount} follow-up${input.followUpCount === 1 ? "" : "s"} ready`,
      primaryLabel: "Start calling",
      primaryHref: "#my-work-calls",
    };
  }
  if (input.contractCount > 0) {
    return {
      kind: "contracts",
      headline: "Work the contracts that need attention",
      detail: `${input.contractCount} contract${input.contractCount === 1 ? "" : "s"} in your queue`,
      primaryLabel: "Open booking work",
      primaryHref: "/bookings",
    };
  }
  if (input.decisionCount > 0) {
    return {
      kind: "decisions",
      headline: "Decide what happens next",
      detail: `${input.decisionCount} item${input.decisionCount === 1 ? "" : "s"} need a next step`,
      primaryLabel: "Review decisions",
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
