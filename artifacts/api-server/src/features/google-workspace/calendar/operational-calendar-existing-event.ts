import type {
  OperationalCalendarEvent,
  OperationalCalendarEventInput,
} from "./operational-calendar-client";

export type ExactOperationalCalendarEventMatch =
  | { kind: "none" }
  | { kind: "matched"; event: OperationalCalendarEvent }
  | { kind: "ambiguous"; events: OperationalCalendarEvent[] };

export function findExactOperationalCalendarEvent(
  events: OperationalCalendarEvent[],
  input: OperationalCalendarEventInput,
): ExactOperationalCalendarEventMatch {
  const summary = input.summary.trim();
  const matches = events.filter((event) =>
    event.status !== "cancelled"
    && event.summary.trim() === summary
    && event.startDate === input.startDate
    && event.endDateExclusive === input.endDateExclusive,
  );
  if (matches.length === 0) return { kind: "none" };
  if (matches.length === 1) return { kind: "matched", event: matches[0]! };
  return { kind: "ambiguous", events: matches };
}
