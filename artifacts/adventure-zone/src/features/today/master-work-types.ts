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
  dueAt: string | null;
  opportunityStatus: string | null;
  priority: "normal" | "high" | "urgent";
  pinned: boolean;
  manualOrder: number | null;
  completedAt: string | null;
  outcome: string | null;
};

export type MasterTodayQueue = {
  needsAttention: MasterWorkItem[];
  active: MasterWorkItem[];
  completedToday: MasterWorkItem[];
};

export const emptyMasterTodayQueue: MasterTodayQueue = {
  needsAttention: [],
  active: [],
  completedToday: [],
};

export function coerceMasterTodayQueue(value: unknown): MasterTodayQueue {
  if (!value || typeof value !== "object") return emptyMasterTodayQueue;
  const queue = value as Partial<MasterTodayQueue>;
  return {
    needsAttention: Array.isArray(queue.needsAttention) ? queue.needsAttention : [],
    active: Array.isArray(queue.active) ? queue.active : [],
    completedToday: Array.isArray(queue.completedToday) ? queue.completedToday : [],
  };
}
