import { createHash } from "node:crypto";
export type TimedEvent = {
  calendarId: string;
  summary: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  organizationId: string;
  bookingId: string | null;
};
export function validateTimedEvent(event: TimedEvent) {
  if (!event.calendarId || !event.summary.trim() || event.summary.length > 300)
    throw new Error("CALENDAR_EVENT_INVALID");
  for (const value of [event.startsAt, event.endsAt]) {
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      ) ||
      !Number.isFinite(Date.parse(value))
    )
      throw new Error("CALENDAR_OFFSET_REQUIRED");
    let parts: Intl.DateTimeFormatPart[];
    try {
      parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: event.timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(value));
    } catch {
      throw new Error("CALENDAR_TIME_ZONE_INVALID");
    }
    const p = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    if (
      `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}` !==
      value.slice(0, 19)
    )
      throw new Error("CALENDAR_LOCAL_TIME_MISMATCH");
  }
  if (Date.parse(event.endsAt) <= Date.parse(event.startsAt))
    throw new Error("CALENDAR_END_NOT_AFTER_START");
}
export const calendarEventId = (actionId: string) =>
  createHash("sha256").update(`assistant:${actionId}`).digest("hex");
export function timedCalendarBody(event: TimedEvent, actionId: string) {
  validateTimedEvent(event);
  return {
    id: calendarEventId(actionId),
    summary: event.summary,
    start: { dateTime: event.startsAt, timeZone: event.timeZone },
    end: { dateTime: event.endsAt, timeZone: event.timeZone },
    attendees: [],
    extendedProperties: {
      private: {
        assistantActionId: actionId,
        organizationId: event.organizationId,
        ...(event.bookingId ? { bookingId: event.bookingId } : {}),
      },
    },
  };
}
export function allDayCalendarBody(
  startDate: string,
  endDateExclusive: string,
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(endDateExclusive) ||
    new Date(startDate).toISOString().slice(0, 10) !== startDate ||
    new Date(endDateExclusive).toISOString().slice(0, 10) !==
      endDateExclusive ||
    endDateExclusive <= startDate
  )
    throw new Error("CALENDAR_DATE_RANGE_INVALID");
  return { start: { date: startDate }, end: { date: endDateExclusive } };
}
