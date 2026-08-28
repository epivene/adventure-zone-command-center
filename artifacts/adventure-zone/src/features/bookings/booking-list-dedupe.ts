import type { BookingStatus } from "@/features/bookings/booking-types";

export type BookingListLike = {
  id: string;
  name: string;
  city?: string | null;
  region?: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  status: BookingStatus;
  travelLeg?: { id: string; name: string; color: string } | null;
  nextAction?: { id: string; kind: string; dueAt: Date } | null;
};

const statusPriority: Record<BookingStatus, number> = {
  cancelled: 100,
  declined: 95,
  completed: 90,
  confirmed: 85,
  contract_received: 80,
  pending_contract: 75,
  pending_decision: 70,
  quote_sent: 65,
  interested: 60,
  contacted: 55,
  contact_due: 50,
  researching: 45,
  new_lead: 40,
  possible: 35,
  unlikely: 30,
  renewal_due: 25,
};

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function day(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function key(item: BookingListLike) {
  if (!item.startsAt) return `id:${item.id}`;
  return [
    normalize(item.name),
    normalize(item.city),
    normalize(item.region),
    day(item.startsAt),
    day(item.endsAt ?? item.startsAt),
  ].join("|");
}

function preferred<T extends BookingListLike>(candidate: T, current: T) {
  const statusDifference = statusPriority[candidate.status] - statusPriority[current.status];
  if (statusDifference !== 0) return statusDifference > 0;
  if (Boolean(candidate.travelLeg) !== Boolean(current.travelLeg)) return Boolean(candidate.travelLeg);
  if (Boolean(candidate.nextAction) !== Boolean(current.nextAction)) return Boolean(candidate.nextAction);
  if (candidate.nextAction && current.nextAction) {
    const dueDifference = candidate.nextAction.dueAt.getTime() - current.nextAction.dueAt.getTime();
    if (dueDifference !== 0) return dueDifference > 0;
  }
  return candidate.id.localeCompare(current.id) > 0;
}

export function dedupeBookingList<T extends BookingListLike>(items: T[]): T[] {
  const byEvent = new Map<string, T>();
  for (const item of items) {
    const eventKey = key(item);
    const current = byEvent.get(eventKey);
    if (!current || preferred(item, current)) byEvent.set(eventKey, item);
  }
  return [...byEvent.values()];
}
