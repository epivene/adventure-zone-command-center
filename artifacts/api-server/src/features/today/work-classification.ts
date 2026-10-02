import type { OpportunityStatus } from "../opportunities/opportunity-types";
import type { MasterWorkKind } from "./master-work-queue";

export function kindFor(
  actionKind: string | null,
  status: OpportunityStatus | null,
  hasFollowUp: boolean,
): MasterWorkKind {
  const value = actionKind?.trim().toLowerCase().replaceAll("-", "_") ?? "";
  // kind is also used for full reminder sentences. Words inside that text
  // are not evidence that a customer replied, a draft exists, or a send occurred.
  const exact: Record<string, MasterWorkKind> = {
    reply: "follow_up",
    response: "follow_up",
    follow_up: "follow_up",
    callback: "callback",
    call: "callback",
    returned_call: "callback",
    draft: "draft",
    ready_to_send: "draft",
    research: "research",
    scout: "research",
    review: "review",
    check: "review",
    booking: "booking",
    contract: "booking",
  };
  if (Object.hasOwn(exact, value)) return exact[value];
  if (hasFollowUp || value) return "follow_up";
  if (status === "ready_to_contact") return "draft";
  if (status === "new_lead") return "new_outreach";
  if (status === "researching") return "research";
  if (status === "needs_review") return "review";
  if (
    status === "interested" ||
    status === "booking_in_progress" ||
    status === "booked"
  ) {
    return "booking";
  }
  return hasFollowUp || value ? "follow_up" : "cleanup";
}

export function reasonFor(
  kind: MasterWorkKind,
  completed: boolean,
  actionKind: string | null,
): string {
  if (actionKind?.trim()) return actionKind.trim();
  if (completed) return "Completed today";
  return {
    reply: "Review conversation",
    callback: "Callback",
    follow_up: "Follow-up",
    draft: "Draft review",
    research: "Research is needed",
    review: "Needs review",
    new_outreach: "New outreach",
    booking: "Booking work",
    cleanup: "Profile cleanup",
  }[kind];
}
