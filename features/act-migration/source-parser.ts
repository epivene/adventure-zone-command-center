import { createHash } from "node:crypto";

import {
  type ActMigrationStreamType,
  type ActRelationshipType,
  type ActSourceEntityType,
  relationshipSourceKey,
  sourceRecordKey,
} from "@/features/act-migration/migration-types";

export type ParsedSourceItem<T> =
  | {
      ok: true;
      sourceId: string;
      sourceKey: string;
      rawSnapshot: Record<string, unknown>;
      normalized: T;
      fingerprint: string;
    }
  | {
      ok: false;
      deterministicErrorKey: string;
      rawSnapshot: Record<string, unknown>;
      errorCode: "missing_source_id" | "invalid_source_record";
      errorFields: string[];
    };

export type StagedSourceItem = {
  streamType: ActMigrationStreamType;
  sourceKey: string;
  sourceId: string | null;
  targetSourceId: string | null;
  rawSnapshot: Record<string, unknown>;
  normalizedSnapshot: Record<string, unknown>;
  fingerprint: string;
  errorCode: string | null;
  errorFields: string[];
};

type NormalizedAddress = {
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  normalizedCity: string | null;
  normalizedRegion: string | null;
};

export type NormalizedCompany = NormalizedAddress & {
  displayName: string | null;
  normalizedName: string | null;
  phone: string | null;
  normalizedPhone: string | null;
  website: string | null;
  industry: string | null;
  editedAt: string | null;
};

export type NormalizedContact = NormalizedAddress & {
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  normalizedName: string | null;
  companyName: string | null;
  normalizedCompanyName: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  normalizedPhone: string | null;
  sharedEmail: boolean;
  personCandidate: boolean;
  editedAt: string | null;
};

export type NormalizedOpportunity = {
  displayName: string | null;
  normalizedName: string | null;
  status: string | null;
  estimatedCloseDate: string | null;
  actualCloseDate: string | null;
  total: string | number | null;
  probability: string | number | null;
  stageId: string | null;
  stageName: string | null;
  processId: string | null;
  processName: string | null;
  editedAt: string | null;
};

export type NormalizedGroup = {
  displayName: string | null;
  normalizedName: string | null;
  description: string | null;
  editedAt: string | null;
};

export type NormalizedRelationship = {
  sourceId: string;
  targetSourceId: string;
};

type NormalizedSourceItem =
  | NormalizedCompany
  | NormalizedContact
  | NormalizedOpportunity
  | NormalizedGroup
  | NormalizedRelationship;

const sharedMailboxLocalParts = new Set(["info", "office", "sales"]);

function displayValue(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function comparisonValue(value: string | null) {
  return (
    value?.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") ?? null
  );
}

function normalizedPhone(value: string | null) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordValue(value: unknown) {
  return isRecord(value) ? value : {};
}

function addressValue(value: unknown): NormalizedAddress {
  const address = recordValue(value);
  const city = displayValue(address.city);
  const region = displayValue(address.state);
  return {
    address1: displayValue(address.line1),
    address2: displayValue(address.line2),
    city,
    region,
    postalCode: displayValue(address.postalCode),
    normalizedCity: comparisonValue(city),
    normalizedRegion: comparisonValue(region),
  };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, canonicalValue(child)]),
  );
}

function sha256(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
}

function errorResult(
  streamType: string,
  rawSnapshot: Record<string, unknown>,
  errorCode: "missing_source_id" | "invalid_source_record",
  errorFields: string[],
  fingerprintInput: unknown = rawSnapshot,
): ParsedSourceItem<never> {
  return {
    ok: false,
    deterministicErrorKey: `error:${streamType}:${sha256(fingerprintInput)}`,
    rawSnapshot,
    errorCode,
    errorFields,
  };
}

function sourceIdResult(
  streamType: string,
  rawSnapshot: Record<string, unknown>,
  field: "id" | "sourceId" | "targetSourceId",
) {
  const value = rawSnapshot[field];
  if (typeof value !== "string" || !value.trim()) {
    return errorResult(streamType, rawSnapshot, "missing_source_id", [field]);
  }
  const sourceId = value.trim();
  if (sourceId.includes(":")) {
    return errorResult(streamType, rawSnapshot, "invalid_source_record", [
      field,
    ]);
  }
  return sourceId;
}

function successful<T>(
  sourceId: string,
  sourceKey: string,
  rawSnapshot: Record<string, unknown>,
  normalized: T,
): ParsedSourceItem<T> {
  return {
    ok: true,
    sourceId,
    sourceKey,
    rawSnapshot,
    normalized,
    fingerprint: sha256(rawSnapshot),
  };
}

function company(rawSnapshot: Record<string, unknown>): NormalizedCompany {
  const displayName = displayValue(rawSnapshot.name);
  const phone = displayValue(rawSnapshot.phone);
  return {
    displayName,
    normalizedName: comparisonValue(displayName),
    phone,
    normalizedPhone: normalizedPhone(phone),
    website: displayValue(rawSnapshot.website),
    industry: displayValue(rawSnapshot.industry),
    ...addressValue(rawSnapshot.address),
    editedAt: displayValue(rawSnapshot.edited),
  };
}

function contact(rawSnapshot: Record<string, unknown>): NormalizedContact {
  const firstName = displayValue(rawSnapshot.firstName);
  const lastName = displayValue(rawSnapshot.lastName);
  const fullName = displayValue(rawSnapshot.fullName);
  const displayName =
    fullName ?? displayValue([firstName, lastName].filter(Boolean).join(" "));
  const companyName = displayValue(rawSnapshot.company);
  const email =
    displayValue(rawSnapshot.emailAddress)?.toLocaleLowerCase("en-US") ?? null;
  const phone = displayValue(rawSnapshot.businessPhone);
  return {
    firstName,
    lastName,
    displayName,
    normalizedName: comparisonValue(displayName),
    companyName,
    normalizedCompanyName: comparisonValue(companyName),
    jobTitle: displayValue(rawSnapshot.jobTitle),
    email,
    phone,
    normalizedPhone: normalizedPhone(phone),
    ...addressValue(rawSnapshot.businessAddress),
    sharedEmail: sharedEmailValue(email),
    personCandidate: displayName !== null,
    editedAt: displayValue(rawSnapshot.edited),
  };
}

function scalarMetadata(value: unknown) {
  if (typeof value === "number") return value;
  return displayValue(value);
}

function opportunity(
  rawSnapshot: Record<string, unknown>,
): NormalizedOpportunity {
  const displayName = displayValue(rawSnapshot.name);
  const stage = recordValue(rawSnapshot.stage);
  const process = recordValue(stage.process);
  return {
    displayName,
    normalizedName: comparisonValue(displayName),
    status: displayValue(rawSnapshot.status),
    estimatedCloseDate: displayValue(rawSnapshot.estimatedCloseDate),
    actualCloseDate: displayValue(rawSnapshot.actualCloseDate),
    total: scalarMetadata(rawSnapshot.total),
    probability: scalarMetadata(rawSnapshot.probability),
    stageId: displayValue(stage.id),
    stageName: displayValue(stage.name),
    processId: displayValue(process.id),
    processName: displayValue(process.name),
    editedAt: displayValue(rawSnapshot.edited),
  };
}

function group(rawSnapshot: Record<string, unknown>): NormalizedGroup {
  const displayName = displayValue(rawSnapshot.name);
  return {
    displayName,
    normalizedName: comparisonValue(displayName),
    description: displayValue(rawSnapshot.description),
    editedAt: displayValue(rawSnapshot.edited),
  };
}

function parseEntity(
  streamType: ActSourceEntityType,
  rawSnapshot: Record<string, unknown>,
) {
  const sourceId = sourceIdResult(streamType, rawSnapshot, "id");
  if (typeof sourceId !== "string") return sourceId;
  const normalized =
    streamType === "company"
      ? company(rawSnapshot)
      : streamType === "contact"
        ? contact(rawSnapshot)
        : streamType === "opportunity"
          ? opportunity(rawSnapshot)
          : group(rawSnapshot);
  return successful(
    sourceId,
    sourceRecordKey(streamType, sourceId),
    rawSnapshot,
    normalized,
  );
}

function parseRelationship(
  streamType: ActRelationshipType,
  rawSnapshot: Record<string, unknown>,
) {
  const sourceId = sourceIdResult(streamType, rawSnapshot, "sourceId");
  if (typeof sourceId !== "string") return sourceId;
  const targetSourceId = sourceIdResult(
    streamType,
    rawSnapshot,
    "targetSourceId",
  );
  if (typeof targetSourceId !== "string") return targetSourceId;
  return successful(
    sourceId,
    relationshipSourceKey(streamType, sourceId, targetSourceId),
    rawSnapshot,
    { sourceId, targetSourceId },
  );
}

function sharedEmailValue(email: string | null) {
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) return false;
  const [localPart] = email.split("@");
  return sharedMailboxLocalParts.has(localPart ?? "");
}

function malformedStructuredField(
  streamType: ActSourceEntityType,
  rawSnapshot: Record<string, unknown>,
) {
  if (
    streamType === "company" &&
    Object.hasOwn(rawSnapshot, "address") &&
    rawSnapshot.address !== null &&
    !isRecord(rawSnapshot.address)
  ) {
    return "address";
  }
  if (
    streamType === "contact" &&
    Object.hasOwn(rawSnapshot, "businessAddress") &&
    rawSnapshot.businessAddress !== null &&
    !isRecord(rawSnapshot.businessAddress)
  ) {
    return "businessAddress";
  }
  if (
    streamType === "opportunity" &&
    Object.hasOwn(rawSnapshot, "stage") &&
    rawSnapshot.stage !== null &&
    !isRecord(rawSnapshot.stage)
  ) {
    return "stage";
  }
  if (
    streamType === "opportunity" &&
    isRecord(rawSnapshot.stage) &&
    Object.hasOwn(rawSnapshot.stage, "process") &&
    rawSnapshot.stage.process !== null &&
    !isRecord(rawSnapshot.stage.process)
  ) {
    return "stage.process";
  }
  return null;
}

function invalidRootSnapshot(value: unknown): Record<string, unknown> {
  return { invalidRoot: jsonCompatibleValue(value) };
}

function jsonCompatibleValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : { type: "number", value: String(value) };
  }
  if (typeof value === "bigint") {
    return { type: "bigint", value: String(value) };
  }
  if (typeof value === "undefined") return { type: "undefined" };
  if (Array.isArray(value)) return value.map(jsonCompatibleValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        jsonCompatibleValue(child),
      ]),
    );
  }
  return { type: typeof value, value: String(value) };
}

function isKnownStreamType(
  streamType: string,
): streamType is ActMigrationStreamType {
  switch (streamType) {
    case "company":
    case "contact":
    case "opportunity":
    case "group":
    case "company_contact":
    case "opportunity_company":
    case "opportunity_contact":
    case "group_contact":
      return true;
    default:
      return false;
  }
}

export function parseSourceItem(
  streamType: ActMigrationStreamType,
  rawSnapshot: Record<string, unknown>,
): ParsedSourceItem<NormalizedSourceItem> {
  const runtimeStreamType = streamType as string;
  if (!isKnownStreamType(runtimeStreamType)) {
    const safeRawSnapshot = isRecord(rawSnapshot)
      ? rawSnapshot
      : invalidRootSnapshot(rawSnapshot);
    return errorResult(
      "invalid_stream",
      safeRawSnapshot,
      "invalid_source_record",
      ["streamType"],
      { rawSnapshot: safeRawSnapshot, streamType: runtimeStreamType },
    );
  }
  if (!isRecord(rawSnapshot)) {
    return errorResult(
      runtimeStreamType,
      invalidRootSnapshot(rawSnapshot),
      "invalid_source_record",
      ["record"],
    );
  }

  switch (runtimeStreamType) {
    case "company":
    case "contact":
    case "opportunity":
    case "group": {
      const entityType = runtimeStreamType as ActSourceEntityType;
      const malformedField = malformedStructuredField(
        entityType,
        rawSnapshot,
      );
      if (malformedField) {
        return errorResult(
          runtimeStreamType,
          rawSnapshot,
          "invalid_source_record",
          [malformedField],
        );
      }
      return parseEntity(entityType, rawSnapshot);
    }
    case "company_contact":
    case "opportunity_company":
    case "opportunity_contact":
    case "group_contact":
      return parseRelationship(
        runtimeStreamType as ActRelationshipType,
        rawSnapshot,
      );
    default:
      return errorResult(
        "invalid_stream",
        rawSnapshot,
        "invalid_source_record",
        ["streamType"],
        { rawSnapshot, streamType: runtimeStreamType },
      );
  }
}
