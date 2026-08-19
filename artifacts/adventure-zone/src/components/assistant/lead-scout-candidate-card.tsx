import type { LeadScoutCandidate } from "@/features/assistant/assistant-types";

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function dateRange(candidate: LeadScoutCandidate) {
  const start = formatDate(candidate.startsAt);
  const end = formatDate(candidate.endsAt);
  if (!start) return "Date still being researched";
  if (!end || end === start) return start;
  const startShort = start.replace(/, \d{4}$/, "");
  return `${startShort} – ${end}`;
}

export function LeadScoutCandidateCard({ candidate }: { candidate: LeadScoutCandidate }) {
  const location = [candidate.city, candidate.region].filter(Boolean).join(", ");
  const badge = candidate.crmMatchStatus === "existing"
    ? "Already in Command Center"
    : candidate.crmMatchStatus === "possible_match"
      ? "Possible match"
      : "Unsaved prospect";

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-bold text-slate-950">{candidate.name}</h4>
          <p className="mt-1 text-sm text-slate-600">{location || "Location still being researched"}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{badge}</span>
      </div>

      <p className="mt-2 text-sm font-semibold text-slate-800">{dateRange(candidate)}</p>
      {candidate.eventType ? <p className="mt-1 text-xs text-slate-500">{candidate.eventType}</p> : null}
      {candidate.fitRationale ? <p className="mt-2 text-sm text-slate-700">{candidate.fitRationale}</p> : null}
      {candidate.fitScore != null ? <p className="mt-1 text-xs font-semibold text-slate-500">Adventure Zone fit: {candidate.fitScore}/100</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {candidate.website ? (
          <a className="button-secondary" href={candidate.website} rel="noreferrer" target="_blank">Open source</a>
        ) : null}
        {candidate.crmMatchStatus === "existing" && candidate.matchedOrganizationId ? (
          <a className="button-secondary" href={`/profiles/${candidate.matchedOrganizationId}`}>Open profile</a>
        ) : null}
        {candidate.crmMatchStatus === "possible_match" && candidate.matchedOrganizationId ? (
          <a className="button-secondary" href={`/profiles/${candidate.matchedOrganizationId}`}>Review match</a>
        ) : null}
      </div>
    </article>
  );
}
