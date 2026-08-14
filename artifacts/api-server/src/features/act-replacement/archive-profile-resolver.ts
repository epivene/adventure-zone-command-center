import { normalizeCompany } from "./normalizers/company-normalizer";
import { normalizeContact } from "./normalizers/contact-normalizer";
import {
  normalizeMatchingEmail,
  normalizeMatchingText,
} from "@/features/act-migration/matching-normalization";
import type {
  ArchiveProfileAiProjection,
  ArchiveProfileResolution,
  ArchiveProfileSource,
  ProfileCandidate,
} from "./archive-profile-import-types";

type WritableValues = Record<string, string | null>;
type ExactCandidate = { candidate: ProfileCandidate; signals: string[] };

const diagnosticFields = new Set(["kind", "emailIdentityMatchSafe"]);

const organizationFields = [
  "name",
  "phone",
  "website",
  "industry",
  "address1",
  "address2",
  "city",
  "region",
  "postalCode",
] as const;

const contactFields = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "jobTitle",
  "address1",
  "address2",
  "city",
  "region",
  "postalCode",
] as const;

export function sourceWins<T extends Record<string, unknown>>(
  current: T,
  source: Partial<T>,
): Partial<T> {
  const result = Object.fromEntries(
    Object.entries(current).filter(([field]) => !diagnosticFields.has(field)),
  ) as Partial<T>;
  for (const [field, value] of Object.entries(source)) {
    if (diagnosticFields.has(field) || value == null || (typeof value === "string" && !value.trim())) {
      continue;
    }
    (result as Record<string, unknown>)[field] = value;
  }
  return result;
}

export function resolveArchiveProfile(input: {
  source: ArchiveProfileSource;
  candidates: readonly ProfileCandidate[];
  linkedTarget: ProfileCandidate | null;
}): ArchiveProfileResolution {
  if (!input.source.actRecordId?.trim()) {
    return {
      action: "preserve",
      reasonCode: "missing_act_record_id",
      evidenceLabels: ["missing_act_record_id"],
    };
  }

  if (input.linkedTarget) {
    return {
      action: "already_imported",
      targetEntityType: input.linkedTarget.entityType,
      targetEntityId: input.linkedTarget.id,
      values: input.linkedTarget.values,
      evidenceLabels: ["source_link"],
    };
  }

  const normalized = input.source.streamType === "company"
    ? normalizeCompany(input.source.rawSnapshot)
    : normalizeContact(input.source.rawSnapshot);

  if (!normalized.ok && normalized.issueCode === "invalid_source_record") {
    return {
      action: "preserve",
      reasonCode: "invalid_source_record",
      evidenceLabels: labels(normalized.warnings, ["invalid_source_record"]),
    };
  }

  const values = input.source.streamType === "company"
    ? pickWritable(normalized.ok ? normalized.value : normalized.partial, organizationFields)
    : pickWritable(normalized.ok ? normalized.value : normalized.partial, contactFields);
  const normalizationLabels = normalized.warnings;

  const candidates = input.candidates.filter((candidate) =>
    candidate.entityType === targetEntityType(input.source.streamType),
  );
  const sourceValues = normalized.ok ? normalized.value : normalized.partial;
  const exact = candidates
    .map((candidate) => ({
      candidate,
      signals: usableExactSignals(candidate, candidates, input.source.streamType, sourceValues),
    }))
    .filter((candidate): candidate is ExactCandidate => candidate.signals.length > 0);
  if (exact.length === 1) return updateOrLink(exact[0]!, values, normalizationLabels);
  const hasRequiredIdentity = hasRequiredArchiveProfileIdentity(input.source.streamType, values);
  if (exact.length > 1 && hasRequiredIdentity) {
    return createProfile(input.source.streamType, values, labels(normalizationLabels, ["ambiguous_exact_match"]));
  }
  if (hasRequiredIdentity) {
    return createProfile(input.source.streamType, values, labels(normalizationLabels, ["no_exact_match"]));
  }
  const ambiguityLabels = candidates.length > 1 ? ["ambiguous_exact_match"] : [];
  return {
    action: "needs_ai",
    projection: aiProjection(input.source, values, normalizationLabels),
    evidenceLabels: labels(normalizationLabels, ambiguityLabels, ["missing_required_identity"]),
  };
}

function pickWritable(
  normalized: Record<string, unknown>,
  fields: readonly string[],
): WritableValues {
  return Object.fromEntries(fields.map((field) => [field, stringOrNull(normalized[field])]));
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function usableExactSignals(
  candidate: ProfileCandidate,
  candidates: readonly ProfileCandidate[],
  streamType: ArchiveProfileSource["streamType"],
  normalized: Record<string, unknown>,
): string[] {
  if (streamType === "contact") {
    return [
      ...(candidate.exactSignals.includes("email") && contactEmailMatches(normalized, candidate) ? ["email"] : []),
      ...(candidate.exactSignals.includes("phone_and_name") && contactPhoneAndNameMatches(normalized, candidate) ? ["phone_and_name"] : []),
    ];
  }
  return candidate.exactSignals.includes("company_name_and_location") &&
    companyNameAndLocationMatches(normalized, candidate, candidates)
    ? ["company_name_and_location"]
    : [];
}

function updateOrLink(
  exact: ExactCandidate,
  sourceValues: WritableValues,
  normalizationLabels: readonly string[],
): ArchiveProfileResolution {
  const { candidate } = exact;
  const values = sourceWins(candidate.values, sourceValues) as WritableValues;
  return {
    action: valuesChanged(candidate.values, values) ? "update_existing" : "link_existing",
    targetEntityType: candidate.entityType,
    targetEntityId: candidate.id,
    values,
    evidenceLabels: labels(normalizationLabels, exact.signals),
  };
}

function contactEmailMatches(source: Record<string, unknown>, candidate: ProfileCandidate): boolean {
  const sourceEmail = normalizeMatchingEmail(stringOrNull(source.email));
  const candidateEmail = normalizeMatchingEmail(candidate.values.email ?? null);
  return source.emailIdentityMatchSafe === true && sourceEmail !== null && sourceEmail === candidateEmail;
}

function contactPhoneAndNameMatches(source: Record<string, unknown>, candidate: ProfileCandidate): boolean {
  const sourcePhone = normalizedPhone(stringOrNull(source.phone));
  const candidatePhone = normalizedPhone(candidate.values.phone ?? null);
  const sourceFirstName = normalizeMatchingText(stringOrNull(source.firstName));
  const sourceLastName = normalizeMatchingText(stringOrNull(source.lastName));
  return sourcePhone !== null && sourcePhone === candidatePhone &&
    sourceFirstName !== null && sourceFirstName === normalizeMatchingText(candidate.values.firstName ?? null) &&
    sourceLastName !== null && sourceLastName === normalizeMatchingText(candidate.values.lastName ?? null);
}

function companyNameAndLocationMatches(
  source: Record<string, unknown>,
  candidate: ProfileCandidate,
  candidates: readonly ProfileCandidate[],
): boolean {
  const sourceName = normalizeMatchingText(stringOrNull(source.name));
  if (sourceName === null || sourceName !== normalizeMatchingText(candidate.values.name ?? null)) return false;

  const sourceCity = normalizeMatchingText(stringOrNull(source.city));
  const sourceRegion = normalizeMatchingText(stringOrNull(source.region));
  if (sourceCity !== null || sourceRegion !== null) {
    return sourceCity === normalizeMatchingText(candidate.values.city ?? null) &&
      sourceRegion === normalizeMatchingText(candidate.values.region ?? null);
  }
  return candidates.filter((other) =>
    normalizeMatchingText(other.values.name ?? null) === sourceName,
  ).length === 1;
}

function normalizedPhone(value: string | null): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

function valuesChanged(current: WritableValues, next: WritableValues): boolean {
  const fields = new Set([...Object.keys(current), ...Object.keys(next)]);
  return [...fields].some((field) => current[field] !== next[field]);
}

function createProfile(
  streamType: ArchiveProfileSource["streamType"],
  values: WritableValues,
  evidenceLabels: string[],
): ArchiveProfileResolution {
  return {
    action: "create_profile",
    targetEntityType: targetEntityType(streamType),
    values,
    evidenceLabels,
  };
}

function targetEntityType(streamType: ArchiveProfileSource["streamType"]): "organization" | "contact" {
  return streamType === "company" ? "organization" : "contact";
}

export function hasRequiredArchiveProfileIdentity(
  streamType: ArchiveProfileSource["streamType"],
  values: Readonly<Record<string, string | null | undefined>>,
): boolean {
  return streamType === "company"
    ? isPresent(values.name)
    : isPresent(values.firstName) && isPresent(values.lastName);
}

function isPresent(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function aiProjection(
  source: ArchiveProfileSource,
  supportedFields: WritableValues,
  contextLabels: readonly string[],
): ArchiveProfileAiProjection {
  return {
    sourceRecordId: source.sourceRecordId,
    streamType: source.streamType,
    supportedFields,
    contextLabels: [...contextLabels],
  };
}

function labels(...groups: readonly (readonly string[])[]): string[] {
  return [...new Set(groups.flat())].sort();
}
