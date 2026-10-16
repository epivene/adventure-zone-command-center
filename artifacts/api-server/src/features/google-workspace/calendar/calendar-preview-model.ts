import { createHash } from "node:crypto";
import type { OperationalCalendarEvent, OperationalCalendarEventInput } from "./operational-calendar-client";
import type { ResolvedDates } from "../../booking-date-repair/date-evidence";

export function eventIdentity(bookingId: string, packageKey: string) {
  // Google accepts base32hex IDs; hexadecimal is a valid subset. Stable across retries/reconnects.
  return createHash("sha256").update("adventure-zone:" + bookingId + ":" + packageKey).digest("hex");
}
export function addDays(day: string, amount: number) {
  const date = new Date(day + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function validDay(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number(day.slice(0, 4)) > 0 && Number(day.slice(0, 4)) < 9999
    && Number.isFinite(Date.parse(day + "T00:00:00Z"))
    && new Date(day + "T00:00:00Z").toISOString().slice(0, 10) === day;
}
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" });
function localDay(instant: string, exclusive = false) {
  const parts = Object.fromEntries(dayFormat.formatToParts(new Date(Date.parse(instant) - (exclusive ? 1 : 0))).map(p => [p.type, p.value]));
  return parts.year + "-" + parts.month + "-" + parts.day;
}
export function reviewedDays(dates: ResolvedDates) {
  return {
    startsOn: dates.publicWindow ? localDay(dates.publicWindow.start) : null,
    endsOn: dates.publicWindow ? localDay(dates.publicWindow.end, dates.publicEndExclusive) : null,
    setupOn: dates.reservationWindow ? localDay(dates.reservationWindow.start) : null,
    teardownOn: dates.reservationWindow ? localDay(dates.reservationWindow.end, dates.reservationEndExclusive) : null,
  };
}
export function sameEvent(actual: OperationalCalendarEvent | null, desired: OperationalCalendarEventInput): boolean {
  return Boolean(actual && actual.status !== "cancelled" && actual.summary === desired.summary
    && actual.description === desired.description && actual.startDate === desired.startDate
    && actual.endDateExclusive === desired.endDateExclusive);
}
export type PreviewEvent = {
  packageKey: "zone" | "pirates" | "warrior";
  input: OperationalCalendarEventInput;
  existing: OperationalCalendarEvent | null;
  eventId: string;
  mode: "create" | "update" | "reuse";
};
