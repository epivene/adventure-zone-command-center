export type CallScriptKind =
  | "first_outreach"
  | "follow_up"
  | "contract_follow_up"
  | "incoming_inquiry";

export const callScriptPrompts: Record<CallScriptKind, string[]> = {
  first_outreach: ["Introduce Adventure Zone", "Confirm the event date and location", "Ask expected attendance", "Ask which package interests them", "Confirm the decision-maker", "Agree on the next step"],
  follow_up: ["Reference the previous conversation", "Confirm what changed", "Ask about concerns", "Confirm package interest", "Agree on the next step"],
  contract_follow_up: ["Confirm they received the proposal or contract", "Ask whether anything needs clarification", "Confirm deposit and decision timing", "Agree on the next step"],
  incoming_inquiry: ["Ask the caller's name and organization", "Confirm event date and location", "Ask expected attendance", "Ask package interest", "Capture the best callback details", "Agree on the next step"],
};
