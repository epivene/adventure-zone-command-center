import type { BossWorkRequestPriority, BossWorkRequestState } from "@workspace/db/boss-work-request-schema";

const transitions: Record<BossWorkRequestState, readonly BossWorkRequestState[]> = {
  waiting_on_dave: ["in_progress", "submitted_to_owner", "approved", "changes_requested", "cancelled"],
  in_progress: ["waiting_on_dave", "submitted_to_owner", "approved", "changes_requested", "cancelled"],
  submitted_to_owner: ["returned_for_clarification", "approved", "applied", "cancelled"],
  changes_requested: ["waiting_on_dave", "cancelled"],
  returned_for_clarification: ["in_progress", "submitted_to_owner", "cancelled"],
  approved: ["applied", "cancelled"],
  applied: [],
  cancelled: [],
};

export function canTransition(from: BossWorkRequestState, to: BossWorkRequestState): boolean {
  return from === to || transitions[from].includes(to);
}

export function assertTransition(from: BossWorkRequestState, to: BossWorkRequestState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid Boss work-request transition: ${from} -> ${to}`);
  }
}

const priorityRank: Record<BossWorkRequestPriority, number> = { urgent: 0, high: 1, normal: 2 };

export function compareWorkRequestUrgency(
  left: { priority: BossWorkRequestPriority; dueAt: Date | null; createdAt: Date },
  right: { priority: BossWorkRequestPriority; dueAt: Date | null; createdAt: Date },
): number {
  return priorityRank[left.priority] - priorityRank[right.priority]
    || (left.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
    || left.createdAt.getTime() - right.createdAt.getTime();
}
