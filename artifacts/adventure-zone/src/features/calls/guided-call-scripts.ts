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

export type GuidedCallScriptOverride = {
  scriptKind: GuidedCallScriptKind;
  nodeId: string;
  sayText: string;
  coachText: string | null;
  updatedAt?: string;
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
      say: "Awesome! Our Adventure Zone setup can include around 10–12 attractions, and we handle the setup, teardown, and staffing. What kind of crowd are you expecting this year?",
      coach: "Use saved event details first. Let them describe the crowd naturally, then confirm only missing date, location, attendance, or age-mix details.",
      responses: [
        { id: "details_captured", label: "Got the details", nextNodeId: "package_interest", suggestion: { collect: ["event_date", "location", "attendance"] } },
        commonPricing,
        commonCallback,
      ],
    },
    package_interest: {
      id: "package_interest",
      say: "What kind of energy are you hoping for — younger-family bounce houses and slides, competitive obstacle courses and adrenaline attractions, classic carnival games, or a mix with something for everyone?",
      coach: "Match the conversation to the crowd and event goals. Only name packages, attractions, prices, or capacities that are confirmed in Adventure Zone data.",
      responses: [
        { id: "package_known", label: "Package chosen", nextNodeId: "next_step", suggestion: { collect: ["package_interest"] } },
        commonPricing,
        { id: "needs_help", label: "Needs help choosing", nextNodeId: "pricing", suggestion: { collect: ["attendance", "package_interest"] } },
      ],
    },
    pricing: {
      id: "pricing",
      say: "We actually have a couple ways we can structure it. Depending on the event, there may be an option with no upfront cost to the event where we operate through ticket sales, or there’s a flat-fee option. I can email you more detailed info on the options we have and we can go from there.",
      coach: "Do not promise the no-upfront-cost option until the event meets the confirmed requirements. Use stored pricing and package details only, and email the fuller breakdown when that is more useful than explaining everything live.",
      responses: [
        { id: "pricing_answered", label: "Pricing answered", nextNodeId: "next_step", suggestion: { disposition: "interested" } },
        { id: "pricing_unknown", label: "Need to research", nextNodeId: "next_step", suggestion: { disposition: "follow_up_needed", nextAction: "research", noteFragment: "Need to confirm pricing/package details." } },
        commonCallback,
      ],
    },
    next_step: {
      id: "next_step",
      say: "What would make planning easiest for you next — photos and information to share with your team, a proposal built around the event, or a specific time for me to check back?",
      responses: [
        { id: "send_info", label: "Send information", nextNodeId: null, terminal: true, suggestion: { disposition: "interested", nextAction: "send_info", noteFragment: "Send event/package information." } },
        { id: "send_proposal", label: "Send proposal", nextNodeId: null, terminal: true, suggestion: { disposition: "proposal_contract_sent", nextAction: "send_proposal", noteFragment: "Contact requested a proposal." } },
        commonCallback,
      ],
    },
    callback_time: {
      id: "callback_time",
      say: "Absolutely — I do not want to catch you in the middle of everything. What day and time would be genuinely useful for me to call you back?",
      responses: [
        { id: "later_today", label: "Later today", nextNodeId: null, terminal: true, suggestion: { disposition: "follow_up_needed", nextAction: "call", followUpPreset: "later_today" } },
        { id: "tomorrow", label: "Tomorrow", nextNodeId: null, terminal: true, suggestion: { disposition: "follow_up_needed", nextAction: "call", followUpPreset: "tomorrow" } },
        { id: "next_week", label: "Next week", nextNodeId: null, terminal: true, suggestion: { disposition: "follow_up_needed", nextAction: "call", followUpPreset: "next_week" } },
      ],
    },
    decision_maker: {
      id: "decision_maker",
      say: "No worries. Who usually handles the entertainment or family-attraction side of the event, and what is the best way for me to reach them without making you play phone tag for us?",
      responses: [
        { id: "decision_maker_captured", label: "Got their info", nextNodeId: null, terminal: true, suggestion: { disposition: "follow_up_needed", nextAction: "call", collect: ["decision_maker"] } },
        { id: "unknown_decision_maker", label: "They don't know", nextNodeId: null, terminal: true, suggestion: { disposition: "follow_up_needed", nextAction: "research" } },
      ],
    },
    close_declined: {
      id: "close_declined",
      say: "Thanks for being straight with me. Before I let you get back to your day, is this just not a fit for this event or season, or would you rather The Adventure Zone not reach out again?",
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
    say: "Hi {{contactName}}, I’m calling with The Adventure Zone. We’re a traveling bounce-house carnival, and I’m calling about {{eventName}}. I just wanted to see what you’re planning this year and whether we might be a good fit.",
    coach: "Keep the opener short. Who you are, what The Adventure Zone is, and why you are calling — then let them talk before explaining attractions.",
    responses: [commonInterested, commonPricing, { id: "already_booked", label: "Already booked someone", nextNodeId: "close_declined" }, commonCallback, commonNotInterested, commonWrongPerson],
  }),
  rebooking: script("rebooking", "Past customer / rebooking", {
    id: "opening",
    say: "Hi {{contactName}}, I’m calling from The Adventure Zone. We’ve been part of {{eventName}} before, and I wanted to see what you’re planning this season — whether you want a familiar setup or something fresh for the crowd.",
    coach: "Treat this like a relationship, not a cold call. Reference saved history naturally, but never invent what happened before.",
    responses: [commonInterested, commonPricing, { id: "already_booked", label: "Already booked this year", nextNodeId: "close_declined" }, commonCallback, commonNotInterested, commonWrongPerson],
  }),
  follow_up: script("follow_up", "Follow-up", {
    id: "opening",
    say: "Hi {{contactName}}, I’m calling from The Adventure Zone to check back on {{eventName}}. I wanted to pick up where we left off and see what would help you feel comfortable choosing the right attraction mix for the event.",
    coach: "Lead with the saved reason for the follow-up and the last conversation. Do not make them start over.",
    responses: [commonInterested, commonPricing, { id: "needs_time", label: "Still deciding", nextNodeId: "callback_time", suggestion: { disposition: "follow_up_needed" } }, commonCallback, commonNotInterested, commonWrongPerson],
  }),
  proposal_contract: script("proposal_contract", "Proposal / contract follow-up", {
    id: "opening",
    say: "Hi {{contactName}}, I’m calling from The Adventure Zone about the proposal or contract for {{eventName}}. I wanted to make sure it reached you and see whether anything about the attraction mix, setup, or next steps needs a clearer answer.",
    coach: "Do not restart discovery unless the event changed. Focus on the specific decision, question, contract, or deposit holding things up.",
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
    say: "Hi {{contactName}}, I’m calling from The Adventure Zone and returning your call about {{eventName}}. Is now still a good time to talk through what you’re planning?",
    responses: [
      { id: "yes", label: "Yes", nextNodeId: "details", suggestion: { disposition: "spoke_with_contact" } },
      commonPricing,
      commonCallback,
      commonWrongPerson,
    ],
  }),
  incoming_inquiry: script("incoming_inquiry", "Incoming inquiry", {
    id: "opening",
    say: "Thanks for calling The Adventure Zone! We bring a full inflatable-carnival experience to events, and I’d be happy to help. Tell me a little about the crowd and the kind of fun you want people to remember.",
    coach: "Sound excited without rushing them. Start with their event and audience, then narrow the attractions and package.",
    responses: [commonInterested, commonPricing, { id: "just_question", label: "Just has a question", nextNodeId: "pricing" }, commonCallback],
  }),
};

export function getGuidedCallScript(kind: GuidedCallScriptKind): GuidedCallScript {
  return scripts[kind] ?? scripts.follow_up;
}

export function getConfiguredGuidedCallScript(
  kind: GuidedCallScriptKind,
  overrides: GuidedCallScriptOverride[] = [],
): GuidedCallScript {
  const base = getGuidedCallScript(kind);
  const applicable = new Map(
    overrides
      .filter((override) => override.scriptKind === base.kind && Boolean(base.nodes[override.nodeId]))
      .map((override) => [override.nodeId, override]),
  );
  if (applicable.size === 0) return base;

  const nodes: Record<string, GuidedCallNode> = {};
  for (const [nodeId, node] of Object.entries(base.nodes)) {
    const override = applicable.get(nodeId);
    if (!override) {
      nodes[nodeId] = node;
      continue;
    }
    nodes[nodeId] = {
      ...node,
      say: override.sayText,
      coach: override.coachText ?? undefined,
    };
  }
  return { ...base, nodes };
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
