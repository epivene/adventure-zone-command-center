import { isSharedMailboxEmail, normalizeMatchingEmail, normalizeMatchingText } from "@/features/act-migration/matching-normalization";
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
  if (linked.length === 1) return { kind: "exact", localId: linked[0]!, reason: "exact_external_link" };
  if (linked.length > 1) return { kind: "ambiguous", candidateIds: linked, reason: "multiple_exact_external_links" };
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
  if (emailIds.length === 1) return { kind: "exact", localId: emailIds[0]!, reason: "unique_normalized_email" };
  if (phoneIds.length === 1) return { kind: "exact", localId: phoneIds[0]!, reason: "unique_normalized_phone" };

  const name = fullName(source);
  const names = name ? locals.filter((candidate) => fullName(candidate) === name).map((candidate) => candidate.id) : [];
  if (names.length) return { kind: "ambiguous", candidateIds: uniqueSorted(names), reason: "name_only_match_requires_review" };
  return { kind: "none", reason: safeEmail || sourcePhone ? "no_unique_contact_identity" : "no_safe_contact_identity" };
}
