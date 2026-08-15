export type ReviewableEvent = {
  startsAt: Date | null;
  endsAt?: Date | null;
};

const BUSINESS_TIME_ZONE = "America/Chicago";

function businessDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function isEventReviewDue(event: ReviewableEvent, now = new Date()): boolean {
  const effectiveEnd = event.endsAt ?? event.startsAt;
  if (!effectiveEnd) return false;
  return businessDateKey(effectiveEnd) < businessDateKey(now);
}

export function validateEventReviewRating(rating: number): boolean {
  return Number.isInteger(rating) && rating >= 0 && rating <= 5;
}
