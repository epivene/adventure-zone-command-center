import type { BookingStatus } from "@/features/bookings/booking-types";
import type { CallDirection, CallScriptKind } from "@/features/calls/call-types";

export const callScriptPrompts: Record<CallScriptKind, string[]> = {
  first_outreach: ["Introduce Adventure Zone", "Confirm the event date and location", "Ask expected attendance", "Ask which package interests them", "Confirm the decision-maker", "Agree on the next step"],
  follow_up: ["Reference the previous conversation", "Confirm what changed", "Ask about concerns", "Confirm package interest", "Agree on the next step"],
  contract_follow_up: ["Confirm they received the proposal or contract", "Ask whether anything needs clarification", "Confirm deposit and decision timing", "Agree on the next step"],
  incoming_inquiry: ["Ask the caller's name and organization", "Confirm event date and location", "Ask expected attendance", "Ask package interest", "Capture the best callback details", "Agree on the next step"],
};

export function selectCallScript(input: {
  direction: CallDirection;
  followUpKind: string | null;
  bookingStatus: BookingStatus | null;
}): CallScriptKind {
  if (input.direction === "incoming") return "incoming_inquiry";
  if (
    input.followUpKind === "check_contract" ||
    input.bookingStatus === "pending_contract"
  ) return "contract_follow_up";
  if (input.bookingStatus === "new_lead") return "first_outreach";
  return "follow_up";
}
