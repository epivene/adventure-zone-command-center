export const FOLLOW_UP_KINDS = [
  { value: "email", label: "Email follow-up" },
  { value: "call", label: "Call" },
  { value: "2027_outreach", label: "2027 outreach" },
  { value: "post_event_feedback", label: "Post-event feedback" },
  { value: "convention_reply_check", label: "Convention reply check" },
  { value: "proposal_contract", label: "Proposal / contract" },
  { value: "application_deadline", label: "Application deadline" },
  { value: "deposit_payment", label: "Deposit / payment" },
  { value: "awaiting_decision", label: "Awaiting decision" },
  { value: "contact_repair", label: "Contact repair" },
  { value: "send_information", label: "Send information" },
  { value: "prepare_quote", label: "Prepare quote" },
  { value: "check_contract", label: "Check on contract" },
  { value: "application", label: "Application check" },
] as const;

export function defaultFollowUpKind(eventYear?: number): string {
  return eventYear && eventYear >= 2027 ? "2027_outreach" : "email";
}
