export const BUSINESS_TIME_ZONE = "America/Chicago";

export type BusinessDueDateClassification = "overdue" | "today" | "future";

type DateParts = {
  year: number;
  month: number;
  day: number;
};

const businessDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const offsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function partsFor(date: Date): DateParts {
  const values = new Map(
    businessDateFormatter
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
  };
}

function keyForParts({ year, month, day }: DateParts) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(
    2,
    "0",
  )}-${String(day).padStart(2, "0")}`;
}

function parseDateParts(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function offsetMilliseconds(date: Date) {
  // Offset labels vary by browser/ICU (GMT-5, GMT-05:00, Unicode minus).
  // Numeric wall-clock parts avoid parsing localized time-zone names.
  const parts = new Map(offsetFormatter.formatToParts(date).map(part => [part.type, part.value]));
  const wallClock = Date.UTC(
    Number(parts.get("year")), Number(parts.get("month")) - 1,
    Number(parts.get("day")), Number(parts.get("hour")) % 24,
    Number(parts.get("minute")), Number(parts.get("second")),
  );
  return wallClock - Math.floor(date.getTime() / 1000) * 1000;
}

function localDateTimeToInstant(parts: DateParts, hour: number) {
  const wallClock = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hour,
  );
  let instant = new Date(wallClock - offsetMilliseconds(new Date(wallClock)));
  const corrected = new Date(wallClock - offsetMilliseconds(instant));
  if (corrected.getTime() !== instant.getTime()) {
    instant = corrected;
  }
  return instant;
}

function addCalendarDays(parts: DateParts, days: number): DateParts {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function businessDateKey(date: Date): string {
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Business date requires a valid Date.");
  }
  return keyForParts(partsFor(date));
}

/**
 * Stage 1 date fields are calendar dates in America/Chicago. They are stored
 * as timezone-aware timestamps at Chicago noon so DST offset changes cannot
 * move a selected date into an adjacent calendar day.
 */
export function parseBusinessDate(value: string): Date | null {
  const parts = parseDateParts(value);
  return parts ? localDateTimeToInstant(parts, 12) : null;
}

export function parseBusinessDateInput(value: unknown): Date | null {
  if (typeof value === "string") {
    const calendarDate = parseBusinessDate(value);
    if (calendarDate) return calendarDate;

    // API clients serialize Date objects as ISO timestamps. Accept those too,
    // then normalize them back to the business calendar date in Chicago.
    const instant = new Date(value);
    if (Number.isFinite(instant.getTime())) {
      return parseBusinessDate(businessDateKey(instant));
    }
    return null;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return parseBusinessDate(businessDateKey(value));
  }
  return null;
}

export function businessDayBounds(reference: Date): {
  start: Date;
  end: Date;
} {
  const parts = partsFor(reference);
  return {
    start: localDateTimeToInstant(parts, 0),
    end: localDateTimeToInstant(addCalendarDays(parts, 1), 0),
  };
}

export function classifyBusinessDueDate(
  dueAt: Date,
  now: Date,
): BusinessDueDateClassification {
  const dueKey = businessDateKey(dueAt);
  const todayKey = businessDateKey(now);
  if (dueKey < todayKey) return "overdue";
  if (dueKey === todayKey) return "today";
  return "future";
}

export function isFutureBusinessDate(dueAt: Date, now: Date): boolean {
  if (!Number.isFinite(dueAt.getTime()) || !Number.isFinite(now.getTime())) {
    return false;
  }
  return classifyBusinessDueDate(dueAt, now) === "future";
}
