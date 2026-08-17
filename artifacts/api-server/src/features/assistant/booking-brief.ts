import type {
  AssistantSourceReference,
  BookingAssistantContextBundle,
} from "./assistant-types";

export type BookingBriefItemKey =
  | "package_history"
  | "last_outcome"
  | "timing"
  | "attraction_count"
  | "contact"
  | "objection_or_promise"
  | "follow_up"
  | "route_fit"
  | "year_over_year_change"
  | "next_action";

export type BookingBrief = {
  headline: string;
  items: Array<{
    key: BookingBriefItemKey;
    text: string;
    confidence: "high" | "medium" | "low";
    sourceIds: string[];
  }>;
  generatedAt: string;
};

function sourceIdFor(
  sources: readonly AssistantSourceReference[],
  kind: AssistantSourceReference["kind"],
  recordId: string,
): string | null {
  return sources.find(
    (source) => source.kind === kind && source.recordId === recordId,
  )?.id ?? null;
}

function sourceIdsForBookings(
  bundle: BookingAssistantContextBundle,
  bookingIds: readonly string[],
): string[] {
  return bookingIds.flatMap((bookingId) => {
    const sourceId = sourceIdFor(bundle.sources, "booking", bookingId);
    return sourceId ? [sourceId] : [];
  });
}

export function buildBookingBrief(
  bundle: BookingAssistantContextBundle,
): BookingBrief {
  const items: BookingBrief["items"] = [];

  const packageSignal = bundle.packageHistorySignals.find(
    (signal) => signal.kind === "usual_package_mix",
  );
  if (packageSignal?.kind === "usual_package_mix") {
    const sourceIds = sourceIdsForBookings(
      bundle,
      packageSignal.sourceBookingIds,
    );
    if (sourceIds.length > 0) {
      items.push({
        key: "package_history",
        text: `They usually book ${packageSignal.packageNames.join(" + ")}.`,
        confidence:
          packageSignal.sourceBookingIds.length >= 2 ? "high" : "medium",
        sourceIds,
      });
    }
  }

  const currentBooking = bundle.currentBooking;
  const countSignal = bundle.packageHistorySignals.find(
    (signal) => signal.kind === "main_attraction_difference",
  );
  if (
    currentBooking?.physicalAttractionTotal !== null &&
    countSignal?.kind === "main_attraction_difference"
  ) {
    const currentSource = sourceIdFor(
      bundle.sources,
      "booking",
      currentBooking.id,
    );
    const priorSource = sourceIdFor(
      bundle.sources,
      "booking",
      countSignal.sourceBookingId,
    );
    const sourceIds = [currentSource, priorSource].filter(
      (sourceId): sourceId is string => Boolean(sourceId),
    );
    if (sourceIds.length > 0) {
      const difference = Math.abs(countSignal.difference);
      const comparison =
        countSignal.difference === 0
          ? "the same as the most recent comparable booking"
          : `${difference} ${countSignal.difference > 0 ? "more" : "fewer"} than the most recent comparable booking`;
      items.push({
        key: "attraction_count",
        text: `This booking has ${currentBooking.physicalAttractionTotal} main attractions, ${comparison}.`,
        confidence: "high",
        sourceIds,
      });
    }
  } else if (currentBooking?.physicalAttractionTotal !== null) {
    const sourceId = sourceIdFor(bundle.sources, "booking", currentBooking.id);
    if (sourceId) {
      items.push({
        key: "attraction_count",
        text: `This booking currently has ${currentBooking.physicalAttractionTotal} main attractions.`,
        confidence: "high",
        sourceIds: [sourceId],
      });
    }
  }

  const primaryContact = bundle.profile.contacts.find((contact) => contact.isPrimary);
  if (primaryContact) {
    const source = bundle.sources.find(
      (candidate) => candidate.recordId === primaryContact.id,
    );
    if (source) {
      items.push({
        key: "contact",
        text: `${primaryContact.label} is the main contact saved for this profile.`,
        confidence: "high",
        sourceIds: [source.id],
      });
    }
  }

  const priorOutcome = bundle.derivedFacts.find(
    (fact) =>
      fact.factKind === "prior_outcome" &&
      fact.status === "confirmed" &&
      fact.sourceIds.length > 0,
  );
  if (priorOutcome) {
    items.push({
      key: "last_outcome",
      text: priorOutcome.summary,
      confidence: priorOutcome.confidence,
      sourceIds: priorOutcome.sourceIds,
    });
  }

  const objectionOrPromise = bundle.derivedFacts.find(
    (fact) =>
      (fact.factKind === "objection" || fact.factKind === "promised_follow_up") &&
      fact.status !== "dismissed" &&
      fact.sourceIds.length > 0,
  );
  if (objectionOrPromise) {
    items.push({
      key: "objection_or_promise",
      text:
        objectionOrPromise.status === "proposed"
          ? `Historical inference: ${objectionOrPromise.summary}`
          : objectionOrPromise.summary,
      confidence: objectionOrPromise.confidence,
      sourceIds: objectionOrPromise.sourceIds,
    });
  }

  const nextFollowUp = [...bundle.openFollowUps].sort((a, b) =>
    a.dueAt.localeCompare(b.dueAt),
  )[0];
  if (nextFollowUp) {
    const sourceId = sourceIdFor(bundle.sources, "follow_up", nextFollowUp.id);
    if (sourceId) {
      items.push({
        key: "follow_up",
        text: `${nextFollowUp.label} is the next saved follow-up.`,
        confidence: "high",
        sourceIds: [sourceId],
      });
      items.push({
        key: "next_action",
        text: `Next action: ${nextFollowUp.label}.`,
        confidence: "high",
        sourceIds: [sourceId],
      });
    }
  }

  if (bundle.routeContext) {
    const sourceId = sourceIdFor(
      bundle.sources,
      "route",
      bundle.routeContext.id,
    );
    if (sourceId) {
      items.push({
        key: "route_fit",
        text: bundle.routeContext.summary,
        confidence: "high",
        sourceIds: [sourceId],
      });
    }
  }

  return {
    headline: `Booking brief — ${bundle.context.label}`,
    items,
    generatedAt: bundle.generatedAt,
  };
}
