import { classifyBusinessDueDate } from "@/lib/business-date";
import type { FollowUpPlanItem, FollowUpSummary, TodayDashboard } from "./today-query";

export type BookingCopilotPriority = "urgent" | "high" | "normal" | "low";

export type BookingCopilotReason = {
  priority: BookingCopilotPriority;
  headline: string;
  reasons: string[];
};

export type CopilotFollowUpSummary = FollowUpSummary & {
  copilot: BookingCopilotReason;
};

export type CopilotFollowUpPlanItem = FollowUpPlanItem & {
  copilot: BookingCopilotReason;
};

export type TodayDashboardWithCopilot = Omit<
  TodayDashboard,
  "nextCall" | "followUps" | "needsFollowUpPlan"
> & {
  nextCall: CopilotFollowUpSummary | null;
  followUps: CopilotFollowUpSummary[];
  needsFollowUpPlan: CopilotFollowUpPlanItem[];
};

const pendingContractStatuses = new Set(["pending_contract", "contract_received"]);

function hasRouteWarning(item: { operations?: { warnings?: Array<{ kind: string; message?: string }> } | null }) {
  return item.operations?.warnings?.find((warning) => warning.kind === "route") ?? null;
}

export function dedupeFollowUpsByBooking(items: FollowUpSummary[]): FollowUpSummary[] {
  const seenBookingIds = new Set<string>();
  const sorted = [...items].sort((left, right) =>
    left.dueAt.getTime() - right.dueAt.getTime() ||
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.id.localeCompare(right.id),
  );

  return sorted.filter((item) => {
    if (!item.bookingId) return true;
    if (seenBookingIds.has(item.bookingId)) return false;
    seenBookingIds.add(item.bookingId);
    return true;
  });
}

export function explainFollowUpAction(
  item: FollowUpSummary,
  now: Date,
): BookingCopilotReason {
  const reasons: string[] = [];
  const due = classifyBusinessDueDate(item.dueAt, now);
  let priority: BookingCopilotPriority = "low";
  let headline = "Follow up when ready";

  if (due === "overdue") {
    priority = "urgent";
    headline = "Overdue follow-up";
    reasons.push("This follow-up is overdue.");
  } else if (due === "today") {
    priority = "high";
    headline = "Due today";
    reasons.push("This follow-up is due today.");
  }

  if (item.bookingStatus && pendingContractStatuses.has(item.bookingStatus)) {
    if (priority !== "urgent") priority = "high";
    if (headline === "Follow up when ready") headline = "Contract needs attention";
    reasons.push("Contract paperwork is still in progress.");
  } else if (item.bookingStatus === "pending_decision" || item.status === "deadline") {
    if (priority !== "urgent") priority = "high";
    if (headline === "Follow up when ready") headline = "Decision needs attention";
    reasons.push("A decision or deadline is waiting on follow-up.");
  }

  if (item.probability === "likely") {
    if (priority === "low" || priority === "normal") priority = "high";
    if (headline === "Follow up when ready") headline = "Likely opportunity";
    reasons.push("Likely opportunity based on the current booking probability.");
  }

  if (item.status === "quiet_lead") {
    if (priority === "low") priority = "normal";
    if (headline === "Follow up when ready") headline = "Lead has gone quiet";
    reasons.push("This lead has been quiet long enough to deserve another touch.");
  }

  const routeWarning = hasRouteWarning(item);
  if (routeWarning) {
    if (priority === "low") priority = "normal";
    reasons.push(routeWarning.message?.trim() || "Route needs review.");
  }

  if (!reasons.length) {
    priority = "normal";
    headline = "Scheduled follow-up";
    reasons.push("This is the next scheduled follow-up in your queue.");
  }

  return { priority, headline, reasons: reasons.slice(0, 3) };
}

export function explainFollowUpPlanAction(
  item: FollowUpPlanItem,
): BookingCopilotReason {
  const reasons: string[] = [];
  let priority: BookingCopilotPriority = "normal";
  let headline = "Choose the next step";

  if (item.planReason === "post_event") {
    priority = "high";
    headline = "Past event needs follow-up";
    reasons.push("This past event still needs a follow-up decision.");
  } else {
    reasons.push("No future follow-up is scheduled yet.");
  }

  if (item.probability === "likely") {
    priority = "high";
    if (item.planReason !== "post_event") headline = "Likely opportunity needs a next step";
    reasons.push("Likely opportunity based on the current booking probability.");
  }

  if (item.status === "new_lead") {
    reasons.push("This is a new lead that has not been given a next step yet.");
  } else if (item.status === "pending_contract" || item.status === "contract_received") {
    priority = "high";
    headline = "Contract needs a next step";
    reasons.push("Contract paperwork is still in progress.");
  } else if (item.status === "pending_decision") {
    priority = "high";
    headline = "Decision needs a next step";
    reasons.push("A booking decision is still pending.");
  }

  const routeWarning = hasRouteWarning(item);
  if (routeWarning) {
    if (priority === "normal") priority = "high";
    reasons.push(routeWarning.message?.trim() || "Route needs review.");
  }

  return { priority, headline, reasons: reasons.slice(0, 3) };
}

export function withBookingCopilotMetadata(
  dashboard: TodayDashboard,
  now: Date,
): TodayDashboardWithCopilot {
  const followUps = dedupeFollowUpsByBooking(dashboard.followUps);
  return {
    ...dashboard,
    followUpCount: followUps.length,
    followUpTotal: followUps.length,
    nextCall: dashboard.nextCall
      ? { ...dashboard.nextCall, copilot: explainFollowUpAction(dashboard.nextCall, now) }
      : null,
    followUps: followUps.map((item) => ({
      ...item,
      copilot: explainFollowUpAction(item, now),
    })),
    needsFollowUpPlan: dashboard.needsFollowUpPlan.map((item) => ({
      ...item,
      copilot: explainFollowUpPlanAction(item),
    })),
  };
}
