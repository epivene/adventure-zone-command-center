export type TodayFocusKind =
  | "overdue_followups"
  | "followups"
  | "contracts"
  | "decisions"
  | "schedule"
  | "caught_up";

export type TodayFocusInput = {
  overdueFollowUpCount: number;
  dueTodayFollowUpCount: number;
  laterFollowUpCount: number;
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

function attentionHeadline(count: number) {
  return `${count} ${count === 1 ? "needs" : "need"} attention`;
}

function followUpDetail(input: TodayFocusInput) {
  const parts: string[] = [];
  if (input.overdueFollowUpCount) parts.push(`${input.overdueFollowUpCount} overdue`);
  if (input.dueTodayFollowUpCount) parts.push(`${input.dueTodayFollowUpCount} due today`);
  if (input.laterFollowUpCount) parts.push(`${input.laterFollowUpCount} scheduled for later`);
  return parts.join(" · ");
}

export function deriveTodayFocus(input: TodayFocusInput): TodayFocus {
  const actionableFollowUps = input.overdueFollowUpCount + input.dueTodayFollowUpCount;

  if (input.overdueFollowUpCount > 0) {
    return {
      kind: "overdue_followups",
      headline: attentionHeadline(actionableFollowUps),
      detail: followUpDetail(input),
      primaryLabel: "Start",
      primaryHref: "#today-next-task",
    };
  }
  if (input.dueTodayFollowUpCount > 0) {
    return {
      kind: "followups",
      headline: attentionHeadline(actionableFollowUps),
      detail: followUpDetail(input),
      primaryLabel: "Start",
      primaryHref: "#today-next-task",
    };
  }
  if (input.contractCount > 0) {
    return {
      kind: "contracts",
      headline: attentionHeadline(input.contractCount),
      detail: "Booking or contract work needs your attention",
      primaryLabel: "Start",
      primaryHref: "/profiles",
    };
  }
  if (input.decisionCount > 0) {
    return {
      kind: "decisions",
      headline: attentionHeadline(input.decisionCount),
      detail: "Decide what happens with the highest-priority lead or past event",
      primaryLabel: "Start",
      primaryHref: "#my-work-decisions",
    };
  }
  if (input.upcomingEventCount > 0) {
    return {
      kind: "schedule",
      headline: "Your active work is caught up",
      detail: input.laterFollowUpCount
        ? `${input.laterFollowUpCount} follow-up${input.laterFollowUpCount === 1 ? " is" : "s are"} scheduled for later · ${input.upcomingEventCount} upcoming event${input.upcomingEventCount === 1 ? "" : "s"}`
        : `${input.upcomingEventCount} upcoming event${input.upcomingEventCount === 1 ? "" : "s"} on the schedule`,
      primaryLabel: "View schedule",
      primaryHref: "/schedule",
    };
  }
  return {
    kind: "caught_up",
    headline: "You're caught up for now",
    detail: input.laterFollowUpCount
      ? `${input.laterFollowUpCount} follow-up${input.laterFollowUpCount === 1 ? " is" : "s are"} scheduled for later.`
      : "Nothing urgent is waiting on you.",
    primaryLabel: input.laterFollowUpCount ? "View later" : "Find opportunities",
    primaryHref: input.laterFollowUpCount ? "#later-work" : "/research-sources",
  };
}
