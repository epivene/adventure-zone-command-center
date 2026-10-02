import { isBookedForSchedule } from "../calendar/schedule-booking-state";
import type {
  BookingDateInput,
  EffectiveEventDate,
  EventDateFactInput,
} from "./event-date-types";

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

function isEligibleDate(value: string | null, today: string): value is string {
  if (value === null || !dateOnlyPattern.test(value) || value < today) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year >= 9999) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

export function resolveEffectiveEventDate(input: {
  today: string;
  bookings: BookingDateInput[];
  facts: EventDateFactInput[];
}): EffectiveEventDate | null {
  const booking = input.bookings
    .filter((candidate) =>
      isBookedForSchedule(candidate) &&
      isEligibleDate(candidate.startsOn, input.today) &&
      isEligibleDate(candidate.endsOn, candidate.startsOn!),
    )
    .sort((left, right) => left.startsOn!.localeCompare(right.startsOn!))[0];

  if (booking?.startsOn) {
    return {
      startsOn: booking.startsOn,
      endsOn: booking.endsOn,
      displayStatus: "booked",
      sourceId: booking.id,
    };
  }

  for (const status of ["confirmed", "expected"] as const) {
    const fact = input.facts
      .filter((candidate) =>
        candidate.active &&
        candidate.status === status &&
        isEligibleDate(candidate.startsOn, input.today),
      )
      .sort((left, right) => left.startsOn.localeCompare(right.startsOn))[0];
    if (fact) {
      return {
        startsOn: fact.startsOn,
        endsOn: fact.endsOn,
        displayStatus: status,
        sourceId: fact.id,
      };
    }
  }

  return null;
}
