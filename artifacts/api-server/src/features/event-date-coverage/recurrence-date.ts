import type {
  EventRecurrenceRule,
  RecurrenceCalculation,
} from "./event-date-types";

const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateOnly(value: string) {
  const match = dateOnlyPattern.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return { year, month, day };
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function exactDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

function ordinalWeekdayDate(
  year: number,
  month: number,
  ordinal: number,
  weekday: number,
) {
  if (
    !Number.isInteger(month) || month < 1 || month > 12 ||
    !Number.isInteger(ordinal) || ordinal < 1 || ordinal > 5 ||
    !Number.isInteger(weekday) || weekday < 0 || weekday > 6
  ) return null;
  const first = new Date(Date.UTC(year, month - 1, 1));
  const day = 1 + ((weekday - first.getUTCDay() + 7) % 7) + (ordinal - 1) * 7;
  return exactDate(year, month, day);
}

function withRange(
  startsAt: Date,
  durationDays: number,
): Omit<Extract<RecurrenceCalculation, { status: "expected" }>, "calculationYear"> | null {
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 31)
    return null;
  const end = new Date(startsAt);
  end.setUTCDate(end.getUTCDate() + durationDays - 1);
  return {
    status: "expected",
    startsOn: formatDateOnly(startsAt),
    endsOn: durationDays === 1 ? null : formatDateOnly(end),
  };
}

export function calculateNextRecurrence(input: {
  today: string;
  rule: EventRecurrenceRule;
}): RecurrenceCalculation {
  const today = parseDateOnly(input.today);
  if (!today) return { status: "needs_review", reason: "invalid_rule" };
  if (input.rule.kind === "unrecognized")
    return { status: "needs_review", reason: "ambiguous_rule" };

  if (input.rule.kind === "annual_date") {
    if (
      !Number.isInteger(input.rule.month) ||
      input.rule.month < 1 ||
      input.rule.month > 12 ||
      !Number.isInteger(input.rule.day) ||
      input.rule.day < 1 ||
      input.rule.day > 31
    ) return { status: "needs_review", reason: "invalid_rule" };

    for (let year = today.year; year <= today.year + 8; year += 1) {
      const start = exactDate(year, input.rule.month, input.rule.day);
      if (!start || formatDateOnly(start) < input.today) continue;
      const range = withRange(start, input.rule.durationDays);
      return range
        ? { ...range, calculationYear: year }
        : { status: "needs_review", reason: "invalid_rule" };
    }
    return { status: "needs_review", reason: "date_not_available" };
  }

  for (let year = today.year; year <= today.year + 1; year += 1) {
    const start = ordinalWeekdayDate(
      year,
      input.rule.month,
      input.rule.ordinal,
      input.rule.weekday,
    );
    if (!start) {
      if (year === today.year)
        return { status: "needs_review", reason: "date_not_available" };
      continue;
    }
    if (formatDateOnly(start) < input.today) continue;
    const range = withRange(start, input.rule.durationDays);
    return range
      ? { ...range, calculationYear: year }
      : { status: "needs_review", reason: "invalid_rule" };
  }
  return { status: "needs_review", reason: "date_not_available" };
}
