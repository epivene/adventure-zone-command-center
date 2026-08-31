import type { MapEvent } from "@/features/routes/map-data";
import { businessDateKey } from "@/lib/business-date";

const inactiveStatuses = new Set(["declined", "cancelled", "completed"]);
const DAY_MS = 24 * 60 * 60 * 1000;

export type RouteConflictEvent = Pick<
  MapEvent,
  "id" | "name" | "status" | "travelLegId" | "travelLegName" | "startsAt" | "endsAt"
> & {
  actualStartsAt?: Date | null;
  actualEndsAt?: Date | null;
  operationalWindowSource?: string;
};

export type RouteConflict = {
  legId: string;
  legName: string;
  overlapFrom: string;
  overlapTo: string;
  first: RouteConflictEvent;
  second: RouteConflictEvent;
};

function shiftBusinessDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setTime(date.getTime() + days * DAY_MS);
  return date.toISOString().slice(0, 10);
}

function normalizedRange(event: RouteConflictEvent) {
  if (!event.startsAt) return null;
  const eventStart = businessDateKey(event.startsAt);
  const candidateEnd = businessDateKey(event.endsAt ?? event.startsAt);
  const eventEnd = candidateEnd < eventStart ? eventStart : candidateEnd;
  const alreadyReserved = Boolean(event.operationalWindowSource);

  return {
    start: shiftBusinessDate(eventStart, alreadyReserved ? 0 : -1),
    end: shiftBusinessDate(eventEnd, alreadyReserved ? 0 : 1),
  };
}

export function findSameLegDateConflicts(events: RouteConflictEvent[]): RouteConflict[] {
  const eligible = events.filter(
    (event) =>
      Boolean(event.travelLegId) &&
      Boolean(event.startsAt) &&
      !inactiveStatuses.has(String(event.status).toLowerCase()),
  );
  const conflicts: RouteConflict[] = [];

  for (let i = 0; i < eligible.length; i += 1) {
    const first = eligible[i]!;
    const firstRange = normalizedRange(first)!;
    for (let j = i + 1; j < eligible.length; j += 1) {
      const second = eligible[j]!;
      if (first.id === second.id || first.travelLegId !== second.travelLegId) continue;
      const secondRange = normalizedRange(second)!;
      const overlapFrom = firstRange.start > secondRange.start ? firstRange.start : secondRange.start;
      const overlapTo = firstRange.end < secondRange.end ? firstRange.end : secondRange.end;
      if (overlapFrom > overlapTo) continue;
      conflicts.push({
        legId: first.travelLegId!,
        legName: first.travelLegName ?? second.travelLegName ?? "Same leg",
        overlapFrom,
        overlapTo,
        first,
        second,
      });
    }
  }

  return conflicts.sort((a, b) => a.overlapFrom.localeCompare(b.overlapFrom) || a.legName.localeCompare(b.legName));
}
