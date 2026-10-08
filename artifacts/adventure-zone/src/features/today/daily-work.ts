import { groupMasterWork, masterWorkHref } from "./group-master-work";
import type { MasterTodayQueue, MasterWorkItem } from "./master-work-types";
import type { FollowUpSummary } from "@/features/follow-ups/today-query";
import type { LegAssignmentView } from "@/components/bookings/leg-assignment-panel";
import { eventProfileHref, followUpHref } from "@/components/today/next-call-card";
import { classifyBusinessDueDate } from "@/lib/business-date";

export type DailyDecision = {
  id: string;
  name: string;
  organizationId?: string | null;
  primaryContactId?: string | null;
  city?: string | null;
  region?: string | null;
  status: string;
  planReason?: string;
  legAssignment?: LegAssignmentView | null;
  copilot?: { headline?: string } | null;
};

export type DailyWork = {
  id: string;
  name: string;
  kind: string;
  reason: string;
  href: string;
  dueAt: string | null;
  organizationId: string | null;
  contactId: string | null;
  bookingId: string | null;
  location: string;
  master?: MasterWorkItem;
  followUp?: FollowUpSummary;
  decision?: DailyDecision;
};

export function buildDailyWork(
  queue: MasterTodayQueue,
  followUps: FollowUpSummary[],
  decisions: DailyDecision[],
  now = new Date(),
) {
  const groups = groupMasterWork(queue, now);
  const toWork = (item: MasterWorkItem): DailyWork => ({
    id: item.id, name: item.eventName, kind: item.kind.replaceAll("_", " "),
    reason: item.reason, href: masterWorkHref(item), dueAt: item.dueAt,
    organizationId: item.organizationId, contactId: item.contactId,
    bookingId: item.bookingId,
    location: [item.city, item.region].filter(Boolean).join(", "),
    master: item,
    followUp: item.sourceType === "follow_up"
      ? followUps.find(followUp => followUp.id === item.sourceId) : undefined,
    decision: decisions.find(decision => decision.id === item.bookingId),
  });
  // Preserve server order (including pins/manual order) across categories.
  const dueThisBusinessDay = [...groups.waiting, ...groups.later].filter(item =>
    item.dueAt && classifyBusinessDueDate(new Date(item.dueAt), now) !== "future");
  const openIds = new Set([...groups.replies, ...groups.calls, ...groups.booking, ...dueThisBusinessDay].map(item => item.id));
  const open = [...queue.needsAttention, ...queue.active]
    .filter((item, index, all) => openIds.has(item.id) && all.findIndex(other => other.id === item.id) === index)
    .map(toWork);
  const later = [...groups.waiting, ...groups.later].filter(item => !openIds.has(item.id)).map(toWork);
  const allMaster = [...open, ...later];
  for (const followUp of followUps) {
    if (allMaster.some(item => item.master?.sourceType === "follow_up" && item.master.sourceId === followUp.id)) continue;
    const work: DailyWork = {
      id: `follow-up:${followUp.id}`, name: followUp.bookingName,
      kind: followUp.kind.replaceAll("_", " "), reason: "Scheduled follow-up",
      href: followUpHref(followUp), dueAt: followUp.dueAt.toISOString(),
      organizationId: followUp.organizationId, contactId: followUp.contactId,
      bookingId: followUp.bookingId, location: "", followUp,
      decision: decisions.find(decision => decision.id === followUp.bookingId),
    };
    (classifyBusinessDueDate(followUp.dueAt, now) === "future" ? later : open).push(work);
  }
  for (const decision of decisions) {
    if (open.some(item => item.bookingId === decision.id)) continue;
    open.push({
      id: `decision:${decision.id}`, name: decision.name,
      kind: decision.status === "new_lead" ? "Lead follow-up" : "Booking follow-up",
      reason: decision.planReason === "post_event" ? "Past event needs a follow-up decision" : "No future reminder scheduled",
      href: eventProfileHref({
        organizationId: decision.organizationId ?? null, bookingId: decision.id,
        contactId: decision.primaryContactId,
        mode: decision.status === "new_lead" ? "prospect" : undefined,
      }) ?? `/bookings/${decision.id}`,
      dueAt: null, organizationId: decision.organizationId ?? null,
      contactId: decision.primaryContactId ?? null, bookingId: decision.id,
      location: [decision.city, decision.region].filter(Boolean).join(", "),
      decision,
    });
  }
  return { open, later };
}
