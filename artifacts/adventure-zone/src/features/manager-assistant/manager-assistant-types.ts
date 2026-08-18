export type ManagerAssistantContextKind = "leg" | "booking" | "route" | "operations";

export type ManagerAssistantContextRef = {
  kind: ManagerAssistantContextKind;
  recordId: string;
  label?: string;
};

export type ManagerAssistantAnswer = {
  text: string;
  mode: "deterministic" | "cloud" | "offline_cached";
  confidence: "high" | "medium" | "low";
  sources: Array<{ id: string; kind: string; recordId: string; label: string; occurredAt: string | null }>;
  needsAdmin: boolean;
  escalationReason: string | null;
};

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

export type ManagerAssistantContextBundle = {
  leg: { id: string; name: string };
  activeContext: { kind: ManagerAssistantContextKind; recordId: string; label: string };
  assignedEvents: ManagerAssignedEventSummary[];
  activeEvent: ManagerAssignedEventSummary | null;
  route: null | { tripId: string; label: string; stops: Array<{ bookingId: string; label: string; sortOrder: number }> };
  handoffs: Array<{ id: string; summary: string }>;
  acknowledgments: Array<{ id: string; summary: string }>;
  operationalInstructions: Array<{ id: string; summary: string }>;
  knowledge: Array<{ id: string; title: string; body: string }>;
  generatedAt: string;
};

export type ManagerAdminQuestion = {
  id: string;
  clientMutationId: string;
  travelLegId: string;
  bookingId: string | null;
  tripId: string | null;
  question: string;
  urgency: "normal" | "urgent";
  status: "needs_answer" | "answered" | "resolved";
  escalationReason: string;
  latestAdminResponse?: string | null;
  createdAt?: string;
  answeredAt?: string | null;
};
