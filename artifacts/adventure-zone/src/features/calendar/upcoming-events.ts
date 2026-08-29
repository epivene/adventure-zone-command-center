export type CalendarEventWindow = {
  startsAt: Date;
  endsAt?: Date | null;
};

function startOfUtcDay(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function futureCalendarEvents<T extends CalendarEventWindow>(events: T[], now = new Date()): T[] {
  const today = startOfUtcDay(now);
  return events.filter((event) => {
    const end = event.endsAt ?? event.startsAt;
    return startOfUtcDay(end) >= today;
  });
}
