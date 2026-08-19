import { businessDateKey } from "@/lib/business-date";

type QueuePlan = { id: string; status?: string | null };
type QueueFollowUp = { bookingId?: string | null; bookingStatus?: string | null };

export function countQueueNewLeads(plans: QueuePlan[], followUps: QueueFollowUp[]) {
  const ids = new Set<string>();
  for (const item of plans) {
    if (item.status === "new_lead") ids.add(item.id);
  }
  for (const item of followUps) {
    if (item.bookingId && item.bookingStatus === "new_lead") ids.add(item.bookingId);
  }
  return ids.size;
}

export type TodayEventTiming = "in_progress" | "upcoming" | "past";

export function classifyTodayEventTiming(
  event: { startsAt: Date | null; endsAt?: Date | null },
  now = new Date(),
): TodayEventTiming {
  if (!event.startsAt) return "past";
  const today = businessDateKey(now);
  const start = businessDateKey(event.startsAt);
  const end = businessDateKey(event.endsAt ?? event.startsAt);
  if (start <= today && today <= end) return "in_progress";
  if (start > today) return "upcoming";
  return "past";
}
