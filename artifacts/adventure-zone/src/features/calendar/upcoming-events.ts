export type CalendarEventWindow = {
  startsAt: Date;
  endsAt?: Date | null;
  actualStartsAt?: Date | null;
  actualEndsAt?: Date | null;
};

function startOfUtcDay(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function calendarEventPublicStart(event: CalendarEventWindow): Date {
  return event.actualStartsAt ?? event.startsAt;
}

export function calendarEventPublicEnd(event: CalendarEventWindow): Date {
  return event.actualEndsAt ?? event.actualStartsAt ?? event.endsAt ?? event.startsAt;
}

export function futureCalendarEvents<T extends CalendarEventWindow>(events: T[], now = new Date()): T[] {
  const today = startOfUtcDay(now);
  return events
    .filter((event) => startOfUtcDay(calendarEventPublicEnd(event)) >= today)
    .sort((a, b) => (
      calendarEventPublicStart(a).getTime() - calendarEventPublicStart(b).getTime()
      || calendarEventPublicEnd(a).getTime() - calendarEventPublicEnd(b).getTime()
    ));
}
