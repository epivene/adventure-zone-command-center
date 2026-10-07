export type ScheduleDateProvenance = {
  rawPublic: { start: string | null; end: string | null };
  rawReservation: { start: string | null; end: string | null };
  publicWindow?: { start: string; end: string } | null;
  reservationWindow?: { start: string; end: string } | null;
  evidenceState: "verified" | "needs_review";
  reviewReasons: string[];
};

type DateStatusInput = {
  startsAt: Date | null;
  dateProvenance?: ScheduleDateProvenance;
};

function savedDateLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  // Open-ended import sentinels must never look like actual event dates.
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() >= 2100) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value) ? "UTC" : "America/Denver",
    month: "short", day: "numeric", year: "numeric",
  }).format(date);
}

function savedWindowLabel(label: string, window: { start: string | null; end: string | null }): string | null {
  const start = savedDateLabel(window.start), end = savedDateLabel(window.end);
  if (!start && !end) return null;
  return `${label}: ${start ?? "Start not recorded"} – ${end ?? "End not recorded"}`;
}

/** Display evidence without promoting raw dates into calendar or capacity windows. */
export function scheduleDateStatus(event: DateStatusInput): {
  kind: "ready" | "review" | "missing"; label: string; details: string[];
} {
  const dates = event.dateProvenance;
  const details = dates ? [
    savedWindowLabel("Saved public dates", dates.rawPublic),
    savedWindowLabel("Saved travel/setup dates", dates.rawReservation),
  ].filter((value): value is string => value !== null) : [];
  const hasDisplayDate = event.startsAt && Number.isFinite(event.startsAt.getTime());
  if (!hasDisplayDate && !details.length) return { kind: "missing", label: "Needs dates", details };
  if (dates?.evidenceState === "needs_review" || !hasDisplayDate) {
    return {
      kind: "review",
      label: dates?.publicWindow && !dates.reservationWindow && dates.reviewReasons.some(reason => reason.includes("RESERVATION"))
        ? "Travel/setup dates need review" : "Dates need review",
      details,
    };
  }
  return { kind: "ready", label: "", details: [] };
}
