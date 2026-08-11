import { isSharedMailboxEmail, normalizeMatchingEmail, normalizeMatchingText } from "@/features/act-migration/matching-normalization";
import {
  resolveContextClues,
  type ContextClueEvidence,
} from "./context-clue-resolver";
import {
  boundedUniqueSorted,
  BoundedCollection,
  BoundedIdSet,
  externalLinkCandidateSet,
  type ExternalLink,
  type ManualAssignment,
  type MatchResult,
  uniqueSorted,
} from "./match-result";

export type ContactMatchSource = {
  sourceRecordId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  emailIdentityMatchSafe: boolean;
  phone: string | null;
  jobTitle?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  resolvedOrganizationId?: string | null;
  externalLinks?: readonly (ExternalLink & { sourceRecordId?: string | null })[];
  manualAssignment?: ManualAssignment | null;
};

export type LocalContactCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  organizationIds?: readonly string[];
};

function phone(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

function fullName(value: { firstName: string; lastName: string }): string | null {
  return normalizeMatchingText(`${value.firstName} ${value.lastName}`);
}

export function matchContact(
  source: ContactMatchSource,
  locals: readonly LocalContactCandidate[],
  context: { sourceDatabaseKey?: string | null; sourceEntityType?: string | null; sourceActRecordId?: string | null } = {},
): MatchResult {
  if (source.manualAssignment?.active !== false && source.manualAssignment?.localId) {
    return { kind: "exact", localId: source.manualAssignment.localId, reason: "manual_assignment" };
  }
  const linked = externalLinkCandidateSet({ sourceRecordId: source.sourceRecordId, targetEntityType: "contact", ...context }, source.externalLinks);
  if (linked.overflow) return { kind: "ambiguous", candidateIds: linked.values, reason: "candidate_limit_exceeded", overflow: true };
  if (linked.values.length === 1) return { kind: "exact", localId: linked.values[0]!, reason: "exact_external_link" };
  if (linked.values.length > 1) return { kind: "ambiguous", candidateIds: linked.values, reason: "multiple_exact_external_links" };
  const sourceEmail = normalizeMatchingEmail(source.email);
  const safeEmail = source.emailIdentityMatchSafe && !isSharedMailboxEmail(source.email)
    ? sourceEmail
    : null;
  const sourcePhone = phone(source.phone);
  const byEmail = new BoundedIdSet();
  const byPhone = new BoundedIdSet();
  for (const candidate of locals) {
    if (safeEmail && normalizeMatchingEmail(candidate.email ?? null) === safeEmail) {
      byEmail.add(candidate.id);
    }
    if (sourcePhone && phone(candidate.phone) === sourcePhone) {
      byPhone.add(candidate.id);
    }
  }
  const emailIds = byEmail.values();
  const phoneIds = byPhone.values();
  if (byEmail.overflow || byPhone.overflow) {
    return {
      kind: "ambiguous",
      candidateIds: boundedUniqueSorted([...emailIds, ...phoneIds]).values,
      reason: "candidate_limit_exceeded",
      overflow: true,
    };
  }
  if (emailIds.length > 1) return { kind: "ambiguous", candidateIds: emailIds, reason: "multiple_normalized_email_candidates" };
  if (phoneIds.length > 1) return { kind: "ambiguous", candidateIds: phoneIds, reason: "multiple_normalized_phone_candidates" };
  if (emailIds.length === 1 && phoneIds.length === 1 && emailIds[0] !== phoneIds[0]) {
    return { kind: "ambiguous", candidateIds: uniqueSorted([...emailIds, ...phoneIds]), reason: "conflicting_contact_identity" };
  }
  const name = fullName(source);
  const clues = new BoundedCollection<ContextClueEvidence>((clue) =>
    `${clue.targetEntityType}\u0000${clue.targetEntityId}\u0000${clue.family}\u0000${clue.authority}\u0000${clue.label}`
  );
  const conflicting = new BoundedIdSet();
  for (const candidate of locals) {
    const nameAgrees = Boolean(name && fullName(candidate) === name);
    const emailAgrees = emailIds.length === 1 && emailIds[0] === candidate.id;
    const phoneAgrees = phoneIds.length === 1 && phoneIds[0] === candidate.id;
    const organizationAgrees = Boolean(
      source.resolvedOrganizationId &&
      candidate.organizationIds?.includes(source.resolvedOrganizationId),
    );
    const candidateEmail = normalizeMatchingEmail(candidate.email ?? null);
    const candidatePhone = phone(candidate.phone);
    const directConflict = Boolean(
      (sourceEmail && candidateEmail && sourceEmail !== candidateEmail) ||
      (sourcePhone && candidatePhone && sourcePhone !== candidatePhone),
    );
    if (
      directConflict &&
      (nameAgrees || emailAgrees || phoneAgrees || organizationAgrees)
    ) {
      conflicting.add(candidate.id);
      continue;
    }
    if (nameAgrees) {
      clues.add({
        family: "identity",
        label: "contact name agrees",
        targetEntityType: "contact",
        targetEntityId: candidate.id,
        authority: "supporting",
      });
    }
    if (emailAgrees) {
      clues.add({
        family: "direct_contact",
        label: "email agrees",
        targetEntityType: "contact",
        targetEntityId: candidate.id,
        authority: "supporting",
      });
    }
    if (phoneAgrees) {
      clues.add({
        family: "direct_contact",
        label: "phone agrees",
        targetEntityType: "contact",
        targetEntityId: candidate.id,
        authority: "supporting",
      });
    }
    if (
      organizationAgrees
    ) {
      clues.add({
        family: "archive_relationship",
        label: "organization relationship agrees",
        targetEntityType: "contact",
        targetEntityId: candidate.id,
        authority: "supporting",
      });
    }
  }
  const boundedClues = clues.values();
  const conflictingIds = conflicting.values();
  if (clues.overflow || conflicting.overflow) {
    return {
      kind: "ambiguous",
      candidateIds: boundedUniqueSorted([
        ...boundedClues.map((clue) => clue.targetEntityId),
        ...conflictingIds,
      ]).values,
      reason: "candidate_limit_exceeded",
      evidence: boundedClues,
      overflow: true,
    };
  }
  const familiesByTarget = new Map<string, Set<ContextClueEvidence["family"]>>();
  for (const clue of boundedClues) {
    const families = familiesByTarget.get(clue.targetEntityId) ?? new Set();
    families.add(clue.family);
    familiesByTarget.set(clue.targetEntityId, families);
  }
  const qualifiedIds = uniqueSorted(
    [...familiesByTarget]
      .filter(([, families]) => families.size >= 2)
      .map(([targetEntityId]) => targetEntityId),
  );
  const resolutionClues = qualifiedIds.length === 1 && [...familiesByTarget]
    .filter(([targetEntityId]) => targetEntityId !== qualifiedIds[0])
    .every(([, families]) => [...families].every((family) => family === "identity"))
    ? boundedClues.filter((clue) => clue.targetEntityId === qualifiedIds[0])
    : boundedClues;
  const resolution = resolveContextClues(resolutionClues);
  if (resolution.kind === "resolved") {
    return {
      kind: "exact",
      localId: resolution.targetEntityId,
      reason: resolution.reason,
      evidence: resolution.evidence,
    };
  }
  if (resolution.kind === "ambiguous") {
    const onlyIdentity = resolution.evidence.every((clue) => clue.family === "identity");
    return {
      kind: "ambiguous",
      candidateIds: uniqueSorted([...resolution.candidateIds, ...conflictingIds]),
      reason: conflictingIds.length
        ? "conflicting_contact_fields"
        : onlyIdentity
        ? "insufficient_independent_context_clues"
        : resolution.reason,
      evidence: resolution.evidence,
    };
  }
  if (conflictingIds.length) {
    return {
      kind: "ambiguous",
      candidateIds: conflictingIds,
      reason: "conflicting_contact_fields",
      evidence: resolution.evidence,
    };
  }
  const candidateIds = uniqueSorted(boundedClues.map((clue) => clue.targetEntityId));
  if (candidateIds.length) {
    return {
      kind: "ambiguous",
      candidateIds,
      reason: resolution.reason,
      evidence: resolution.evidence,
    };
  }
  return { kind: "none", reason: safeEmail || sourcePhone ? "no_unique_contact_identity" : "no_safe_contact_identity" };
}
