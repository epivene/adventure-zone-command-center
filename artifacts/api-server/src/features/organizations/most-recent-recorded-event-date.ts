import { isBookedForSchedule } from "../calendar/schedule-booking-state";
import type {
  BookingDateInput,
  EventDateFactInput,
} from "../event-date-coverage/event-date-types";

export type MostRecentRecordedEventDate = {
  startsOn: string;
  endsOn: string | null;
};

type FestivalEditionDateInput = {
  details: Record<string, string>;
};

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year >= 9999) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function dateRange(startsOn: unknown, endsOn: unknown): MostRecentRecordedEventDate | null {
  if (!isCalendarDate(startsOn)) return null;
  return {
    startsOn,
    endsOn: isCalendarDate(endsOn) && endsOn >= startsOn ? endsOn : null,
  };
}

export function resolveMostRecentRecordedEventDate(input: {
  bookings: BookingDateInput[];
  facts: EventDateFactInput[];
  editions: FestivalEditionDateInput[];
}): MostRecentRecordedEventDate | null {
  const candidates = [
    ...input.bookings.flatMap((booking) => {
      if (!isBookedForSchedule(booking)) return [];
      const range = dateRange(booking.startsOn, booking.endsOn);
      return range ? [range] : [];
    }),
    ...input.facts.flatMap((fact) => {
      if (!fact.active || fact.status === "needs_review") return [];
      const range = dateRange(fact.startsOn, fact.endsOn);
      return range ? [range] : [];
    }),
    ...input.editions.flatMap((edition) => {
      const range = dateRange(edition.details.startsOn, edition.details.endsOn);
      return range ? [range] : [];
    }),
  ];

  return candidates.toSorted((left, right) =>
    right.startsOn.localeCompare(left.startsOn) ||
    (right.endsOn ?? "").localeCompare(left.endsOn ?? ""),
  )[0] ?? null;
}
