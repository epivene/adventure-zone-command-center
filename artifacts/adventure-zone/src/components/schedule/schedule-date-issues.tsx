import { Link } from "wouter";
import { scheduleDateStatus, type ScheduleDateProvenance } from "@/features/calendar/schedule-date-status";

type DateReviewEvent = {
  id: string; name?: string; displaySubject?: string;
  organizationId?: string | null; startsAt: Date | null;
  dateProvenance?: ScheduleDateProvenance;
};

/** Group date clues for display only; never promote them to a verified season. */
function savedDatesOutsideSeason(event: DateReviewEvent, season?: string): boolean {
  if (!season || !/^\d{4}$/.test(season)) return false;
  // An explicit season in a booking name is still a reason to review it here,
  // even when its imported dates disagree.
  if (new RegExp(`\\b${season}\\b`).test(event.name ?? event.displaySubject ?? "")) return false;
  const raw = event.dateProvenance;
  const values = [event.startsAt, raw?.rawPublic.start, raw?.rawPublic.end,
    raw?.rawReservation.start, raw?.rawReservation.end];
  const years: number[] = [];
  for (const value of values) {
    if (!value) continue;
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) continue;
    // A sentinel end means the season is unknown, not a completed old window.
    if (date.getUTCFullYear() >= 2100) return false;
    const timeZone = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? "UTC" : "America/Denver";
    years.push(Number(new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone }).format(date)));
  }
  return years.length > 0 && (Math.max(...years) < Number(season) || Math.min(...years) > Number(season));
}

export function ScheduleDateNotice({ event, readOnly = false }: { event: DateReviewEvent; readOnly?: boolean }) {
  const status = scheduleDateStatus(event);
  if (status.kind === "ready") return null;
  return <div className="mt-1 grid gap-1 text-xs text-amber-800">
    <p className="font-semibold">{status.label}</p>
    {status.details.map(detail => <p key={detail}>{detail}</p>)}
    {status.kind === "review" ? <p>Saved dates are unverified and may need correction.</p> : null}
    {!readOnly ? <Link className="inline-flex min-h-9 items-center font-semibold underline" href={`/settings/event-date-coverage?bookingId=${encodeURIComponent(event.id)}`}>Review dates</Link> : null}
  </div>;
}

export function ScheduleDateIssues({ events, profileBasePath = "/profiles", season, readOnly = false }: {
  events: DateReviewEvent[]; profileBasePath?: string; season?: string; readOnly?: boolean;
}) {
  const issues = events.filter(event => scheduleDateStatus(event).kind !== "ready");
  if (!issues.length) return null;
  const currentIssues = issues.filter(event => !savedDatesOutsideSeason(event, season));
  const otherIssues = issues.filter(event => savedDatesOutsideSeason(event, season));
  function renderIssues(rows: DateReviewEvent[], otherSeasons = false) {
    if (!rows.length) return null;
    const reviewCount = rows.filter(event => scheduleDateStatus(event).kind === "review").length;
    const missingCount = rows.length - reviewCount;
    return <details className="rounded-xl border border-amber-200 bg-white text-sm">
    <summary className="min-h-11 cursor-pointer px-4 py-3 font-semibold text-amber-900">
      {otherSeasons ? `Other-season date reviews (${rows.length})` : `Date checks (${rows.length})`}{reviewCount ? ` · ${reviewCount} need review` : ""}{missingCount ? ` · ${missingCount} missing dates` : ""}
    </summary>
    <div className="grid gap-3 border-t border-amber-100 p-4">
      {otherSeasons ? <p className="text-slate-600">These saved date clues are outside {season}. They remain available for review; this grouping does not verify dates or change bookings.</p> : null}
      {rows.map(event => {
        const query = new URLSearchParams({ bookingId: event.id });
        if (season && !otherSeasons) query.set("season", season);
        const href = event.organizationId ? `${profileBasePath}/${encodeURIComponent(event.organizationId)}?${query}`
          : readOnly ? null : `/bookings/${encodeURIComponent(event.id)}`;
        const name = event.name ?? event.displaySubject ?? "Event";
        return <article key={event.id}>
          {href ? <Link className="font-semibold text-blue-700 underline" href={href}>{name}</Link> : <p className="font-semibold">{name}</p>}
          <ScheduleDateNotice event={event} readOnly={readOnly} />
        </article>;
      })}
    </div>
  </details>;
  }
  return <div className="grid gap-3">{renderIssues(currentIssues)}{renderIssues(otherIssues, true)}</div>;
}
