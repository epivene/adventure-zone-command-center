import type { ArchiveSourceItem } from "./archive-repository";
import type {
  ActQueryMode,
  ActReplacementStreamType,
  ActRootStreamType,
  DerivedCheckpointSpec,
} from "./import-types";
import { fingerprintSourceContent } from "./source-fingerprint";

type SourceRecord = Record<string, unknown>;
type RelatedTargetKind = "contact" | "company" | "opportunity";

type InlineRelationshipTarget = {
  streamType: ActReplacementStreamType;
  targetKind: RelatedTargetKind;
  singular: string;
  plural: string;
};

export const plainFallbackOmittedIdentityLimitation =
  "plain_fallback_omitted_identity" as const;

export class SourceRecordParseError extends Error {
  readonly code = "ACT_SOURCE_RECORD_INVALID";

  constructor() {
    super("Act! returned an invalid source record.");
    this.name = "SourceRecordParseError";
  }
}

function isSourceRecord(value: unknown): value is SourceRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireSourceRecord(value: unknown): SourceRecord {
  if (!isSourceRecord(value)) throw new SourceRecordParseError();
  return value;
}

function recordId(record: SourceRecord): string | null {
  const value = record.id;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function sourceKey(record: SourceRecord): string {
  return recordId(record) ?? `fallback:${fingerprintSourceContent(record)}`;
}

function sourceDate(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function createdAt(record: SourceRecord) {
  return sourceDate(
    record.createDate ??
      record.created ??
      record.createdAt ??
      record.create_date,
  );
}

function editedAt(record: SourceRecord) {
  return sourceDate(
    record.edited ?? record.editDate ?? record.updatedAt ?? record.editedAt,
  );
}

function rootItem(
  streamType: ActRootStreamType,
  record: SourceRecord,
  queryMode: ActQueryMode,
): ArchiveSourceItem {
  return {
    streamType,
    sourceKey: sourceKey(record),
    actRecordId: recordId(record),
    snapshotScope: queryMode === "projected" ? "list_projected" : "list_plain",
    archiveCompleteness: queryMode === "projected" ? "discovered" : "complete",
    raw: record,
    relationshipEvidence: {},
    sourceCreatedAt: createdAt(record),
    sourceEditedAt: editedAt(record),
  };
}

export function parseRootSourceRecords(input: {
  streamType: ActRootStreamType;
  records: readonly unknown[];
  queryMode: ActQueryMode;
}): ArchiveSourceItem[] {
  return input.records.map((value) =>
    rootItem(input.streamType, requireSourceRecord(value), input.queryMode),
  );
}

export function parseDetailSourceRecord(input: {
  streamType: ActRootStreamType;
  requestedId: string;
  record: unknown;
}): ArchiveSourceItem {
  const record = requireSourceRecord(input.record);
  const returnedId = recordId(record);
  return {
    streamType: input.streamType,
    sourceKey: input.requestedId,
    actRecordId: input.requestedId,
    snapshotScope: "detail",
    archiveCompleteness: "complete",
    raw: record,
    relationshipEvidence: {
      requestedActRecordId: input.requestedId,
      returnedActRecordId: returnedId,
    },
    sourceCreatedAt: createdAt(record),
    sourceEditedAt: editedAt(record),
  };
}

function relationshipSourceKey(parentId: string, targetSourceKey: string) {
  return `${encodeURIComponent(parentId)}:${encodeURIComponent(targetSourceKey)}`;
}

function relationshipItem(input: {
  streamType: ActReplacementStreamType;
  parentKind: string;
  parentSourceKey: string;
  parentActRecordId: string | null;
  targetKind: RelatedTargetKind;
  record: SourceRecord;
  source: "inline" | "endpoint";
}): ArchiveSourceItem {
  const targetId = recordId(input.record);
  const targetSourceKey = targetId ?? sourceKey(input.record);
  return {
    streamType: input.streamType,
    sourceKey: relationshipSourceKey(input.parentSourceKey, targetSourceKey),
    actRecordId: null,
    snapshotScope: "relationship",
    archiveCompleteness: "complete",
    raw: input.record,
    relationshipEvidence: {
      source: input.source,
      parentKind: input.parentKind,
      parentActRecordId: input.parentActRecordId,
      targetKind: input.targetKind,
      targetActRecordId: targetId,
    },
    sourceCreatedAt: createdAt(input.record),
    sourceEditedAt: editedAt(input.record),
  };
}

export function parseRelationshipSourceRecords(input: {
  streamType: ActReplacementStreamType;
  parentKind: string;
  parentId: string;
  targetKind: RelatedTargetKind;
  records: readonly unknown[];
}): ArchiveSourceItem[] {
  return input.records.map((value) =>
    relationshipItem({
      ...input,
      parentSourceKey: input.parentId,
      parentActRecordId: input.parentId,
      record: requireSourceRecord(value),
      source: "endpoint",
    }),
  );
}

const inlineRelationshipTargets: Partial<
  Record<ActRootStreamType, readonly InlineRelationshipTarget[]>
> = {
  contact: [
    {
      streamType: "company_contact",
      targetKind: "company",
      singular: "company",
      plural: "companies",
    },
  ],
  opportunity: [
    {
      streamType: "opportunity_company",
      targetKind: "company",
      singular: "company",
      plural: "companies",
    },
    {
      streamType: "opportunity_contact",
      targetKind: "contact",
      singular: "contact",
      plural: "contacts",
    },
  ],
  group: [
    {
      streamType: "group_contact",
      targetKind: "contact",
      singular: "contact",
      plural: "contacts",
    },
  ],
  activity: [
    {
      streamType: "activity_contact",
      targetKind: "contact",
      singular: "contact",
      plural: "contacts",
    },
    {
      streamType: "activity_company",
      targetKind: "company",
      singular: "company",
      plural: "companies",
    },
    {
      streamType: "activity_opportunity",
      targetKind: "opportunity",
      singular: "opportunity",
      plural: "opportunities",
    },
  ],
  note: [
    {
      streamType: "note_contact",
      targetKind: "contact",
      singular: "contact",
      plural: "contacts",
    },
    {
      streamType: "note_company",
      targetKind: "company",
      singular: "company",
      plural: "companies",
    },
    {
      streamType: "note_opportunity",
      targetKind: "opportunity",
      singular: "opportunity",
      plural: "opportunities",
    },
  ],
  history: [
    {
      streamType: "history_contact",
      targetKind: "contact",
      singular: "contact",
      plural: "contacts",
    },
    {
      streamType: "history_company",
      targetKind: "company",
      singular: "company",
      plural: "companies",
    },
    {
      streamType: "history_opportunity",
      targetKind: "opportunity",
      singular: "opportunity",
      plural: "opportunities",
    },
  ],
};

function hasOwn(record: SourceRecord, property: string) {
  return Object.prototype.hasOwnProperty.call(record, property);
}

function inlineRecords(
  parentRecord: SourceRecord,
  target: InlineRelationshipTarget,
): { covered: boolean; records: SourceRecord[] } {
  const records: SourceRecord[] = [];
  const singularPresent = hasOwn(parentRecord, target.singular);
  const singular = parentRecord[target.singular];
  const singularCovered =
    singularPresent &&
    (singular === null ||
      (isSourceRecord(singular) && recordId(singular) !== null));
  if (isSourceRecord(singular)) {
    records.push(singular);
  }
  const pluralPresent = hasOwn(parentRecord, target.plural);
  const plural = parentRecord[target.plural];
  let pluralCovered = false;
  if (Array.isArray(plural)) {
    pluralCovered = plural.every(
      (value) => isSourceRecord(value) && recordId(value) !== null,
    );
    for (const value of plural) {
      if (isSourceRecord(value)) records.push(value);
    }
  } else if (pluralPresent && plural === null) {
    pluralCovered = true;
  }
  return {
    covered:
      (singularPresent || pluralPresent) &&
      (!singularPresent || singularCovered) &&
      (!pluralPresent || pluralCovered),
    records,
  };
}

export function parseInlineRelationshipRecords(input: {
  parentKind: ActRootStreamType;
  parentRecord: unknown;
}): {
  items: ArchiveSourceItem[];
  coveredTargets: RelatedTargetKind[];
  missingTargets: RelatedTargetKind[];
} {
  const parentRecord = requireSourceRecord(input.parentRecord);
  const parentActRecordId = recordId(parentRecord);
  const parentSourceKey = sourceKey(parentRecord);
  const items: ArchiveSourceItem[] = [];
  const coveredTargets: RelatedTargetKind[] = [];
  const missingTargets: RelatedTargetKind[] = [];

  for (const target of inlineRelationshipTargets[input.parentKind] ?? []) {
    const inline = inlineRecords(parentRecord, target);
    if (inline.covered) coveredTargets.push(target.targetKind);
    else missingTargets.push(target.targetKind);
    const seen = new Set<string>();
    for (const record of inline.records) {
      const item = relationshipItem({
        streamType: target.streamType,
        parentKind: input.parentKind,
        parentSourceKey,
        parentActRecordId,
        targetKind: target.targetKind,
        record,
        source: "inline",
      });
      if (!seen.has(item.sourceKey)) {
        seen.add(item.sourceKey);
        items.push(item);
      }
    }
  }

  return { items, coveredTargets, missingTargets };
}

export function reconcilePlainFallbackCoverage(input: {
  projected: readonly ArchiveSourceItem[];
  fallback: readonly ArchiveSourceItem[];
}): {
  complete: ArchiveSourceItem[];
  partial: ArchiveSourceItem[];
  derivedCheckpoints: DerivedCheckpointSpec[];
} {
  const returned = new Set(input.fallback.map(({ sourceKey }) => sourceKey));
  const projectedEvidence = new Map(
    input.projected.map(({ sourceKey, relationshipEvidence }) => [
      sourceKey,
      relationshipEvidence,
    ]),
  );
  const complete = input.fallback.map((item) => ({
    ...item,
    relationshipEvidence: {
      ...(projectedEvidence.get(item.sourceKey) ?? {}),
      ...item.relationshipEvidence,
    },
  }));
  const partialByKey = new Map<string, ArchiveSourceItem>();
  for (const item of input.projected) {
    if (returned.has(item.sourceKey) || partialByKey.has(item.sourceKey))
      continue;
    const existingLimitations = Array.isArray(
      item.relationshipEvidence.limitations,
    )
      ? item.relationshipEvidence.limitations.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    partialByKey.set(item.sourceKey, {
      ...item,
      archiveCompleteness: "partial",
      relationshipEvidence: {
        ...item.relationshipEvidence,
        limitations: [
          ...new Set([
            ...existingLimitations,
            plainFallbackOmittedIdentityLimitation,
          ]),
        ],
      },
    });
  }
  return {
    complete,
    partial: [...partialByKey.values()],
    derivedCheckpoints: [],
  };
}
