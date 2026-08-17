export const assistantContextKindValues = [
  "organization",
  "contact",
  "event_family",
  "booking",
  "calendar_event",
  "route",
  "call_workspace",
] as const;

export type AssistantContextKind = (typeof assistantContextKindValues)[number];

export const assistantSourceKindValues = [
  "booking",
  "activity",
  "follow_up",
  "package",
  "resource",
  "route",
  "business_knowledge",
  "derived_fact",
] as const;

export type AssistantSourceKind = (typeof assistantSourceKindValues)[number];

export type AssistantSourceReference = {
  id: string;
  kind: AssistantSourceKind;
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

export function serializeAssistantSource(input: Omit<AssistantSourceReference, "occurredAt"> & {
  occurredAt: Date | string | null;
}): AssistantSourceReference {
  return {
    ...input,
    occurredAt:
      input.occurredAt instanceof Date
        ? input.occurredAt.toISOString()
        : input.occurredAt,
  };
}
