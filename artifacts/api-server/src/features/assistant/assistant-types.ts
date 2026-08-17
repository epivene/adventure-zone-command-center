import type { PackageHistorySignal } from "@/features/packages/package-history";

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
  "handoff",
  "acknowledgment",
  "operations_knowledge",
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

export type BookingAssistantBookingSummary = {
  id: string;
  label: string;
  startsAt: string | null;
  status: string;
  physicalAttractionTotal: number | null;
  packageNames: string[];
  specialResourceNames: string[];
};

export type BookingAssistantActivitySummary = {
  id: string;
  kind: string;
  summary: string;
  occurredAt: string | null;
  sourceIds: string[];
};

export type BookingAssistantFollowUpSummary = {
  id: string;
  kind: string;
  dueAt: string;
  label: string;
};

export type BookingAssistantRouteSummary = {
  id: string;
  label: string;
  summary: string;
};

export type BookingAssistantDerivedFactSummary = {
  id: string;
  factKind: string;
  summary: string;
  confidence: "high" | "medium" | "low";
  status: "proposed" | "confirmed" | "dismissed";
  sourceIds: string[];
};

export type BookingAssistantKnowledgeSummary = {
  id: string;
  title: string;
  body: string;
  sourceIds: string[];
};

export type BookingAssistantContextBundle = {
  context: {
    kind: AssistantContextKind;
    recordId: string;
    label: string;
  };
  profile: {
    organizationId: string | null;
    contactIds: string[];
    contacts: Array<{ id: string; label: string; isPrimary: boolean }>;
    eventFamilyId: string | null;
  };
  currentBooking: BookingAssistantBookingSummary | null;
  priorBookings: BookingAssistantBookingSummary[];
  recentActivities: BookingAssistantActivitySummary[];
  openFollowUps: BookingAssistantFollowUpSummary[];
  packageHistorySignals: PackageHistorySignal[];
  routeContext: BookingAssistantRouteSummary | null;
  derivedFacts: BookingAssistantDerivedFactSummary[];
  businessKnowledge: BookingAssistantKnowledgeSummary[];
  sources: AssistantSourceReference[];
  generatedAt: string;
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
