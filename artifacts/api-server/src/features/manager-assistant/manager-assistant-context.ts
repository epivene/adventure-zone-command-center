import type { AssistantSourceReference } from "@/features/assistant/assistant-types";
import type { ManagerContextInput } from "./manager-assistant-input";
import type {
  ManagerAssignedEventSummary,
  ManagerAssistantContextBundle,
  ManagerRouteAssistantSummary,
} from "./manager-assistant-types";

export interface ManagerAssistantContextSource {
  getLeg(legId: string): Promise<{ id: string; name: string } | null>;
  listAssignedEvents(legId: string): Promise<ManagerAssignedEventSummary[]>;
  getRoute(legId: string): Promise<ManagerRouteAssistantSummary | null>;
  listHandoffs(legId: string): Promise<Array<{ id: string; summary: string }>>;
  listAcknowledgments(legId: string): Promise<Array<{ id: string; summary: string }>>;
  listOperationalInstructions(legId: string): Promise<Array<{ id: string; summary: string }>>;
  listKnowledge(input: {
    legId: string;
    bookingId: string | null;
    tripId: string | null;
  }): Promise<Array<{ id: string; title: string; body: string }>>;
}

function source(
  id: string,
  kind: AssistantSourceReference["kind"],
  recordId: string,
  label: string,
  occurredAt: string | null = null,
): AssistantSourceReference {
  return { id, kind, recordId, label, occurredAt };
}

export async function buildManagerAssistantContext(input: {
  authenticatedLegId: string;
  request: ManagerContextInput;
  source: ManagerAssistantContextSource;
  now?: Date;
}): Promise<ManagerAssistantContextBundle | null> {
  const leg = await input.source.getLeg(input.authenticatedLegId);
  if (!leg || leg.id !== input.authenticatedLegId) return null;

  const [events, route, handoffs, acknowledgments, operationalInstructions] =
    await Promise.all([
      input.source.listAssignedEvents(input.authenticatedLegId),
      input.source.getRoute(input.authenticatedLegId),
      input.source.listHandoffs(input.authenticatedLegId),
      input.source.listAcknowledgments(input.authenticatedLegId),
      input.source.listOperationalInstructions(input.authenticatedLegId),
    ]);

  let activeEvent: ManagerAssignedEventSummary | null = null;
  let label = leg.name;
  let bookingId: string | null = null;
  let tripId: string | null = null;

  if (input.request.contextKind === "leg" || input.request.contextKind === "operations") {
    if (input.request.contextRecordId !== input.authenticatedLegId) return null;
  } else if (input.request.contextKind === "booking") {
    activeEvent = events.find((event) => event.id === input.request.contextRecordId) ?? null;
    if (!activeEvent) return null;
    bookingId = activeEvent.id;
    label = activeEvent.name;
  } else if (input.request.contextKind === "route") {
    if (!route || route.tripId !== input.request.contextRecordId) return null;
    tripId = route.tripId;
    label = route.label;
  }

  const knowledge = await input.source.listKnowledge({
    legId: input.authenticatedLegId,
    bookingId,
    tripId,
  });

  const sources: AssistantSourceReference[] = [
    ...events.map((event) =>
      source(
        `manager_booking_${event.id}`,
        "booking",
        event.id,
        event.name,
        event.startsAt,
      ),
    ),
    ...(route
      ? [source(`manager_route_${route.tripId}`, "route", route.tripId, route.label, route.startDate)]
      : []),
    ...handoffs.map((handoff) =>
      source(`manager_handoff_${handoff.id}`, "handoff", handoff.id, handoff.summary),
    ),
    ...acknowledgments.map((acknowledgment) =>
      source(
        `manager_ack_${acknowledgment.id}`,
        "acknowledgment",
        acknowledgment.id,
        acknowledgment.summary,
      ),
    ),
    ...knowledge.map((entry) =>
      source(
        `manager_knowledge_${entry.id}`,
        "operations_knowledge",
        entry.id,
        entry.title,
      ),
    ),
  ];

  return {
    leg,
    activeContext: {
      kind: input.request.contextKind,
      recordId: input.request.contextRecordId,
      label,
    },
    assignedEvents: events,
    activeEvent,
    route,
    handoffs,
    acknowledgments,
    operationalInstructions,
    knowledge,
    sources,
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}
