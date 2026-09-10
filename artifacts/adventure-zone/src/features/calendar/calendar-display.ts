export function calendarInitialMonth(season: string | undefined, todayKey: string) {
  const currentMonth = todayKey.slice(0, 7);
  const currentYear = todayKey.slice(0, 4);
  if (!season || !/^\d{4}$/.test(season) || season === currentYear) return currentMonth;
  return `${season}-01`;
}

type CalendarBookingDates = {
  startsAt: Date | null;
  endsAt: Date | null;
};

export function normalizeCalendarBookingDates<T extends CalendarBookingDates>(event: T): T {
  const { startsAt, endsAt } = event;
  if (!startsAt || !endsAt) return event;

  // ACT/open-ended imports can use a far-future sentinel instead of a real
  // event end date. Treat those as a single dated event on the calendar.
  if (endsAt.getUTCFullYear() >= 2100) {
    return { ...event, endsAt: null };
  }

  return event;
}


type ScheduleCalendarBookingDates = CalendarBookingDates & {
  actualStartsAt?: Date | null;
  actualEndsAt?: Date | null;
  operationalWindowSource?: string | null;
  source?: string;
};

function addUtcDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function calendarBookingDisplayDates<T extends ScheduleCalendarBookingDates>(event: T): T {
  const normalized = normalizeCalendarBookingDates(event);
  if (
    !normalized.startsAt
    || normalized.operationalWindowSource
    || normalized.source === "google_operational_review"
  ) {
    return normalized;
  }

  const actualStart = normalized.actualStartsAt ?? normalized.startsAt;
  const actualEnd = normalized.actualEndsAt ?? normalized.endsAt ?? actualStart;
  return {
    ...normalized,
    actualStartsAt: actualStart,
    actualEndsAt: actualEnd,
    startsAt: addUtcDays(actualStart, -2),
    endsAt: addUtcDays(actualEnd, 1),
    operationalWindowSource: "default_buffer",
  };
}
