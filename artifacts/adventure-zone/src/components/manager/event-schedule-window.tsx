function asDate(value?: string | Date | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date : null;
}

function shiftedDate(value: Date, days: number) {
  const shifted = new Date(value);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

function startOfDay(value: Date) {
  const day = new Date(value);
  day.setHours(0, 0, 0, 0);
  return day;
}

function formatDateTime(value: Date) {
  return value.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDay(value: Date) {
  return value.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDayRange(startsAt: Date, endsAt: Date) {
  if (startOfDay(startsAt).getTime() === startOfDay(endsAt).getTime()) return formatDay(startsAt);
  return `${formatDay(startsAt)} – ${formatDay(endsAt)}`;
}

function formatEventRange(startsAt: Date, endsAt: Date | null) {
  if (!endsAt || endsAt.getTime() === startsAt.getTime()) return formatDateTime(startsAt);
  return `${formatDateTime(startsAt)} → ${formatDateTime(endsAt)}`;
}

export function EventScheduleWindow({
  startsAt,
  endsAt,
  operationalStartsAt,
  operationalEndsAt,
  className = "",
}: {
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
  operationalStartsAt?: string | Date | null;
  operationalEndsAt?: string | Date | null;
  className?: string;
}) {
  const start = asDate(startsAt);
  const end = asDate(endsAt) ?? start;
  if (!start || !end) return <p className={className}>Event dates: Date not set</p>;

  const bufferBeforeStart = asDate(operationalStartsAt) ?? shiftedDate(start, -2);
  const bufferBeforeEnd = shiftedDate(start, -1);
  const bufferAfterStart = shiftedDate(end, 1);
  const bufferAfterEnd = asDate(operationalEndsAt) ?? bufferAfterStart;
  const bufferBefore = startOfDay(bufferBeforeStart) < startOfDay(start)
    ? formatDayRange(bufferBeforeStart, bufferBeforeEnd)
    : "None";
  const bufferAfter = startOfDay(bufferAfterEnd) > startOfDay(end)
    ? formatDayRange(bufferAfterStart, bufferAfterEnd)
    : "None";

  return (
    <div className={className}>
      <p>{`Event dates: ${formatEventRange(start, end)}`}</p>
      <p>{`Buffer before: ${bufferBefore}`}</p>
      <p>{`Buffer after: ${bufferAfter}`}</p>
    </div>
  );
}
