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

function formatEventRange(startsAt: Date, endsAt: Date | null) {
  if (!endsAt || endsAt.getTime() === startsAt.getTime()) return formatDateTime(startsAt);
  return `${formatDateTime(startsAt)} → ${formatDateTime(endsAt)}`;
}

export function EventScheduleWindow({
  startsAt,
  endsAt,
  className = "",
}: {
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
  className?: string;
}) {
  const start = asDate(startsAt);
  const end = asDate(endsAt) ?? start;
  if (!start || !end) return <p className={className}>Event dates: Date not set</p>;

  const bufferBeforeStart = shiftedDate(start, -2);
  const bufferBeforeEnd = shiftedDate(start, -1);
  const bufferAfter = shiftedDate(end, 1);

  return (
    <div className={className}>
      <p>{`Event dates: ${formatEventRange(start, end)}`}</p>
      <p>{`Buffer before: ${formatDay(bufferBeforeStart)} – ${formatDay(bufferBeforeEnd)}`}</p>
      <p>{`Buffer after: ${formatDay(bufferAfter)}`}</p>
    </div>
  );
}
