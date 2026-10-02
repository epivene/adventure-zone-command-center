import type {
  OperationalWindow,
  WindowInput,
  WindowResult,
} from "@workspace/api-zod";
const offsetFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver",
  timeZoneName: "longOffset",
});
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("9999"))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}
function midnight(value: string): number {
  const wall = Date.parse(`${value}T00:00:00Z`);
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    const label =
      offsetFormat
        .formatToParts(new Date(instant))
        .find((p) => p.type === "timeZoneName")?.value ?? "";
    const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(label);
    if (!m) throw new Error("Timezone offset unavailable");
    instant =
      wall -
      (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000;
  }
  return instant;
}
export function resolveOperationalWindow(input: WindowInput): WindowResult {
  const { startsAt, endsAt, semantics, source } = input;
  if (
    !startsAt ||
    !endsAt ||
    !validDate(startsAt.slice(0, 10)) ||
    !validDate(endsAt.slice(0, 10))
  )
    return { state: "needs_review", reasons: ["INVALID_WINDOW"] };
  let startMs: number, endMs: number;
  if (semantics === "timestamp") {
    if (
      !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(startsAt) ||
      !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(endsAt)
    )
      return { state: "needs_review", reasons: ["AMBIGUOUS_TIMESTAMP"] };
    startMs = Date.parse(startsAt);
    endMs = Date.parse(endsAt);
  } else {
    if (!validDate(startsAt) || !validDate(endsAt))
      return { state: "needs_review", reasons: ["INVALID_DATE_ONLY_WINDOW"] };
    startMs = midnight(startsAt);
    const endKey =
      semantics === "inclusive_date"
        ? new Date(Date.parse(`${endsAt}T00:00:00Z`) + 86400000)
            .toISOString()
            .slice(0, 10)
        : endsAt;
    endMs = midnight(endKey);
  }
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
    ? { state: "resolved", window: { startMs, endMs, source } }
    : { state: "needs_review", reasons: ["INVALID_WINDOW"] };
}
export const windowsOverlap = (a: OperationalWindow, b: OperationalWindow) =>
  a.startMs < b.endMs && b.startMs < a.endMs;
export const windowContains = (
  outer: OperationalWindow,
  inner: OperationalWindow,
) => outer.startMs <= inner.startMs && outer.endMs >= inner.endMs;

/** Calendar identity respects date-only imports and Denver timestamps. */
export function planningStartCalendar(
  value: unknown,
  dateOnly = false,
): { year: number; month: number } | null {
  if (value == null) return null;
  const date = new Date(String(value));
  if (!Number.isFinite(+date)) return null;
  const parts = dateOnly
    ? date.toISOString().slice(0, 7).split("-")
    : new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Denver",
        year: "numeric",
        month: "2-digit",
      }).formatToParts(date);
  const year = dateOnly
    ? Number(parts[0])
    : Number(
        (parts as Intl.DateTimeFormatPart[]).find((p) => p.type === "year")
          ?.value,
      );
  const month = dateOnly
    ? Number(parts[1])
    : Number(
        (parts as Intl.DateTimeFormatPart[]).find((p) => p.type === "month")
          ?.value,
      );
  return year >= 1900 && year <= 9998 ? { year, month } : null;
}
