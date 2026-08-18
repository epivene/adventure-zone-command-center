export type AssistantContextKind =
  | "organization"
  | "contact"
  | "event_family"
  | "booking"
  | "calendar_event"
  | "route"
  | "call_workspace";

export type AssistantSourceReference = {
  id: string;
  kind:
    | "booking"
    | "activity"
    | "follow_up"
    | "package"
    | "resource"
    | "route"
    | "business_knowledge"
    | "derived_fact";
  recordId: string;
  label: string;
  occurredAt: string | null;
};

export type AssistantAnswer = {
  text: string;
  mode: "deterministic" | "cloud" | "offline_cached";
  confidence: "high" | "medium" | "low";
  sources: AssistantSourceReference[];
  needsAdmin: false;
};

export type AssistantProfileSearchResult = {
  id: string;
  kind: "organization" | "contact" | "event_family";
  label: string;
  secondaryLabel: string | null;
  city: string | null;
  region: string | null;
  status: string | null;
  lastContactAt: string | null;
  bookingCount: number | null;
  matchedOn: string[];
};

export type GeneralAssistantResponse =
  | { kind: "profile_results"; text: string; results: AssistantProfileSearchResult[] }
  | { kind: "answer"; answer: AssistantAnswer }
  | { kind: "needs_context"; text: string };

export type BookingBrief = {
  headline: string;
  items: Array<{
    key: string;
    text: string;
    confidence: "high" | "medium" | "low";
    sourceIds: string[];
  }>;
  generatedAt: string;
};

export type AssistantContextBundle = {
  context: { kind: AssistantContextKind; recordId: string; label: string };
  sources: AssistantSourceReference[];
  generatedAt: string;
  [key: string]: unknown;
};

export type AssistantConversationMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
  answerMode: AssistantAnswer["mode"] | null;
  confidence: AssistantAnswer["confidence"] | null;
  createdAt: string;
  sources: AssistantSourceReference[];
};

export type AssistantConversation = {
  id: string;
  contextKind: AssistantContextKind;
  contextRecordId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AssistantConversationMessage[];
};

export type AssistantAskResponse = {
  answer: AssistantAnswer;
  brief: BookingBrief;
  context: AssistantContextBundle;
  conversationId?: string;
};

export type ActiveAssistantContext = {
  kind: AssistantContextKind;
  recordId: string;
  label?: string;
} | null;
