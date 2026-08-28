import type { BookingStatus } from "@/features/bookings/booking-types";

export type CalendarBookingLike = {
  id: string;
  name: string;
  city?: string | null;
  region?: string | null;
  travelLegId?: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  status: BookingStatus;
};

const statusPriority: Record<BookingStatus, number> = {
  confirmed: 100,
  completed: 95,
  contract_received: 90,
  pending_contract: 85,
  pending_decision: 80,
  quote_sent: 75,
  interested: 70,
  contacted: 65,
  contact_due: 60,
  researching: 55,
  new_lead: 50,
  possible: 45,
  renewal_due: 40,
  unlikely: 35,
  declined: 20,
  cancelled: 10,
};

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function dateKey(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function displayKey(event: CalendarBookingLike) {
  return [
    normalize(event.name),
    normalize(event.city),
    normalize(event.region),
    dateKey(event.startsAt),
    dateKey(event.endsAt ?? event.startsAt),
  ].join("|");
}

function isPreferred<T extends CalendarBookingLike>(candidate: T, current: T) {
  const statusDifference = statusPriority[candidate.status] - statusPriority[current.status];
  if (statusDifference !== 0) return statusDifference > 0;
  if (Boolean(candidate.travelLegId) !== Boolean(current.travelLegId)) {
    return Boolean(candidate.travelLegId);
  }
  return candidate.id.localeCompare(current.id) > 0;
}

export function dedupeCalendarBookings<T extends CalendarBookingLike>(events: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const event of events) {
    const key = displayKey(event);
    const current = byKey.get(key);
    if (!current || isPreferred(event, current)) {
      byKey.set(key, event);
    }
  }
  return [...byKey.values()];
}
