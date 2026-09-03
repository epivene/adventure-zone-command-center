const DENVER_TIME_ZONE = "America/Denver";

function zonedParts(value: Date): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DENVER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: "year" | "month" | "day") =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

function denverLocalToUtc(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
}): Date {
  const wallClockAsUtc = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
  );
  let result = wallClockAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: DENVER_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(result));
    const value = (type: string) =>
      Number(parts.find((candidate) => candidate.type === type)?.value);
    const renderedAsUtc = Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      value("hour"),
      value("minute"),
      value("second"),
    );
    result += wallClockAsUtc - renderedAsUtc;
  }
  return new Date(result);
}

export function nextDenverBusinessDayAtNine(from: Date): Date {
  const local = zonedParts(from);
  const candidate = new Date(
    Date.UTC(local.year, local.month - 1, local.day + 1),
  );
  while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return denverLocalToUtc({
    year: candidate.getUTCFullYear(),
    month: candidate.getUTCMonth() + 1,
    day: candidate.getUTCDate(),
    hour: 9,
  });
}
