import type { AssistantSourceReference } from "@/features/assistant/assistant-types";
import type { ManagerContextInput } from "./manager-assistant-input";

export type ManagerAssistantContextKind = ManagerContextInput["contextKind"];

export type ManagerAssignedEventSummary = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  startsAt: string | null;
  endsAt: string | null;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  checkInTimeZone?: string | null;
  checkOutTimeZone?: string | null;
  status: string;
  packageNames: string[];
  resourceNames: string[];
  setupSummary: string | null;
};

export type ManagerRouteAssistantSummary = {
  tripId: string;
  label: string;
  startDate: string | null;
  endDate: string | null;
  stops: Array<{ bookingId: string; label: string; sortOrder: number }>;
};

export type ManagerAssistantContextBundle = {
  leg: { id: string; name: string };
  activeContext: {
    kind: ManagerAssistantContextKind;
    recordId: string;
    label: string;
  };
  assignedEvents: ManagerAssignedEventSummary[];
  activeEvent: ManagerAssignedEventSummary | null;
  route: ManagerRouteAssistantSummary | null;
  handoffs: Array<{ id: string; summary: string }>;
  acknowledgments: Array<{ id: string; summary: string }>;
  operationalInstructions: Array<{ id: string; summary: string }>;
  knowledge: Array<{ id: string; title: string; body: string }>;
  sources: AssistantSourceReference[];
  generatedAt: string;
};

export type ManagerAssistantAnswer = {
  text: string;
  mode: "deterministic" | "cloud" | "offline_cached";
  confidence: "high" | "medium" | "low";
  sources: AssistantSourceReference[];
  needsAdmin: boolean;
  escalationReason: string | null;
};
