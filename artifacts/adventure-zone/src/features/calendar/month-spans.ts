export type MonthSpanSegment = {
  eventId: string;
  weekIndex: number;
  startColumn: number;
  endColumn: number;
  startsHere: boolean;
  endsHere: boolean;
};

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildMonthSpanSegments(
  events: Array<{ id: string; startsAt: Date | null; endsAt: Date | null }>,
  monthDays: Date[],
): MonthSpanSegment[] {
  if (monthDays.length !== 42) throw new Error("monthDays must contain 42 dates");

  const gridKeys = monthDays.map(dateKey);
  const first = gridKeys[0]!;
  const last = gridKeys[41]!;
  const segments: MonthSpanSegment[] = [];

  for (const event of events) {
    if (!event.startsAt) continue;
    const rawStart = dateKey(event.startsAt);
    const candidateEnd = dateKey(event.endsAt ?? event.startsAt);
    const rawEnd = candidateEnd < rawStart ? rawStart : candidateEnd;
    if (rawEnd < first || rawStart > last) continue;

    const visibleStart = rawStart < first ? first : rawStart;
    const visibleEnd = rawEnd > last ? last : rawEnd;
    const startIndex = gridKeys.indexOf(visibleStart);
    const endIndex = gridKeys.indexOf(visibleEnd);
    if (startIndex < 0 || endIndex < 0) continue;

    for (
      let weekIndex = Math.floor(startIndex / 7);
      weekIndex <= Math.floor(endIndex / 7);
      weekIndex += 1
    ) {
      const weekStart = weekIndex * 7;
      const weekEnd = weekStart + 6;
      const segmentStart = Math.max(startIndex, weekStart);
      const segmentEnd = Math.min(endIndex, weekEnd);
      segments.push({
        eventId: event.id,
        weekIndex,
        startColumn: segmentStart - weekStart,
        endColumn: segmentEnd - weekStart,
        startsHere: segmentStart === startIndex && visibleStart === rawStart,
        endsHere: segmentEnd === endIndex && visibleEnd === rawEnd,
      });
    }
  }

  return segments;
}
