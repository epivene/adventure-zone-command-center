export type FollowUpOpeningMode =
  | "auto"
  | "generic"
  | "left_voicemail"
  | "no_answer"
  | "spoke_before"
  | "requested_callback";

export type ResolvedFollowUpOpeningMode = Exclude<FollowUpOpeningMode, "auto">;

const followUpOpeningText: Record<ResolvedFollowUpOpeningMode, string> = {
  generic:
    "Hi {{contactName}}, I’m calling with The Adventure Zone. I just wanted to check back in about {{eventName}} and see where you guys are at with everything.",
  left_voicemail:
    "Hi {{contactName}}, I’m calling with The Adventure Zone. I tried reaching you a little while back about {{eventName}} and left you a voicemail, so I just wanted to try you again and see if you had a minute.",
  no_answer:
    "Hi {{contactName}}, I’m calling with The Adventure Zone. I tried catching you a little while back about {{eventName}}, so I wanted to try you again real quick.",
  spoke_before:
    "Hi {{contactName}}, I’m calling with The Adventure Zone. We talked a little while back about {{eventName}}, and I just wanted to check back in and see where you guys are at with everything.",
  requested_callback:
    "Hi {{contactName}}, I’m calling with The Adventure Zone. You’d asked me to check back with you about {{eventName}}, so I just wanted to give you a quick call and see where things are at.",
};

export const followUpOpeningLabels: Record<ResolvedFollowUpOpeningMode, string> = {
  generic: "Generic follow-up",
  left_voicemail: "Left voicemail last time",
  no_answer: "No answer last time",
  spoke_before: "We spoke before",
  requested_callback: "They asked me to call back",
};

export function detectFollowUpOpeningMode(lastOutcome: string | null | undefined): ResolvedFollowUpOpeningMode {
  const normalized = (lastOutcome ?? "").trim().toLowerCase().replaceAll(" ", "_");
  if (!normalized) return "generic";
  if (normalized === "left_voicemail" || normalized.includes("voicemail")) return "left_voicemail";
  if (normalized === "no_answer" || normalized.includes("no_answer")) return "no_answer";
  if (normalized.includes("callback") || normalized.includes("call_back")) return "requested_callback";
  if ([
    "spoke_with_contact",
    "interested",
    "proposal_contract_sent",
    "proposal_sent",
    "booked",
  ].includes(normalized)) return "spoke_before";
  return "generic";
}

export function followUpOpeningFor(input: {
  mode: FollowUpOpeningMode;
  lastOutcome?: string | null;
}): { mode: ResolvedFollowUpOpeningMode; say: string } {
  const mode = input.mode === "auto" ? detectFollowUpOpeningMode(input.lastOutcome) : input.mode;
  return { mode, say: followUpOpeningText[mode] };
}
