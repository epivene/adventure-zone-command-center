import type { BookingOperationsSummary } from "@/features/bookings/booking-operations-summary";
import type { CallWorkspaceContext } from "@/features/calls/call-workspace-context";
import type { GuidedCallScriptKind } from "@/features/calls/call-types";

export type CallBriefingInput = {
  context: CallWorkspaceContext;
  operations: BookingOperationsSummary | null;
  lastContactedAt: Date | null;
  guidedKind: GuidedCallScriptKind;
  historySummary?: string | null;
  lastOutcome?: string | null;
};

export type CallBriefing = {
  reason: GuidedCallScriptKind;
  headline: string;
  status: string | null;
  eventName: string | null;
  eventDate: string | null;
  location: string | null;
  routeLeg: string | null;
  packageInterest: string | null;
  lastContactedAt: string | null;
  lastOutcome: string | null;
  keyFacts: string[];
  historySummary: string | null;
};

const MAX_KEY_FACTS = 6;

const headlines: Record<GuidedCallScriptKind, string> = {
  first_outreach: "First outreach",
  rebooking: "Reconnect about this year's event",
  follow_up: "Follow up on the previous conversation",
  proposal_contract: "Follow up on proposal or contract",
  callback: "Return requested callback",
  incoming_inquiry: "Handle incoming inquiry",
};

function clean(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function pushFact(facts: string[], value: string | null) {
  if (!value || facts.includes(value) || facts.length >= MAX_KEY_FACTS) return;
  facts.push(value);
}

export function buildCallBriefing(input: CallBriefingInput): CallBriefing {
  const { context, operations } = input;
  const booking = context.booking;
  const location = booking
    ? clean([booking.city, booking.region].filter(Boolean).join(", "))
    : context.contact
      ? clean([context.contact.city, context.contact.region].filter(Boolean).join(", "))
      : null;
  const packageInterest = operations?.packageNames?.length
    ? operations.packageNames.join(", ")
    : null;
  const eventDate = booking?.startsAt ? booking.startsAt.toISOString() : null;
  const facts: string[] = [];

  pushFact(facts, packageInterest ? `Package interest: ${packageInterest}` : null);
  pushFact(facts, operations?.leg ? `Route: ${operations.leg.name}` : null);
  pushFact(facts, eventDate ? `Event date: ${eventDate.slice(0, 10)}` : null);
  pushFact(facts, location ? `Location: ${location}` : null);
  pushFact(facts, booking?.status ? `Status: ${booking.status.replaceAll("_", " ")}` : null);
  pushFact(
    facts,
    input.lastContactedAt
      ? `Last contacted: ${input.lastContactedAt.toISOString().slice(0, 10)}`
      : "No previous contact recorded",
  );

  return {
    reason: input.guidedKind,
    headline: headlines[input.guidedKind],
    status: booking?.status ?? null,
    eventName: booking?.name ?? context.organization?.name ?? null,
    eventDate,
    location,
    routeLeg: operations?.leg?.name ?? null,
    packageInterest,
    lastContactedAt: input.lastContactedAt?.toISOString() ?? null,
    lastOutcome: clean(input.lastOutcome),
    keyFacts: facts,
    historySummary: clean(input.historySummary),
  };
}
