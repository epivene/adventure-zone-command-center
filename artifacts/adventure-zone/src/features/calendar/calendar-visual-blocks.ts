export const DEFAULT_SCHEDULE_DISPLAY_COLORS = {
  eventColor: "#ec4899",
  travelColor: "rgba(100, 116, 139, 0.42)",
} as const;

export type ScheduleDisplayColors = {
  eventColor: string;
  travelColor: string;
};

export type BookingVisualDayKind = "event" | "travel";

type VisualBookingDates = {
  startsAt: Date | null;
  endsAt?: Date | null;
  actualStartsAt?: Date | null;
  actualEndsAt?: Date | null;
  operationalWindowSource?: string | null;
  travelLegColor?: string | null;
};

type CalendarBookingLabel = {
  name: string;
  travelLegName?: string | null;
};

const COMMON_FAIR_SUFFIX = /\s+(?:County\s+)?Fair$/i;

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function inclusiveRangeContains(start: Date | null | undefined, end: Date | null | undefined, key: string) {
  if (!start) return false;
  const startsOn = dateKey(start);
  const candidateEnd = dateKey(end ?? start);
  const endsOn = candidateEnd < startsOn ? startsOn : candidateEnd;
  return startsOn <= key && key <= endsOn;
}

export function bookingVisualKindOnDate(booking: VisualBookingDates, dateKeyValue: string): BookingVisualDayKind | null {
  if (!inclusiveRangeContains(booking.startsAt, booking.endsAt, dateKeyValue)) return null;

  const hasSeparateActualDates = Boolean(booking.operationalWindowSource && booking.actualStartsAt);
  if (!hasSeparateActualDates) return "event";

  return inclusiveRangeContains(booking.actualStartsAt, booking.actualEndsAt, dateKeyValue)
    ? "event"
    : "travel";
}

export function colorForBookingDay(
  booking: VisualBookingDates,
  dateKeyValue: string,
  colors: ScheduleDisplayColors,
): string | null {
  const kind = bookingVisualKindOnDate(booking, dateKeyValue);
  if (!kind) return null;
  return kind === "event" ? booking.travelLegColor ?? colors.eventColor : colors.travelColor;
}

export function calendarBookingLabel(booking: CalendarBookingLabel): string {
  if (!booking.travelLegName) return booking.name;
  const shortName = booking.name.replace(COMMON_FAIR_SUFFIX, "").trim() || booking.name;
  return `${booking.travelLegName.toUpperCase()} • ${shortName}`;
}
