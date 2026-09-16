function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function businessLocalInputToUtc(input: {
  localDateTime: string;
  timeZone: string;
}): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(
    input.localDateTime,
  );
  if (!match) throw new Error("BUSINESS_LOCAL_TIME_INVALID");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone }).format(
      new Date(),
    );
  } catch {
    throw new Error("BUSINESS_TIME_ZONE_INVALID");
  }
  const [, year, month, day, hour, minute] = match;
  const desired = `${year}-${month}-${day}T${hour}:${minute}`;
  const center = Date.UTC(+year!, +month! - 1, +day!, +hour!, +minute!);
  const matches: Date[] = [];
  for (
    let offsetMinutes = -14 * 60;
    offsetMinutes <= 14 * 60;
    offsetMinutes += 15
  ) {
    const candidate = new Date(center + offsetMinutes * 60_000);
    const parts = localParts(candidate, input.timeZone);
    const rendered = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    if (rendered === desired) matches.push(candidate);
  }
  const unique = [
    ...new Map(matches.map((date) => [date.toISOString(), date])).values(),
  ];
  if (unique.length !== 1)
    throw new Error("BUSINESS_LOCAL_TIME_AMBIGUOUS_OR_MISSING");
  return unique[0]!.toISOString();
}

export function formatBusinessSchedule(input: {
  utcDateTime: string;
  timeZone: string;
}): string {
  const date = new Date(input.utcDateTime);
  if (!Number.isFinite(date.valueOf()))
    throw new Error("BUSINESS_SCHEDULE_INVALID");
  return new Intl.DateTimeFormat("en-US", {
    timeZone: input.timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}
