import { Link } from "wouter";
import { scheduleDateStatus, type ScheduleDateProvenance } from "@/features/calendar/schedule-date-status";

type DateReviewEvent = {
  id: string; name?: string; displaySubject?: string;
  organizationId?: string | null; startsAt: Date | null;
  dateProvenance?: ScheduleDateProvenance;
};

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
  const reviewCount = issues.filter(event => scheduleDateStatus(event).kind === "review").length;
  const missingCount = issues.length - reviewCount;
  return <details className="rounded-xl border border-amber-200 bg-white text-sm">
    <summary className="min-h-11 cursor-pointer px-4 py-3 font-semibold text-amber-900">
      Date checks ({issues.length}){reviewCount ? ` · ${reviewCount} need review` : ""}{missingCount ? ` · ${missingCount} missing dates` : ""}
    </summary>
    <div className="grid gap-3 border-t border-amber-100 p-4">
      {issues.map(event => {
        const query = new URLSearchParams({ bookingId: event.id });
        if (season) query.set("season", season);
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
