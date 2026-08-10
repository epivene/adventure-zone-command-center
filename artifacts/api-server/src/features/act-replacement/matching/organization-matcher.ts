import { normalizeMatchingText, normalizeWebsiteHost } from "@/features/act-migration/matching-normalization";
import {
  resolveContextClues,
  type ContextClueEvidence,
} from "./context-clue-resolver";
import { externalLinkCandidates, type ExternalLink, type ManualAssignment, type MatchResult, uniqueSorted } from "./match-result";

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
  industry?: string | null;
  address1?: string | null;
  address2?: string | null;
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
  context: { sourceDatabaseKey?: string | null; sourceEntityType?: string | null; sourceActRecordId?: string | null } = {},
): MatchResult {
  if (source.manualAssignment?.active !== false && source.manualAssignment?.localId) {
    return { kind: "exact", localId: source.manualAssignment.localId, reason: "manual_assignment" };
  }
  const linked = externalLinkCandidates({ sourceRecordId: source.sourceRecordId, targetEntityType: "organization", ...context }, source.externalLinks);
  if (linked.length > 1) return { kind: "ambiguous", candidateIds: linked, reason: "multiple_exact_external_links" };
  const linkedId = linked[0];
  const expected = normalized(source);
  const clues: ContextClueEvidence[] = [];
  const conflicting: string[] = [];
  for (const candidate of locals) {
    const actual = normalized(candidate);
    const fields: Array<{
      family: ContextClueEvidence["family"];
      label: string;
      provided: boolean;
      agrees: boolean;
    }> = [
      { family: "identity", label: "organization name agrees", provided: expected.name !== null && actual.name !== null, agrees: expected.name === actual.name },
      { family: "location", label: "city and region agree", provided: expected.city !== null && expected.region !== null && actual.city !== null && actual.region !== null, agrees: expected.city === actual.city && expected.region === actual.region },
      { family: "direct_contact", label: "phone agrees", provided: expected.phone !== null && actual.phone !== null, agrees: expected.phone === actual.phone },
      { family: "web_identity", label: "website agrees", provided: expected.website !== null && actual.website !== null, agrees: expected.website === actual.website },
      { family: "location", label: "street address and postal code agree", provided: expected.address1 !== null && expected.postalCode !== null && actual.address1 !== null && actual.postalCode !== null, agrees: expected.address1 === actual.address1 && expected.postalCode === actual.postalCode },
    ];
    const conflicts = fields.some((field) => field.provided && !field.agrees);
    const agreements = fields.filter((field) => field.provided && field.agrees);
    if ((agreements.length || candidate.id === linkedId) && conflicts) conflicting.push(candidate.id);
    if (!conflicts) {
      for (const agreement of agreements) {
        clues.push({
          family: agreement.family,
          label: agreement.label,
          targetEntityType: "organization",
          targetEntityId: candidate.id,
          authority: "supporting",
        });
      }
    }
  }
  if (linkedId) {
    if (conflicting.length > 0) {
      return {
        kind: "ambiguous",
        candidateIds: uniqueSorted([linkedId, ...conflicting]),
        reason: "conflicting_organization_fields",
      };
    }
    if (clues.length === 0) {
      return { kind: "exact", localId: linkedId, reason: "exact_external_link" };
    }
    const resolution = resolveContextClues([{
      family: "identity",
      label: "exact external link",
      targetEntityType: "organization",
      targetEntityId: linkedId,
      authority: "authoritative",
    }, ...clues]);
    if (resolution.kind === "resolved" && resolution.targetEntityId === linkedId) {
      return {
        kind: "exact",
        localId: linkedId,
        reason: "exact_external_link",
        evidence: resolution.evidence,
        ...(resolution.evidenceTruncated ? { evidenceTruncated: true } : {}),
      };
    }
    return {
      kind: "ambiguous",
      candidateIds: uniqueSorted(resolution.kind === "resolved"
        ? [linkedId, resolution.targetEntityId]
        : resolution.kind === "ambiguous"
          ? resolution.candidateIds
          : [linkedId, ...clues.map((clue) => clue.targetEntityId)]),
      reason: "conflicting_context_clues",
      evidence: resolution.evidence,
      ...(resolution.evidenceTruncated ? { evidenceTruncated: true } : {}),
    };
  }
  const resolution = resolveContextClues(clues);
  if (resolution.kind === "resolved" && conflicting.length === 0) {
    return {
      kind: "exact",
      localId: resolution.targetEntityId,
      reason: resolution.reason,
      evidence: resolution.evidence,
    };
  }
  if (resolution.kind === "resolved" || resolution.kind === "ambiguous") {
    return {
      kind: "ambiguous",
      candidateIds: uniqueSorted([
        ...(resolution.kind === "resolved"
          ? [resolution.targetEntityId]
          : resolution.candidateIds),
        ...conflicting,
      ]),
      reason: conflicting.length
        ? "conflicting_organization_fields"
        : resolution.evidence.every((clue) => clue.family === "identity")
          ? "insufficient_independent_context_clues"
          : resolution.reason,
      evidence: resolution.evidence,
    };
  }
  if (conflicting.length) return { kind: "none", reason: "conflicting_organization_fields" };
  const candidateIds = uniqueSorted(clues.map((clue) => clue.targetEntityId));
  if (candidateIds.length) return { kind: "ambiguous", candidateIds, reason: resolution.reason, evidence: resolution.evidence };
  return { kind: "none", reason: "conflicting_organization_fields" };
}
