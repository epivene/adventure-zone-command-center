import { calculateNextRecurrence } from "./recurrence-date";
import type { EventRecurrenceRule } from "./event-date-types";

export type InternalEventDateEvidence = {
  startsOn: string;
  endsOn: string | null;
  evidenceKind: "booking" | "published_exact" | "recurrence_clue";
  sourceKind: "internal";
  sourceType: string;
  sourceId: string;
  sourceLabel: string;
  excerpt: string | null;
  recurrenceRule?: EventRecurrenceRule;
};

export type InternalEvidenceAudit = {
  resolution: "booked" | "confirmed" | "expected" | "needs_review" | "missing";
  startsOn: string | null;
  endsOn: string | null;
  evidence: InternalEventDateEvidence[];
};

export function auditInternalEventDateEvidence(input: {
  today: string;
  evidence: InternalEventDateEvidence[];
}): InternalEvidenceAudit {
  const future = input.evidence.filter((item) => item.startsOn >= input.today);
  const bookings = future.filter((item) => item.evidenceKind === "booking")
    .toSorted((a, b) => a.startsOn.localeCompare(b.startsOn));
  if (bookings[0]) return {
    resolution: "booked", startsOn: bookings[0].startsOn,
    endsOn: bookings[0].endsOn, evidence: [bookings[0]],
  };

  const exact = future.filter((item) => item.evidenceKind === "published_exact");
  const recurrence = input.evidence.filter((item) => item.evidenceKind === "recurrence_clue");
  const calculated = recurrence.flatMap((item) => {
    if (!item.recurrenceRule) return [];
    const result = calculateNextRecurrence({ today: input.today, rule: item.recurrenceRule });
    return result.status === "expected" ? [{ item, result }] : [];
  });
  const dates = new Set([
    ...exact.map((item) => item.startsOn),
    ...calculated.map(({ result }) => result.startsOn),
  ]);
  if (dates.size > 1) return {
    resolution: "needs_review", startsOn: null, endsOn: null,
    evidence: [...exact, ...recurrence],
  };
  if (exact[0]) return {
    resolution: "confirmed", startsOn: exact[0].startsOn,
    endsOn: exact[0].endsOn, evidence: exact,
  };
  if (calculated[0]) return {
    resolution: "expected", startsOn: calculated[0].result.startsOn,
    endsOn: calculated[0].result.endsOn, evidence: recurrence,
  };
  return { resolution: "missing", startsOn: null, endsOn: null, evidence: [] };
}
