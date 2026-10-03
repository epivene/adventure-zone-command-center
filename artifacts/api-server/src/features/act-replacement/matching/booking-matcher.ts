import { normalizeMatchingText } from "@/features/act-migration/matching-normalization";
import type { Opportunity } from "../normalizers/opportunity-normalizer";
import { resolveContextClues, type ContextClueEvidence } from "./context-clue-resolver";
import { externalLinkCandidates, type ExternalLink, type ManualAssignment, type MatchResult, uniqueSorted } from "./match-result";

export type BookingMatchSource = Opportunity & {
  sourceRecordId: string;
  externalLinks?: readonly (ExternalLink & { sourceRecordId?: string | null })[];
  manualAssignment?: ManualAssignment | null;
};

export type LocalBookingCandidate = {
  id: string;
  name: string;
  organizationId: string | null;
  venueName?: string | null;
  address1?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  localStatus?: string | null;
  localProbability?: string | null;
  notes?: string | null;
};

function day(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match?.[1] ?? null;
}

export function matchBooking(
  source: BookingMatchSource,
  locals: readonly LocalBookingCandidate[],
  organizationMatch: MatchResult,
  context: { sourceDatabaseKey?: string | null; sourceEntityType?: string | null; sourceActRecordId?: string | null } = {},
): MatchResult {
  if (source.manualAssignment?.active !== false && source.manualAssignment?.localId) {
    return { kind: "exact", localId: source.manualAssignment.localId, reason: "manual_assignment" };
  }
  const linked = externalLinkCandidates({ sourceRecordId: source.sourceRecordId, targetEntityType: "booking", ...context }, source.externalLinks);
  if (linked.length === 1) return { kind: "exact", localId: linked[0]!, reason: "exact_external_link" };
  if (linked.length > 1) return { kind: "ambiguous", candidateIds: linked, reason: "multiple_exact_external_links" };
  if (organizationMatch.kind !== "exact") return { kind: "none", reason: "organization_match_not_exact" };
  const sourceName = normalizeMatchingText(source.name);
  const sourceDay = day(source.startsAt);
  if (!sourceName) return { kind: "none", reason: "booking_name_or_date_missing" };
  if (!sourceDay) {
    const possible = uniqueSorted(locals.filter(candidate => candidate.organizationId === organizationMatch.localId && normalizeMatchingText(candidate.name) === sourceName).map(candidate => candidate.id));
    return possible.length
      ? { kind: "ambiguous", candidateIds: possible, reason: "booking_event_date_unverified" }
      : { kind: "none", reason: "booking_name_or_date_missing" };
  }
  const evidenceByCandidate = locals
    .filter((candidate) => candidate.organizationId === organizationMatch.localId)
    .map((candidate) => {
      const evidence: ContextClueEvidence[] = [{
        family: "archive_relationship",
        label: "matched organization",
        targetEntityType: "booking",
        targetEntityId: candidate.id,
        authority: "supporting",
      }];
      if (normalizeMatchingText(candidate.name) === sourceName) evidence.push({
        family: "identity",
        label: "matching booking name",
        targetEntityType: "booking",
        targetEntityId: candidate.id,
        authority: "supporting",
      });
      if (day(candidate.startsAt) === sourceDay) evidence.push({
        family: "event_context",
        label: "matching event date",
        targetEntityType: "booking",
        targetEntityId: candidate.id,
        authority: "supporting",
      });
      return { candidate, evidence };
    });
  const exactEvidence = evidenceByCandidate
    .filter(({ evidence }) => evidence.length === 3)
    .flatMap(({ evidence }) => evidence);
  const resolution = resolveContextClues(exactEvidence);
  if (resolution.kind === "resolved") {
    return {
      kind: "exact",
      localId: resolution.targetEntityId,
      reason: "two_independent_context_clues",
      evidence: resolution.evidence,
    };
  }
  if (resolution.kind === "ambiguous") {
    return {
      kind: "ambiguous",
      candidateIds: resolution.candidateIds,
      reason: "multiple_compatible_booking_candidates",
      evidence: resolution.evidence,
    };
  }
  const partial = evidenceByCandidate.filter(({ evidence }) => evidence.length >= 2);
  if (partial.length > 0) return {
    kind: "ambiguous",
    candidateIds: uniqueSorted(partial.map(({ candidate }) => candidate.id)),
    reason: "conflicting_booking_context",
    evidence: partial.flatMap(({ evidence }) => evidence),
  };
  return { kind: "none", reason: "no_compatible_booking_date" };
}
