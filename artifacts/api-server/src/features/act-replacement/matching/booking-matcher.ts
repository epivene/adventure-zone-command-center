import { normalizeMatchingText } from "@/features/act-migration/matching-normalization";
import type { Opportunity } from "../normalizers/opportunity-normalizer";
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
  if (!sourceName || !sourceDay) return { kind: "none", reason: "booking_name_or_date_missing" };
  const candidates = locals.filter((candidate) =>
    candidate.organizationId === organizationMatch.localId &&
    normalizeMatchingText(candidate.name) === sourceName &&
    day(candidate.startsAt) === sourceDay,
  );
  const ids = uniqueSorted(candidates.map((candidate) => candidate.id));
  if (ids.length === 1) return { kind: "exact", localId: ids[0]!, reason: "exact_organization_name_date" };
  if (ids.length > 1) return { kind: "ambiguous", candidateIds: ids, reason: "multiple_compatible_booking_candidates" };
  return { kind: "none", reason: "no_compatible_booking_date" };
}
