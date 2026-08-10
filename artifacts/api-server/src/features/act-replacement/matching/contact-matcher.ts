import { isSharedMailboxEmail, normalizeMatchingEmail, normalizeMatchingText } from "@/features/act-migration/matching-normalization";
import {
  resolveContextClues,
  type ContextClueEvidence,
} from "./context-clue-resolver";
import { externalLinkCandidates, type ExternalLink, type ManualAssignment, type MatchResult, uniqueSorted } from "./match-result";

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
  const linked = externalLinkCandidates({ sourceRecordId: source.sourceRecordId, targetEntityType: "contact", ...context }, source.externalLinks);
  if (linked.length > 1) return { kind: "ambiguous", candidateIds: linked, reason: "multiple_exact_external_links" };
  const linkedId = linked[0];
  const safeEmail = source.emailIdentityMatchSafe && !isSharedMailboxEmail(source.email)
    ? normalizeMatchingEmail(source.email)
    : null;
  const sourcePhone = phone(source.phone);
  const byEmail = safeEmail
    ? locals.filter((candidate) => normalizeMatchingEmail(candidate.email ?? null) === safeEmail).map((candidate) => candidate.id)
    : [];
  const byPhone = sourcePhone
    ? locals.filter((candidate) => phone(candidate.phone) === sourcePhone).map((candidate) => candidate.id)
    : [];
  const emailIds = uniqueSorted(byEmail);
  const phoneIds = uniqueSorted(byPhone);
  if (emailIds.length > 1) return { kind: "ambiguous", candidateIds: emailIds, reason: "multiple_normalized_email_candidates" };
  if (phoneIds.length > 1) return { kind: "ambiguous", candidateIds: phoneIds, reason: "multiple_normalized_phone_candidates" };
  if (emailIds.length === 1 && phoneIds.length === 1 && emailIds[0] !== phoneIds[0]) {
    return { kind: "ambiguous", candidateIds: uniqueSorted([...emailIds, ...phoneIds]), reason: "conflicting_contact_identity" };
  }
  const name = fullName(source);
  const linkedCandidate = linkedId
    ? locals.find((candidate) => candidate.id === linkedId)
    : undefined;
  if (linkedCandidate) {
    const linkedName = fullName(linkedCandidate);
    const linkedEmail = normalizeMatchingEmail(linkedCandidate.email ?? null);
    const linkedPhone = phone(linkedCandidate.phone);
    const linkedFieldsConflict = Boolean(
      (name && linkedName && name !== linkedName)
      || (safeEmail && linkedEmail && safeEmail !== linkedEmail)
      || (sourcePhone && linkedPhone && sourcePhone !== linkedPhone),
    );
    if (linkedFieldsConflict) {
      return {
        kind: "ambiguous",
        candidateIds: [linkedId],
        reason: "conflicting_contact_fields",
      };
    }
  }
  const clues: ContextClueEvidence[] = [];
  for (const candidate of locals) {
    if (name && fullName(candidate) === name) {
      clues.push({
        family: "identity",
        label: "contact name agrees",
        targetEntityType: "contact",
        targetEntityId: candidate.id,
        authority: "supporting",
      });
    }
    if (emailIds.length === 1 && emailIds[0] === candidate.id) {
      clues.push({
        family: "direct_contact",
        label: "email agrees",
        targetEntityType: "contact",
        targetEntityId: candidate.id,
        authority: "supporting",
      });
    }
    if (phoneIds.length === 1 && phoneIds[0] === candidate.id) {
      clues.push({
        family: "direct_contact",
        label: "phone agrees",
        targetEntityType: "contact",
        targetEntityId: candidate.id,
        authority: "supporting",
      });
    }
    if (
      source.resolvedOrganizationId &&
      candidate.organizationIds?.includes(source.resolvedOrganizationId)
    ) {
      clues.push({
        family: "archive_relationship",
        label: "organization relationship agrees",
        targetEntityType: "contact",
        targetEntityId: candidate.id,
        authority: "supporting",
      });
    }
  }
  if (linkedId) {
    if (clues.length === 0) {
      return { kind: "exact", localId: linkedId, reason: "exact_external_link" };
    }
    const resolution = resolveContextClues([{
      family: "identity",
      label: "exact external link",
      targetEntityType: "contact",
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
      ...resolution,
      reason: onlyIdentity
        ? "insufficient_independent_context_clues"
        : resolution.reason,
    };
  }
  const candidateIds = uniqueSorted(clues.map((clue) => clue.targetEntityId));
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
