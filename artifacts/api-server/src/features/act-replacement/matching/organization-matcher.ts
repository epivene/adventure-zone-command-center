import { normalizeMatchingText, normalizeWebsiteHost } from "@/features/act-migration/matching-normalization";
import { externalLinkCandidates, externalLinkReviewCandidates, type ExternalLink, type ManualAssignment, type MatchResult, uniqueSorted } from "./match-result";

export type OrganizationMatchSource = {
  sourceRecordId: string;
  name: string;
  phone: string | null;
  website: string | null;
  industry?: string | null;
  address1: string | null;
  address2?: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  externalLinks?: readonly (ExternalLink & { sourceRecordId?: string | null })[];
  manualAssignment?: ManualAssignment | null;
};

export type LocalOrganizationCandidate = {
  id: string;
  name: string;
  phone?: string | null;
  website?: string | null;
  address1?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
};

function phone(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

function normalized(source: OrganizationMatchSource | LocalOrganizationCandidate) {
  return {
    name: normalizeMatchingText(source.name),
    city: normalizeMatchingText(source.city ?? null),
    region: normalizeMatchingText(source.region ?? null),
    phone: phone(source.phone),
    website: normalizeWebsiteHost(source.website ?? null),
    address1: normalizeMatchingText(source.address1 ?? null),
    postalCode: normalizeMatchingText(source.postalCode ?? null),
  };
}

export function matchOrganization(
  source: OrganizationMatchSource,
  locals: readonly LocalOrganizationCandidate[],
  context: { sourceDatabaseKey?: string | null } = {},
): MatchResult {
  if (source.manualAssignment?.active !== false && source.manualAssignment?.localId) {
    return { kind: "exact", localId: source.manualAssignment.localId, reason: "manual_assignment" };
  }
  const linked = externalLinkCandidates(source.sourceRecordId, source.externalLinks, context.sourceDatabaseKey);
  if (linked.length === 1) return { kind: "exact", localId: linked[0]!, reason: "exact_external_link" };
  if (linked.length > 1) return { kind: "ambiguous", candidateIds: linked, reason: "multiple_exact_external_links" };
  const reviewLinks = externalLinkReviewCandidates(source.sourceRecordId, source.externalLinks, context.sourceDatabaseKey);
  if (reviewLinks.length) return { kind: "ambiguous", candidateIds: reviewLinks, reason: "external_link_requires_review" };

  const expected = normalized(source);
  const eligible: string[] = [];
  const nameOnly: string[] = [];
  const conflicting: string[] = [];
  for (const candidate of locals) {
    const actual = normalized(candidate);
    const fields = [
      { provided: expected.name !== null && actual.name !== null, agrees: expected.name === actual.name },
      { provided: expected.city !== null && expected.region !== null && actual.city !== null && actual.region !== null, agrees: expected.city === actual.city && expected.region === actual.region },
      { provided: expected.phone !== null && actual.phone !== null, agrees: expected.phone === actual.phone },
      { provided: expected.website !== null && actual.website !== null, agrees: expected.website === actual.website },
      { provided: expected.address1 !== null && expected.postalCode !== null && actual.address1 !== null && actual.postalCode !== null, agrees: expected.address1 === actual.address1 && expected.postalCode === actual.postalCode },
    ];
    const conflicts = fields.some((field) => field.provided && !field.agrees);
    const agreements = fields.filter((field) => field.provided && field.agrees);
    if (agreements.length >= 2 && !conflicts) eligible.push(candidate.id);
    if (expected.name !== null && expected.name === actual.name) {
      if (conflicts) conflicting.push(candidate.id);
      else nameOnly.push(candidate.id);
    }
  }
  const ids = uniqueSorted(eligible);
  if (ids.length === 1) return { kind: "exact", localId: ids[0]!, reason: "two_strong_organization_fields" };
  if (ids.length > 1) return { kind: "ambiguous", candidateIds: ids, reason: "multiple_strong_organization_candidates" };
  if (conflicting.length) return { kind: "none", reason: "conflicting_organization_fields" };
  const names = uniqueSorted(nameOnly);
  if (names.length) return { kind: "ambiguous", candidateIds: names, reason: "insufficient_agreeing_organization_fields" };
  return { kind: "none", reason: "conflicting_organization_fields" };
}
