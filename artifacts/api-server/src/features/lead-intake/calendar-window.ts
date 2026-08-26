export type DateOnlyWindow = { startDate: string; endDate: string };
export type CalendarTime = { date?: string; dateTime?: string; timeZone?: string };
function addDays(date: string, days: number) { const value = new Date(`${date}T12:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function localDate(value: string, timeZone: string) { const instant = new Date(value); if (!Number.isFinite(instant.valueOf())) throw new Error("CALENDAR_EVENT_TIME_INVALID"); return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant); }
export function calendarDate(value: CalendarTime, fallbackTimeZone: string) { if (value.date) return value.date; if (value.dateTime) return localDate(value.dateTime, value.timeZone || fallbackTimeZone); throw new Error("CALENDAR_EVENT_TIME_INVALID"); }
export function proposedBookingWindow(input: DateOnlyWindow): DateOnlyWindow { return { startDate: addDays(input.startDate, -2), endDate: addDays(input.endDate, 1) }; }
export function normalizeStoredCalendarWindow(input: { start: CalendarTime; end: CalendarTime; calendarTimeZone: string }): DateOnlyWindow {
 const startDate = calendarDate(input.start, input.calendarTimeZone); const rawEndDate = calendarDate(input.end, input.calendarTimeZone);
 return { startDate, endDate: input.end.date ? addDays(rawEndDate, -1) : rawEndDate };
}
export function normalizeCalendarWindow(input: { kind: "google" | "stored_booking"; start: CalendarTime; end: CalendarTime; calendarTimeZone: string }): DateOnlyWindow {
 return input.kind === "stored_booking" ? normalizeStoredCalendarWindow(input) : proposedBookingWindow({ startDate: calendarDate(input.start, input.calendarTimeZone), endDate: input.end.date ? addDays(calendarDate(input.end, input.calendarTimeZone), -1) : calendarDate(input.end, input.calendarTimeZone) });
}