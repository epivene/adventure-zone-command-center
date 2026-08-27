import type {
  OpportunityPriority,
  OpportunityStatus,
} from "@/features/opportunities/opportunity-types";
import {
  businessDayBounds,
  classifyBusinessDueDate,
} from "@/lib/business-date";

export type MasterWorkKind =
  | "reply"
  | "callback"
  | "follow_up"
  | "draft"
  | "research"
  | "review"
  | "new_outreach"
  | "booking"
  | "cleanup";

export type MasterWorkItem = {
  id: string;
  sourceId: string;
  sourceType: string;
  opportunityId: string | null;
  organizationId: string | null;
  bookingId: string | null;
  contactId: string | null;
  eventName: string;
  city: string | null;
  region: string | null;
  kind: MasterWorkKind;
  reason: string;
  dueAt: Date | null;
  opportunityStatus: OpportunityStatus | null;
  priority: OpportunityPriority;
  pinned: boolean;
  manualOrder: number | null;
  completedAt: Date | null;
};

export type MasterWorkCandidate = MasterWorkItem & {
  snoozedUntil: Date | null;
};

export type MasterTodayQueue = {
  needsAttention: MasterWorkItem[];
  active: MasterWorkItem[];
  completedToday: MasterWorkItem[];
};

export function applyEmailFailureAttention(
  candidate: MasterWorkCandidate,
  failureMessage: string,
): MasterWorkCandidate {
  return {
    ...candidate,
    kind: "review",
    reason: `Email delivery failed: ${failureMessage}`,
  };
}

function isDue(item: MasterWorkItem, now: Date): boolean {
  return Boolean(
    item.dueAt && classifyBusinessDueDate(item.dueAt, now) !== "future",
  );
}

function isHotLead(item: MasterWorkItem): boolean {
  return (
    item.opportunityStatus === "interested" ||
    item.priority === "urgent" ||
    item.priority === "high" ||
    item.kind === "booking"
  );
}

function smartRank(item: MasterWorkItem, now: Date): number {
  if (item.kind === "reply") return 0;
  if (item.kind === "callback" && isDue(item, now)) return 1;
  if (isHotLead(item)) return 2;
  if (item.kind === "follow_up" && isDue(item, now)) return 3;
  if (item.kind === "draft") return 4;
  if (item.kind === "review" || item.kind === "research") return 5;
  if (item.kind === "new_outreach") return 6;
  if (item.kind === "cleanup") return 7;
  return 6;
}

function compareWorkItems(
  left: MasterWorkItem,
  right: MasterWorkItem,
  now: Date,
): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;

  const leftHasManualOrder = left.manualOrder !== null;
  const rightHasManualOrder = right.manualOrder !== null;
  if (leftHasManualOrder !== rightHasManualOrder) {
    return leftHasManualOrder ? -1 : 1;
  }
  if (
    left.manualOrder !== null &&
    right.manualOrder !== null &&
    left.manualOrder !== right.manualOrder
  ) {
    return left.manualOrder - right.manualOrder;
  }

  const rankDifference = smartRank(left, now) - smartRank(right, now);
  if (rankDifference !== 0) return rankDifference;

  const priorityDifference =
    ({ urgent: 0, high: 1, normal: 2 } as const)[left.priority] -
    ({ urgent: 0, high: 1, normal: 2 } as const)[right.priority];
  if (priorityDifference !== 0) return priorityDifference;

  const dueDifference =
    (left.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) -
    (right.dueAt?.getTime() ?? Number.POSITIVE_INFINITY);
  if (dueDifference !== 0) return dueDifference;

  return left.id.localeCompare(right.id);
}

function needsAttention(item: MasterWorkItem, now: Date): boolean {
  return (
    item.kind === "reply" ||
    item.kind === "review" ||
    (item.kind === "callback" && isDue(item, now)) ||
    item.opportunityStatus === "interested" ||
    item.priority === "urgent"
  );
}

function stripCandidate(candidate: MasterWorkCandidate): MasterWorkItem {
  const { snoozedUntil: _snoozedUntil, ...item } = candidate;
  return item;
}

export function buildMasterTodayQueue(
  candidates: MasterWorkCandidate[],
  now: Date,
): MasterTodayQueue {
  const { start, end } = businessDayBounds(now);
  const completedToday = candidates
    .filter(
      ({ completedAt }) =>
        completedAt !== null && completedAt >= start && completedAt < end,
    )
    .map(stripCandidate)
    .sort((left, right) => {
      const completedDifference =
        (right.completedAt?.getTime() ?? 0) -
        (left.completedAt?.getTime() ?? 0);
      return completedDifference || left.id.localeCompare(right.id);
    });

  const open = candidates
    .filter(({ completedAt }) => completedAt === null)
    .filter(
      ({ snoozedUntil }) =>
        snoozedUntil === null || snoozedUntil.getTime() <= now.getTime(),
    )
    .map(stripCandidate);

  return {
    needsAttention: open
      .filter((item) => needsAttention(item, now))
      .sort((left, right) => compareWorkItems(left, right, now)),
    active: open
      .filter((item) => !needsAttention(item, now))
      .sort((left, right) => compareWorkItems(left, right, now)),
    completedToday,
  };
}
