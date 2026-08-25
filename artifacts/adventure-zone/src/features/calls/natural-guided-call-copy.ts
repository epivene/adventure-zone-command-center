import type { GuidedCallScriptKind } from "@/features/calls/call-types";

const naturalCopy: Partial<Record<GuidedCallScriptKind, Record<string, string>>> = {
  first_outreach: {
    opening: "Hi {{contactName}}, I’m calling from The Adventure Zone about {{eventName}}. I just wanted to see what you guys have planned this year and whether you might be interested in having us there.",
  },
  rebooking: {
    opening: "Hi {{contactName}}, I’m calling from The Adventure Zone. We’ve been part of {{eventName}} before, and I just wanted to check in and see what you guys are thinking for this year.",
  },
  follow_up: {
    opening: "Hi {{contactName}}, I’m calling from The Adventure Zone. I just wanted to check back in about {{eventName}} and see where you guys are at with everything.",
  },
  proposal_contract: {
    opening: "Hi {{contactName}}, I’m calling from The Adventure Zone. I just wanted to check in on the proposal or contract for {{eventName}} and see if you had any questions or needed anything from me.",
  },
  callback: {
    opening: "Hi {{contactName}}, I’m calling from The Adventure Zone. You’d asked me to give you a call back about {{eventName}}, so I just wanted to catch you and see if now is a good time.",
  },
  incoming_inquiry: {
    opening: "Hi, this is The Adventure Zone. What can I help you with?",
  },
};

const commonNaturalCopy: Record<string, string> = {
  details: "Awesome. We usually bring around 10–12 attractions, and we handle the setup, teardown, and staffing. About how many people are you expecting, and what kind of crowd is it?",
  package_interest: "Okay, what are you kind of looking for — more bounce houses and slides for younger kids, bigger obstacle-course type stuff, carnival games, or just a good mix of everything?",
  pricing: "We have a couple different ways we can do it. There’s the regular flat-fee option, and depending on the event there may be a ticket-sales option with no upfront cost to the event. I can send you the current details so you can look everything over.",
  next_step: "Awesome. Is there anything you need from me right now — pricing, pictures, more information, a proposal, anything like that?",
  callback_time: "No problem. When would be a better time for me to call you back?",
  decision_maker: "No problem. Do you know who handles the entertainment or family-attraction stuff for the event, or the best way for me to get ahold of them?",
  already_booked_response: "Gotcha, no problem. Is that just for this year, or would you like me to check back with you next season?",
  space_constraint: "Okay, I understand. We do have a smaller Mini Zone. Would you want me to send you some information on that, or is the space just too tight either way?",
  budget_constraint: "I understand. We do have a smaller option, and depending on the event there may be another way we can structure the payment. I don’t want to promise anything before I check the details, but do you want me to see what might work?",
  event_not_happening: "Oh, okay. Do you think the event will be back next year, or is it done for now?",
  policy_restriction: "Gotcha. Is that a firm rule, or would it help if I sent over our insurance and safety information for them to look at?",
  past_customer_feedback: "I’m sorry to hear that. If you don’t mind telling me, what happened? I want to make sure I write it down right and get it to the right person.",
  close_declined: "No problem. Is that mostly just for this year, or would you rather we not reach back out next season either?",
};

export function naturalGuidedCallSay(input: {
  kind: GuidedCallScriptKind;
  nodeId: string;
  fallback: string;
  hasAdminOverride?: boolean;
}): string {
  if (input.hasAdminOverride) return input.fallback;
  return naturalCopy[input.kind]?.[input.nodeId] ?? commonNaturalCopy[input.nodeId] ?? input.fallback;
}
