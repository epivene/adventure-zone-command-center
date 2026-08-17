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

export type AssistantAskResponse = {
  answer: AssistantAnswer;
  brief: BookingBrief;
  context: AssistantContextBundle;
};

export type ActiveAssistantContext = {
  kind: AssistantContextKind;
  recordId: string;
  label?: string;
} | null;
