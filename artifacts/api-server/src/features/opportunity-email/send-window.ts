export type SendWindowSettings = {
  morningStart: string;
  morningEnd: string;
  weekdaysOnly: boolean;
  businessTimeZone: string;
};

type LocalDate = { year: number; month: number; day: number };
type LocalDateTime = LocalDate & { hour: number; minute: number };

function parseClock(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("SEND_WINDOW_TIME_INVALID");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("SEND_WINDOW_TIME_INVALID");
  return hour * 60 + minute;
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function resolvedTimeZone(settings: SendWindowSettings, recipientTimeZone: string | null): string {
  if (recipientTimeZone && validTimeZone(recipientTimeZone)) return recipientTimeZone;
  if (!validTimeZone(settings.businessTimeZone)) throw new Error("SEND_WINDOW_TIME_ZONE_INVALID");
  return settings.businessTimeZone;
}

function zonedParts(date: Date, timeZone: string): LocalDateTime {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function weekday(date: LocalDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function nextDeliveryDate(now: Date, timeZone: string, weekdaysOnly: boolean): LocalDate {
  const current = zonedParts(now, timeZone);
  let candidate = addDays(current, 1);
  while (weekdaysOnly && (weekday(candidate) === 0 || weekday(candidate) === 6)) {
    candidate = addDays(candidate, 1);
  }
  return candidate;
}

function localDateTimeToUtc(local: LocalDateTime, timeZone: string): Date {
  const desiredAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  let guess = desiredAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    const delta = desiredAsUtc - actualAsUtc;
    if (delta === 0) break;
    guess += delta;
  }

  const result = new Date(guess);
  const finalParts = zonedParts(result, timeZone);
  if (
    finalParts.year !== local.year ||
    finalParts.month !== local.month ||
    finalParts.day !== local.day ||
    finalParts.hour !== local.hour ||
    finalParts.minute !== local.minute
  ) {
    throw new Error("SEND_WINDOW_LOCAL_TIME_INVALID");
  }
  return result;
}

function scheduleAtMinute(input: {
  now: Date;
  settings: SendWindowSettings;
  recipientTimeZone: string | null;
  minuteOfDay: number;
}): Date {
  const timeZone = resolvedTimeZone(input.settings, input.recipientTimeZone);
  const date = nextDeliveryDate(input.now, timeZone, input.settings.weekdaysOnly);
  return localDateTimeToUtc(
    {
      ...date,
      hour: Math.floor(input.minuteOfDay / 60),
      minute: input.minuteOfDay % 60,
    },
    timeZone,
  );
}

export function tomorrowMorning(input: {
  now: Date;
  settings: SendWindowSettings;
  recipientTimeZone: string | null;
}): Date {
  return scheduleAtMinute({
    ...input,
    minuteOfDay: parseClock(input.settings.morningStart),
  });
}

export function morningStagger(input: {
  now: Date;
  settings: SendWindowSettings;
  drafts: Array<{ id: string; recipientTimeZone: string | null }>;
}): Array<{ draftId: string; scheduledFor: Date }> {
  if (input.drafts.length === 0) return [];

  const start = parseClock(input.settings.morningStart);
  const end = parseClock(input.settings.morningEnd);
  if (end < start) throw new Error("SEND_WINDOW_RANGE_INVALID");

  const span = end - start;
  return input.drafts.map((draft, index) => {
    const offset = input.drafts.length === 1
      ? 0
      : Math.round((span * index) / (input.drafts.length - 1));
    return {
      draftId: draft.id,
      scheduledFor: scheduleAtMinute({
        now: input.now,
        settings: input.settings,
        recipientTimeZone: draft.recipientTimeZone,
        minuteOfDay: start + offset,
      }),
    };
  });
}
