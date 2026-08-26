export type DateOnlyWindow = { startDate: string; endDate: string };
type CalendarTime = { date?: string; dateTime?: string; timeZone?: string };
function addDays(date: string, days: number) { const value = new Date(`${date}T12:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function localDate(dateTime: string, timeZone: string) { const instant = new Date(dateTime); if (!Number.isFinite(instant.valueOf())) throw new Error("CALENDAR_EVENT_TIME_INVALID"); return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant); }
function dateFor(value: CalendarTime, fallbackTimeZone: string) { if (value.date) return value.date; if (value.dateTime) return localDate(value.dateTime, value.timeZone || fallbackTimeZone); throw new Error("CALENDAR_EVENT_TIME_INVALID"); }
export function normalizeCalendarWindow(input: { kind: "google" | "stored_booking"; start: CalendarTime; end: CalendarTime; calendarTimeZone: string }): DateOnlyWindow {
 const startDate = dateFor(input.start, input.calendarTimeZone); const endDate = dateFor(input.end, input.calendarTimeZone);
 if (input.kind === "stored_booking") return { startDate, endDate };
 return { startDate: addDays(startDate, -2), endDate: addDays(input.end.date ? addDays(endDate, -1) : endDate, 1) };
}