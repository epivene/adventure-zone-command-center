import { useState } from "react";

import type {
  AssistantLeadMatch,
  LeadScoutCandidate,
  LeadScoutRunView,
} from "@/features/assistant/assistant-types";
import type {
  LeadScoutSaveResult,
  LeadScoutSaveSubmission,
} from "@/features/assistant/lead-scout-api";
import { LeadScoutCandidateCard } from "./lead-scout-candidate-card";
import { LeadScoutProgress } from "./lead-scout-progress";
import { LeadScoutSaveDialog } from "./lead-scout-save-dialog";

function formatSavedDate(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function dateLabel(match: AssistantLeadMatch, requestedYear: number | null) {
  if (match.dateConfidence === "likely_recurring") return requestedYear ? `Date not confirmed for ${requestedYear}` : "Current date not confirmed";
  if (!match.dateFrom) return "Date not confirmed";
  const from = formatSavedDate(match.dateFrom);
  const through = formatSavedDate(match.dateThrough);
  return through && through !== from ? `${from} – ${through}` : from;
}

function MatchCard({ match, requestedYear, onOpenProfile, onUseContext }: {
  match: AssistantLeadMatch;
  requestedYear: number | null;
  onOpenProfile(match: AssistantLeadMatch): void;
  onUseContext(match: AssistantLeadMatch): void;
}) {
  const location = [match.city, match.region].filter(Boolean).join(", ");
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-bold text-slate-950">{match.label}</h4>
          <p className="mt-1 text-sm text-slate-600">{location || "Location not recorded"}</p>
        </div>
        {match.dateConfidence === "confirmed" ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">Confirmed date</span>
          : match.dateConfidence === "likely_recurring" ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">Likely recurring</span> : null}
      </div>
      <p className={`mt-2 text-sm font-semibold ${match.dateConfidence === "likely_recurring" ? "text-amber-800" : "text-slate-700"}`}>{dateLabel(match, requestedYear)}</p>
      {match.relationshipSummary ? <p className="mt-1 text-xs text-slate-500">{match.relationshipSummary}</p> : null}
      {match.reasons.length ? <div className="mt-3 flex flex-wrap gap-1.5">{match.reasons.map((reason) => <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700" key={reason}>{reason}</span>)}</div> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="button-primary" onClick={() => onUseContext(match)} type="button">Use as context</button>
        <button className="button-secondary" onClick={() => onOpenProfile(match)} type="button">Open profile</button>
      </div>
    </article>
  );
}

function MatchGroup({ title, description, matches, requestedYear, onOpenProfile, onUseContext }: {
  title: string;
  description?: string;
  matches: AssistantLeadMatch[];
  requestedYear: number | null;
  onOpenProfile(match: AssistantLeadMatch): void;
  onUseContext(match: AssistantLeadMatch): void;
}) {
  if (!matches.length) return null;
  return (
    <section className="grid gap-2">
      <div><h3 className="font-bold text-slate-950">{title}</h3>{description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}</div>
      {matches.map((match) => <MatchCard key={`${match.organizationId}:${match.bookingId ?? "profile"}`} match={match} requestedYear={requestedYear} onOpenProfile={onOpenProfile} onUseContext={onUseContext} />)}
    </section>
  );
}

export function LeadDiscoveryResults({
  run,
  webScoutAvailable,
  onOpenProfile,
  onUseContext,
  onFindNewLeads,
  onStopSearch = () => undefined,
  onContinueSearch = () => undefined,
  onResearchDeeper = () => undefined,
  onNotFit = () => undefined,
  onSaveCandidate,
  onScoutAroundCandidate,
}: {
  run: LeadScoutRunView;
  webScoutAvailable: boolean;
  onOpenProfile(match: AssistantLeadMatch): void;
  onUseContext(match: AssistantLeadMatch): void;
  onFindNewLeads(): void;
  onStopSearch?: () => void;
  onContinueSearch?: () => void;
  onResearchDeeper?: (candidateId: string) => void;
  onNotFit?: (candidateId: string) => void;
  onSaveCandidate?: (candidateId: string, input: LeadScoutSaveSubmission) => Promise<LeadScoutSaveResult>;
  onScoutAroundCandidate?: (candidate: LeadScoutCandidate) => void;
}) {
  const [saveCandidateId, setSaveCandidateId] = useState<string | null>(null);
  const confirmed = run.crmMatches.filter((match) => match.dateConfidence === "confirmed");
  const recurring = run.crmMatches.filter((match) => match.dateConfidence === "likely_recurring");
  const other = run.crmMatches.filter((match) => match.dateConfidence === "unknown");
  const webStarted = run.status !== "crm_ready" && run.status !== "crm_search" && run.status !== "interpreting";
  const visibleCandidates = run.candidates.filter((candidate) => candidate.reviewStatus !== "dismissed");
  const canReview = run.status !== "running" && run.status !== "stopping";
  const selectedCandidate = saveCandidateId ? run.candidates.find((candidate) => candidate.id === saveCandidateId) ?? null : null;
  const radiusScope = run.criteria?.radiusScope;
  const communitiesChecked = radiusScope?.searchPlaces.filter((place) => place.placeType !== "county").length ?? 0;
  const countiesChecked = radiusScope?.searchPlaces.filter((place) => place.placeType === "county").length ?? 0;

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border border-orange-200 bg-orange-50 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-orange-800">I understood this as</p>
        <p className="mt-1 font-semibold text-slate-950">{run.criteriaSummary || run.originalQuestion}</p>
        <p className="mt-2 text-sm text-slate-700">I checked Command Center first. Likely recurring matches are based on saved past dates and are not treated as confirmed current-year events.</p>
      </section>

      {radiusScope ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Radius coverage</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {radiusScope.radiusMiles} miles around {radiusScope.anchor.label}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {communitiesChecked} {communitiesChecked === 1 ? "community" : "communities"} · {countiesChecked} {countiesChecked === 1 ? "county" : "counties"} queued
          </p>
          {radiusScope.searchAreaIncomplete ? (
            <p className="mt-2 text-xs font-semibold text-amber-700">Some geographic area checks could not complete, so this run may have partial coverage.</p>
          ) : null}
        </section>
      ) : null}

      {run.crmMatches.length ? <>
        <MatchGroup title="Confirmed matches" matches={confirmed} requestedYear={run.criteria?.year ?? null} onOpenProfile={onOpenProfile} onUseContext={onUseContext} />
        <MatchGroup title="Likely recurring" description="These fit the seasonal history, but the requested-year date is not confirmed in Command Center." matches={recurring} requestedYear={run.criteria?.year ?? null} onOpenProfile={onOpenProfile} onUseContext={onUseContext} />
        <MatchGroup title="Other useful matches" matches={other} requestedYear={run.criteria?.year ?? null} onOpenProfile={onOpenProfile} onUseContext={onUseContext} />
      </> : <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">I did not find a strong existing Command Center match for those criteria.</p>}

      {webStarted ? <LeadScoutProgress run={run} onStop={onStopSearch} onContinue={onContinueSearch} /> : null}

      {visibleCandidates.length ? (
        <section className="grid gap-2">
          <div>
            <h3 className="font-bold text-slate-950">Scout Results</h3>
            <p className="mt-0.5 text-xs text-slate-500">These are temporary Scout results. They are not saved in Command Center until you create a profile.</p>
          </div>
          {visibleCandidates.map((candidate) => (
            <LeadScoutCandidateCard
              candidate={candidate}
              sources={run.sources}
              canDismiss={canReview}
              canSave={canReview && Boolean(onSaveCandidate)}
              key={candidate.id}
              onResearchDeeper={onResearchDeeper}
              onNotFit={onNotFit}
              onSaveAsLead={setSaveCandidateId}
              onScoutAround={onScoutAroundCandidate}
            />
          ))}
        </section>
      ) : run.candidates.some((candidate) => candidate.reviewStatus === "dismissed") ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">No Scout Results remain in this review. Results marked Not a fit stay dismissed in this Scout run.</p>
      ) : null}

      {run.status === "crm_ready" ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="font-semibold text-slate-950">Need more options?</p>
          <p className="mt-1 text-sm text-slate-600">{webScoutAvailable ? "Start Scout Search to check public event sources for new opportunities using the same criteria above." : "Scout Search is not enabled yet in this release. Your search criteria have been saved."}</p>
          <button className="button-secondary mt-3" disabled={!webScoutAvailable} onClick={onFindNewLeads} type="button">Start Scout Search</button>
        </section>
      ) : null}

      {selectedCandidate && onSaveCandidate ? (
        <LeadScoutSaveDialog
          candidate={selectedCandidate}
          onClose={() => setSaveCandidateId(null)}
          onSave={(input) => onSaveCandidate(selectedCandidate.id, input)}
        />
      ) : null}
    </div>
  );
}