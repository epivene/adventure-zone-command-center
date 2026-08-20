import type {
  CallDisposition,
  GuidedCallScriptKind,
} from "@/features/calls/call-types";

export const GUIDED_CALL_SCRIPT_KINDS: GuidedCallScriptKind[] = [
  "first_outreach",
  "rebooking",
  "follow_up",
  "proposal_contract",
  "callback",
  "incoming_inquiry",
];

export type GuidedCallSuggestion = {
  disposition?: CallDisposition;
  nextAction?: string;
  followUpPreset?: "later_today" | "tomorrow" | "next_week" | "next_season";
  noteFragment?: string;
  collect?: Array<"event_date" | "location" | "attendance" | "package_interest" | "decision_maker">;
};

export type GuidedCallResponse = {
  id: string;
  label: string;
  nextNodeId: string | null;
  terminal?: boolean;
  suggestion?: GuidedCallSuggestion;
};

export type GuidedCallNode = {
  id: string;
  say: string;
  coach?: string;
  responses: GuidedCallResponse[];
};

export type GuidedCallScript = {
  kind: GuidedCallScriptKind;
  label: string;
  startNodeId: string;
  nodes: Record<string, GuidedCallNode>;
};

export type GuidedCallRenderContext = {
  contactName?: string | null;
  eventName?: string | null;
  eventDate?: string | null;
  location?: string | null;
  packageInterest?: string | null;
};

const commonInterested: GuidedCallResponse = {
  id: "interested",
  label: "Interested",
  nextNodeId: "details",
  suggestion: { disposition: "interested", noteFragment: "Contact is interested." },
};

const commonPricing: GuidedCallResponse = {
  id: "need_pricing",
  label: "Need pricing",
  nextNodeId: "pricing",
  suggestion: {
    disposition: "interested",
    collect: ["event_date", "location", "attendance", "package_interest"],
    noteFragment: "Contact asked about pricing.",
  },
};

const commonCallback: GuidedCallResponse = {
  id: "call_back_later",
  label: "Call back later",
  nextNodeId: "callback_time",
  suggestion: {
    disposition: "follow_up_needed",
    nextAction: "call",
    followUpPreset: "tomorrow",
    noteFragment: "Contact requested a callback.",
  },
};

const commonNotInterested: GuidedCallResponse = {
  id: "not_interested",
  label: "Not interested",
  nextNodeId: "close_declined",
  suggestion: { disposition: "declined", noteFragment: "Contact is not interested right now." },
};

const commonWrongPerson: GuidedCallResponse = {
  id: "wrong_person",
  label: "Wrong person",
  nextNodeId: "decision_maker",
  suggestion: { collect: ["decision_maker"], noteFragment: "Need the correct decision-maker." },
};

function commonNodes(): Record<string, GuidedCallNode> {
  return {
    details: {
      id: "details",
      say: "Great. I just want to make sure I have the basics right. What date and location are you planning for, and about how many people do you expect?",
      coach: "Confirm only missing details; do not make them repeat information already in the profile.",
      responses: [
        { id: "details_captured", label: "Got the details", nextNodeId: "package_interest", suggestion: { collect: ["event_date", "location", "attendance"] } },
        commonPricing,
        commonCallback,
      ],
    },
    package_interest: {
      id: "package_interest",
      say: "Do you already have a package in mind, or would you like me to help narrow it down?",
      coach: "Only mention package facts already stored in Adventure Zone data.",
      responses: [
        { id: "package_known", label: "Package chosen", nextNodeId: "next_step", suggestion: { collect: ["package_interest"] } },
        commonPricing,
        { id: "needs_help", label: "Needs help choosing", nextNodeId: "pricing", suggestion: { collect: ["attendance", "package_interest"] } },
      ],
    },
    pricing: {
      id: "pricing",
      say: "I can go over the package information we have and make sure we match it to your event. I don't want to guess at anything that isn't confirmed.",
      coach: "Use stored package/pricing data only. If the answer is not in the app, use Ask Assistant or Needs Answer.",
      responses: [
        { id: "pricing_answered", label: "Pricing answered", nextNodeId: "next_step", suggestion: { disposition: "interested" } },
        { id: "pricing_unknown", label: "Need to research", nextNodeId: "next_step", suggestion: { disposition: "follow_up_needed", nextAction: "research", noteFragment: "Need to confirm pricing/package details." } },
        commonCallback,
      ],
    },
    next_step: {
      id: "next_step",
      say: "What would be most helpful next — sending information, putting together a proposal, or setting a time to follow up?",
      responses: [
        { id: "send_info", label: "Send information", nextNodeId: null, terminal: true, suggestion: { disposition: "interested", nextAction: "send_info", noteFragment: "Send event/package information." } },
        { id: "send_proposal", label: "Send proposal", nextNodeId: null, terminal: true, suggestion: { disposition: "proposal_contract_sent", nextAction: "send_proposal", noteFragment: "Contact requested a proposal." } },
        commonCallback,
      ],
    },
    callback_time: {
      id: "callback_time",
      say: "Absolutely. When would be a better time for me to call you back?",
      responses: [
        { id: "later_today", label: "Later today", nextNodeId: null, terminal: true, suggestion: { disposition: "follow_up_needed", nextAction: "call", followUpPreset: "later_today" } },
        { id: "tomorrow", label: "Tomorrow", nextNodeId: null, terminal: true, suggestion: { disposition: "follow_up_needed", nextAction: "call", followUpPreset: "tomorrow" } },
        { id: "next_week", label: "Next week", nextNodeId: null, terminal: true, suggestion: { disposition: "follow_up_needed", nextAction: "call", followUpPreset: "next_week" } },
      ],
    },
    decision_maker: {
      id: "decision_maker",
      say: "No problem — who is the best person for me to speak with about the event, and what's the best way to reach them?",
      responses: [
        { id: "decision_maker_captured", label: "Got their info", nextNodeId: null, terminal: true, suggestion: { disposition: "follow_up_needed", nextAction: "call", collect: ["decision_maker"] } },
        { id: "unknown_decision_maker", label: "They don't know", nextNodeId: null, terminal: true, suggestion: { disposition: "follow_up_needed", nextAction: "research" } },
      ],
    },
    close_declined: {
      id: "close_declined",
      say: "Thanks for letting me know. Before I let you go, is that just for this event/year, or should we not reach out again?",
      responses: [
        { id: "this_year_only", label: "This year only", nextNodeId: null, terminal: true, suggestion: { disposition: "follow_up_needed", nextAction: "future_season", followUpPreset: "next_season", noteFragment: "Booked/declined for this season only; revisit next season." } },
        { id: "do_not_call", label: "Do not call again", nextNodeId: null, terminal: true, suggestion: { disposition: "do_not_call", noteFragment: "Contact requested no further calls." } },
        { id: "declined", label: "Just not interested", nextNodeId: null, terminal: true, suggestion: { disposition: "declined" } },
      ],
    },
  };
}

function script(kind: GuidedCallScriptKind, label: string, opening: GuidedCallNode): GuidedCallScript {
  return {
    kind,
    label,
    startNodeId: opening.id,
    nodes: { [opening.id]: opening, ...commonNodes() },
  };
}

const scripts: Record<GuidedCallScriptKind, GuidedCallScript> = {
  first_outreach: script("first_outreach", "First outreach", {
    id: "opening",
    say: "Hi {{contactName}}, this is Adventure Zone. I'm calling about {{eventName}} and wanted to see where you are in planning and whether we can help.",
    coach: "Friendly introduction; do not assume they remember us.",
    responses: [commonInterested, commonPricing, { id: "already_booked", label: "Already booked someone", nextNodeId: "close_declined" }, commonCallback, commonNotInterested, commonWrongPerson],
  }),
  rebooking: script("rebooking", "Past customer / rebooking", {
    id: "opening",
    say: "Hi {{contactName}}, this is Adventure Zone. We've worked with you before and I wanted to check in about {{eventName}} this season.",
    coach: "Reference the existing relationship rather than giving a cold-call introduction.",
    responses: [commonInterested, commonPricing, { id: "already_booked", label: "Already booked this year", nextNodeId: "close_declined" }, commonCallback, commonNotInterested, commonWrongPerson],
  }),
  follow_up: script("follow_up", "Follow-up", {
    id: "opening",
    say: "Hi {{contactName}}, this is Adventure Zone following up about {{eventName}}. I wanted to pick up from our last conversation and see what you need next.",
    responses: [commonInterested, commonPricing, { id: "needs_time", label: "Still deciding", nextNodeId: "callback_time", suggestion: { disposition: "follow_up_needed" } }, commonCallback, commonNotInterested, commonWrongPerson],
  }),
  proposal_contract: script("proposal_contract", "Proposal / contract follow-up", {
    id: "opening",
    say: "Hi {{contactName}}, this is Adventure Zone. I'm following up on the proposal or contract for {{eventName}} and wanted to make sure you received it and see if anything needs clarification.",
    coach: "Do not restart basic discovery unless something materially changed.",
    responses: [
      { id: "ready", label: "Ready to move forward", nextNodeId: "next_step", suggestion: { disposition: "interested", noteFragment: "Ready to move forward with proposal/contract." } },
      { id: "question", label: "Has a question", nextNodeId: "pricing" },
      { id: "not_received", label: "Didn't receive it", nextNodeId: "next_step", suggestion: { disposition: "follow_up_needed", nextAction: "resend_proposal", noteFragment: "Proposal/contract needs to be resent." } },
      commonCallback,
      commonNotInterested,
    ],
  }),
  callback: script("callback", "Requested callback", {
    id: "opening",
    say: "Hi {{contactName}}, this is Adventure Zone returning your call about {{eventName}}. Is now still a good time?",
    responses: [
      { id: "yes", label: "Yes", nextNodeId: "details", suggestion: { disposition: "spoke_with_contact" } },
      commonPricing,
      commonCallback,
      commonWrongPerson,
    ],
  }),
  incoming_inquiry: script("incoming_inquiry", "Incoming inquiry", {
    id: "opening",
    say: "Thanks for calling Adventure Zone. I can help with that. Let me get a few details about your event so I can point you in the right direction.",
    responses: [commonInterested, commonPricing, { id: "just_question", label: "Just has a question", nextNodeId: "pricing" }, commonCallback],
  }),
};

export function getGuidedCallScript(kind: GuidedCallScriptKind): GuidedCallScript {
  return scripts[kind] ?? scripts.follow_up;
}

export function validateGuidedCallScript(scriptValue: GuidedCallScript): string[] {
  const errors: string[] = [];
  if (!scriptValue.nodes[scriptValue.startNodeId]) errors.push(`Missing start node ${scriptValue.startNodeId}`);
  for (const node of Object.values(scriptValue.nodes)) {
    for (const response of node.responses) {
      if (!response.terminal && response.nextNodeId && !scriptValue.nodes[response.nextNodeId]) {
        errors.push(`${node.id}.${response.id} points to missing node ${response.nextNodeId}`);
      }
      if (!response.terminal && response.nextNodeId === null) {
        errors.push(`${node.id}.${response.id} has no next node and is not terminal`);
      }
    }
  }
  return errors;
}

export function renderGuidedText(text: string, context: GuidedCallRenderContext): string {
  const replacements: Record<string, string> = {
    contactName: context.contactName?.trim() || "there",
    eventName: context.eventName?.trim() || "your event",
    eventDate: context.eventDate?.trim() || "the event date",
    location: context.location?.trim() || "the event location",
    packageInterest: context.packageInterest?.trim() || "the package options",
  };
  return text.replace(/\{\{(contactName|eventName|eventDate|location|packageInterest)\}\}/g, (_match, key: string) => replacements[key] ?? "");
}
