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
