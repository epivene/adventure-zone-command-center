import type {
  LeadScoutCandidate,
  LeadScoutCandidateFact,
  LeadScoutSource,
} from "@/features/assistant/assistant-types";

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function dateRange(candidate: LeadScoutCandidate) {
  const start = formatDate(candidate.startsAt);
  const end = formatDate(candidate.endsAt);
  if (!start) return "Date still being researched";
  if (!end || end === start) return start;
  return `${start.replace(/, \d{4}$/, "")} – ${end}`;
}

function factValue(fact: LeadScoutCandidateFact) {
  if (typeof fact.value === "string" || typeof fact.value === "number") return String(fact.value);
  if (fact.value == null) return "Not specified";
  try { return JSON.stringify(fact.value); } catch { return String(fact.value); }
}

function evidenceLabel(fact: LeadScoutCandidateFact) {
  return fact.category === "social_review" ? "Public social/review signal" : fact.key.replace(/_/g, " ");
}

export function LeadScoutCandidateCard({
  candidate,
  sources,
  canDismiss,
  canSave = false,
  onResearchDeeper,
  onNotFit,
  onSaveAsLead = () => undefined,
  onScoutAround,
}: {
  candidate: LeadScoutCandidate;
  sources: LeadScoutSource[];
  canDismiss: boolean;
  canSave?: boolean;
  onResearchDeeper(candidateId: string): void;
  onNotFit(candidateId: string): void;
  onSaveAsLead?: (candidateId: string) => void;
  onScoutAround?: (candidate: LeadScoutCandidate) => void;
}) {
  const location = [candidate.city, candidate.region].filter(Boolean).join(", ");
  const savedProfileId = candidate.savedOrganizationId ?? candidate.matchedOrganizationId;
  const badge = candidate.reviewStatus === "saved"
    ? "In Command Center"
    : candidate.crmMatchStatus === "existing"
      ? "Already in Command Center"
      : candidate.crmMatchStatus === "possible_match"
        ? "Possible match"
        : "Found";
  const relevantSourceIds = new Set(candidate.facts.flatMap((fact) => fact.sourceIds));
  const relevantSources = sources.filter((source) => relevantSourceIds.has(source.id));
  const reviewable = candidate.reviewStatus !== "dismissed" && candidate.reviewStatus !== "saved";
  const canDeepen = reviewable;
  const deepResearchPending = candidate.enrichmentStatus === "enriching"
    || (candidate.enrichmentStatus === "needs_enrichment" && Boolean(candidate.deepenRequestedAt));
  const showNotFit = reviewable && candidate.crmMatchStatus !== "existing";
  const showSave = reviewable && candidate.crmMatchStatus === "new_prospect";
  const canScoutAround = Boolean(onScoutAround && candidate.city && candidate.region);

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

      {candidate.enrichmentStatus === "enrichment_failed" ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-bold text-amber-900">Needs more research</p>
          {candidate.enrichmentError ? <p className="mt-1 text-xs text-amber-800">{candidate.enrichmentError}</p> : null}
        </div>
      ) : null}

      <div className="mt-3 grid gap-2 text-sm text-slate-700">
        {candidate.vendorSummary ? <p><span className="font-semibold">Opportunity:</span> {candidate.vendorSummary}</p> : null}
        {candidate.organizerName || candidate.organizerEmail || candidate.organizerPhone ? <p><span className="font-semibold">Contact:</span> {[candidate.organizerName, candidate.organizerEmail, candidate.organizerPhone].filter(Boolean).join(" · ")}</p> : null}
        {candidate.attendanceSummary ? <p><span className="font-semibold">Attendance:</span> {candidate.attendanceSummary}</p> : null}
        {candidate.applicationDeadline ? <p><span className="font-semibold">Application deadline:</span> {formatDate(candidate.applicationDeadline)}</p> : null}
        {candidate.recurrenceSummary ? <p><span className="font-semibold">History:</span> {candidate.recurrenceSummary}</p> : null}
      </div>

      {candidate.fitScore != null ? (
        <div className="mt-3 rounded-lg bg-slate-50 p-3">
          <p className="text-sm font-bold text-slate-900">Scout Score: {candidate.fitScore}%</p>
          {candidate.fitReasons.length ? <p className="mt-1 text-xs text-slate-600">{candidate.fitReasons.slice(0, 3).join(" · ")}</p> : candidate.fitRationale ? <p className="mt-1 text-xs text-slate-600">{candidate.fitRationale}</p> : null}
          {candidate.fitCautions.length ? <ul className="mt-2 grid gap-1 text-xs text-amber-800">{candidate.fitCautions.slice(0, 3).map((caution) => <li key={caution}>Caution: {caution}</li>)}</ul> : null}
        </div>
      ) : null}

      {candidate.coverageGaps.length ? <p className="mt-3 text-xs text-slate-500">Still missing: {candidate.coverageGaps.slice(0, 2).join(" · ")}</p> : null}

      <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">Research details</summary>
        <div className="mt-3 grid gap-3">
          {candidate.facts.length ? <ul className="grid gap-2">{candidate.facts.map((fact) => (
            <li className="rounded-lg bg-white p-2 text-xs text-slate-700" key={fact.id}>
              <p className="font-bold text-slate-900">{evidenceLabel(fact)}</p>
              <p className="mt-0.5">{factValue(fact)}</p>
              <p className="mt-1 text-slate-500">{fact.confidence} confidence · {fact.rationale}</p>
            </li>
          ))}</ul> : <p className="text-xs text-slate-500">No detailed evidence has been saved yet.</p>}
          {relevantSources.length ? (
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Open sources</p>
              <div className="mt-1 flex flex-wrap gap-2">{relevantSources.map((source) => (
                <a className="text-xs font-semibold text-orange-700 hover:underline" href={source.url} key={source.id} rel="noreferrer" target="_blank">{source.title}</a>
              ))}</div>
            </div>
          ) : null}
        </div>
      </details>

      <div className="mt-3 flex flex-wrap gap-2">
        {candidate.website ? <a className="button-secondary" href={candidate.website} rel="noreferrer" target="_blank">Open event page</a> : null}
        {canScoutAround ? <button className="button-secondary" onClick={() => onScoutAround?.(candidate)} type="button">Scout Around This Event</button> : null}
        {candidate.reviewStatus === "saved" && savedProfileId ? <a className="button-primary" href={`/profiles/${savedProfileId}`}>Open profile</a> : null}
        {candidate.reviewStatus !== "saved" && candidate.crmMatchStatus === "existing" && candidate.matchedOrganizationId ? <a className="button-secondary" href={`/profiles/${candidate.matchedOrganizationId}`}>Open profile</a> : null}
        {candidate.crmMatchStatus === "possible_match" && candidate.matchedOrganizationId ? <a className="button-secondary" href={`/profiles/${candidate.matchedOrganizationId}`}>Review match</a> : null}
        {showSave ? (
          <button className="button-primary" disabled={!canSave} onClick={() => onSaveAsLead(candidate.id)} title={canSave ? undefined : "Stop the active Scout before creating this profile."} type="button">Create Profile</button>
        ) : null}
        {canDeepen ? (
          <button className="button-secondary" disabled={deepResearchPending} onClick={() => onResearchDeeper(candidate.id)} type="button">
            {deepResearchPending ? "Researching deeper…" : "Research deeper"}
          </button>
        ) : null}
        {showNotFit ? (
          <button
            className="button-secondary"
            disabled={!canDismiss}
            onClick={() => onNotFit(candidate.id)}
            title={canDismiss ? undefined : "Stop the active Scout before dismissing a prospect."}
            type="button"
          >
            Not a fit
          </button>
        ) : null}
      </div>
    </article>
  );
}