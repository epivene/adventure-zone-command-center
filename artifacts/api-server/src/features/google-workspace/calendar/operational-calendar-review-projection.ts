type PendingOperationalCalendarReview = {
  id: string;
  googleEventId: string;
  reason: string;
  bookingId: string | null;
  proposedChanges: Record<string, unknown>;
};

type ParsedReview = {
  managerToken?: string | null;
  eventName?: string | null;
  city?: string | null;
  region?: string | null;
  packageKey?: string | null;
  calendarState?: string | null;
};

type GoogleReviewEvent = {
  summary?: string | null;
  startDate?: string | null;
  endDateExclusive?: string | null;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function utcDay(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function inclusiveEnd(exclusive: Date | null, start: Date | null) {
  if (!exclusive) return start;
  return new Date(exclusive.getTime() - 86_400_000);
}

function statusForState(state: string | null | undefined) {
  if (state === "cancelled") return "cancelled" as const;
  if (state === "placeholder") return "possible" as const;
  if (state === "action_required") return "researching" as const;
  return "confirmed" as const;
}

export function projectOperationalCalendarReview(review: PendingOperationalCalendarReview) {
  const proposed = objectValue(review.proposedChanges);
  const parsed = objectValue(proposed.parsed) as ParsedReview;
  const google = objectValue(proposed.google) as GoogleReviewEvent;
  const startsAt = utcDay(google.startDate);
  const exclusiveEnd = utcDay(google.endDateExclusive);
  const endsAt = inclusiveEnd(exclusiveEnd, startsAt);
  if (!startsAt || !endsAt) throw new Error("GOOGLE_OPERATIONAL_CALENDAR_REVIEW_DATE_INVALID");

  const eventName = typeof parsed.eventName === "string" && parsed.eventName.trim()
    ? parsed.eventName.trim()
    : typeof google.summary === "string" && google.summary.trim()
      ? google.summary.trim()
      : "David calendar event";

  return {
    source: "google_operational_review" as const,
    id: `google-review:${review.id}`,
    googleEventId: review.googleEventId,
    reviewId: review.id,
    reviewReason: review.reason,
    bookingId: null,
    name: `${eventName} · Needs profile match`,
    city: typeof parsed.city === "string" ? parsed.city : "",
    region: typeof parsed.region === "string" ? parsed.region : "",
    latitude: null,
    longitude: null,
    status: statusForState(parsed.calendarState),
    probability: "possible" as const,
    travelLegId: null,
    travelLegName: typeof parsed.managerToken === "string" ? parsed.managerToken : null,
    travelLegColor: null,
    startsAt,
    endsAt,
    packageKey: typeof parsed.packageKey === "string" ? parsed.packageKey : "unknown",
  };
}
