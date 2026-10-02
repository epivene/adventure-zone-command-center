import { useEffect, useState } from "react";
const listeners = new Set<(bookingId: string) => void>();
export type LegPlanningChange = {
  affectedBookingIds: string[];
  legIds: string[];
  seasonYears: number[];
};
const planningListeners = new Set<(change: LegPlanningChange) => void>();
export function subscribeLegPlanningChanges(
  listener: (change: LegPlanningChange) => void,
): () => void {
  planningListeners.add(listener);
  return () => {
    planningListeners.delete(listener);
  };
}
/** A changed allocation can affect a neighbor absent from the mutation receipt. */
export function notifyLegPlanningChanged(result: {
  affectedBookingIds: string[];
  value: unknown;
}): void {
  const values = Array.isArray(result.value) ? result.value : [result.value];
  const records = values
    .flatMap((value) =>
      value && typeof value === "object"
        ? [value as Record<string, unknown>]
        : [],
    )
    .map((value) =>
      value.draft && typeof value.draft === "object"
        ? (value.draft as Record<string, unknown>)
        : value,
    );
  const change: LegPlanningChange = {
    affectedBookingIds: [...new Set(result.affectedBookingIds)],
    legIds: [
      ...new Set(
        records.flatMap((v) =>
          typeof (v.legId ?? v.parentLegId) === "string"
            ? [String(v.legId ?? v.parentLegId)]
            : [],
        ),
      ),
    ],
    seasonYears: [
      ...new Set(
        records.flatMap((v) =>
          typeof v.seasonYear === "number" ? [v.seasonYear] : [],
        ),
      ),
    ],
  };
  for (const listener of [...planningListeners]) {
    try {
      listener(change);
    } catch {
      /* A subscriber cannot undo a saved mutation. */
    }
  }
  notifyBookingOperationsChanged("*");
}
/** '*' invalidates all bookings when an existing action only returns a request ID. */
export function notifyBookingOperationsChanged(bookingId: string): void {
  for (const listener of [...listeners]) {
    // An observer must not turn a successful canonical save into a save error.
    try {
      listener(bookingId);
    } catch {
      /* The consumer can retry its own read. */
    }
  }
}
export function subscribeBookingOperationsChanges(
  listener: (bookingId: string) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useBookingOperationsRevision(
  bookingId?: string | null,
): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    const dispose = subscribeBookingOperationsChanges((id) => {
      if (!bookingId || id === "*" || id === bookingId) refresh();
    });
    window.addEventListener("focus", refresh);
    return () => {
      dispose();
      window.removeEventListener("focus", refresh);
    };
  }, [bookingId]);
  return revision;
}
