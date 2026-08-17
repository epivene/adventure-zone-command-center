import type { BookingBrief } from "./booking-brief";
import type { BookingAssistantContextBundle } from "./assistant-types";

export function buildAssistantPrompt(input: {
  question: string;
  context: BookingAssistantContextBundle;
  brief: BookingBrief;
}): string {
  const structuredFacts = {
    context: input.context.context,
    profile: input.context.profile,
    currentBooking: input.context.currentBooking,
    priorBookings: input.context.priorBookings,
    openFollowUps: input.context.openFollowUps,
    packageHistorySignals: input.context.packageHistorySignals,
    routeContext: input.context.routeContext,
  };
  const historicalDerivedFacts = input.context.derivedFacts.filter(
    (fact) => fact.status !== "dismissed",
  );
  const businessKnowledge = input.context.businessKnowledge;
  const sources = input.context.sources.map((source) => ({
    id: source.id,
    kind: source.kind,
    label: source.label,
    occurredAt: source.occurredAt,
  }));

  return [
    "You are the Adventure Zone Booking Assistant.",
    "Answer the booking staff member's question using only the supplied authorized context.",
    "Structured facts outrank historical derived facts. Historical derived facts outrank general business knowledge.",
    "Do not invent customer history, promises, prices, package selections, route facts, or contact facts.",
    "When evidence is insufficient, say so plainly.",
    "Return ONLY JSON with this exact shape: {\"text\":string,\"confidence\":\"high\"|\"medium\"|\"low\",\"sourceIds\":string[]}.",
    "sourceIds must contain only IDs from AVAILABLE SOURCES that support the factual parts of the answer.",
    "Do not include hidden reasoning, chain-of-thought, provider details, or extra fields.",
    "",
    `QUESTION\n${input.question}`,
    "",
    `STRUCTURED FACTS\n${JSON.stringify(structuredFacts)}`,
    "",
    `BOOKING BRIEF\n${JSON.stringify(input.brief)}`,
    "",
    `HISTORICAL DERIVED FACTS\n${JSON.stringify(historicalDerivedFacts)}`,
    "",
    `BUSINESS KNOWLEDGE\n${JSON.stringify(businessKnowledge)}`,
    "",
    `AVAILABLE SOURCES\n${JSON.stringify(sources)}`,
  ].join("\n");
}
