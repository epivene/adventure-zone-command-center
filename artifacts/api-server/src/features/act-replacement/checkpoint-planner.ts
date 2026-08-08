import type { ArchiveSourceItem } from "./archive-repository";
import type {
  ActCheckpointKind,
  ActCheckpointRequiredness,
  ActQueryMode,
  ActRootStreamType,
  DerivedCheckpointSpec,
} from "./import-types";

type RelationshipTarget = {
  streamType:
    | "company_contact"
    | "opportunity_company"
    | "opportunity_contact"
    | "group_contact"
    | "activity_contact"
    | "activity_company"
    | "activity_opportunity"
    | "note_contact"
    | "note_company"
    | "note_opportunity"
    | "history_contact"
    | "history_company"
    | "history_opportunity";
  singular: string;
  plural: string;
};

const relationshipTargets: Partial<
  Record<ActRootStreamType, readonly RelationshipTarget[]>
> = {
  contact: [
    {
      streamType: "company_contact",
      singular: "company",
      plural: "companies",
    },
  ],
  opportunity: [
    {
      streamType: "opportunity_company",
      singular: "company",
      plural: "companies",
    },
    {
      streamType: "opportunity_contact",
      singular: "contact",
      plural: "contacts",
    },
  ],
  group: [
    {
      streamType: "group_contact",
      singular: "contact",
      plural: "contacts",
    },
  ],
  activity: [
    {
      streamType: "activity_contact",
      singular: "contact",
      plural: "contacts",
    },
    {
      streamType: "activity_company",
      singular: "company",
      plural: "companies",
    },
    {
      streamType: "activity_opportunity",
      singular: "opportunity",
      plural: "opportunities",
    },
  ],
  note: [
    {
      streamType: "note_contact",
      singular: "contact",
      plural: "contacts",
    },
    {
      streamType: "note_company",
      singular: "company",
      plural: "companies",
    },
    {
      streamType: "note_opportunity",
      singular: "opportunity",
      plural: "opportunities",
    },
  ],
  history: [
    {
      streamType: "history_contact",
      singular: "contact",
      plural: "contacts",
    },
    {
      streamType: "history_company",
      singular: "company",
      plural: "companies",
    },
    {
      streamType: "history_opportunity",
      singular: "opportunity",
      plural: "opportunities",
    },
  ],
};

function hasOwn(record: Record<string, unknown>, property: string) {
  return Object.prototype.hasOwnProperty.call(record, property);
}

function hasInlineCoverage(
  record: Record<string, unknown>,
  target: RelationshipTarget,
) {
  const singularPresent = hasOwn(record, target.singular);
  const singular = record[target.singular];
  const singularCovered =
    singularPresent &&
    (singular === null ||
      (singular &&
        typeof singular === "object" &&
        !Array.isArray(singular) &&
        hasUsableId(singular as Record<string, unknown>)));
  const pluralPresent = hasOwn(record, target.plural);
  const plural = record[target.plural];
  const pluralCovered =
    pluralPresent &&
    (plural === null ||
      (Array.isArray(plural) &&
        plural.every(
          (value) =>
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            hasUsableId(value as Record<string, unknown>),
        )));
  return (
    (singularPresent || pluralPresent) &&
    (!singularPresent || singularCovered) &&
    (!pluralPresent || pluralCovered)
  );
}

function hasUsableId(record: Record<string, unknown>) {
  const id = record.id;
  return (
    (typeof id === "string" && id.trim().length > 0) ||
    (typeof id === "number" && Number.isFinite(id))
  );
}

function detailCheckpoint(input: {
  streamType: ActRootStreamType;
  actRecordId: string;
  pageSize: number;
}): DerivedCheckpointSpec {
  return {
    streamType: input.streamType,
    checkpointKind: "detail",
    partitionKey: `detail:${encodeURIComponent(input.actRecordId)}`,
    requiredness: "required",
    parentSourceRecordId: null,
    parentActRecordId: input.actRecordId,
    sourceRecordId: null,
    nextSkip: 0,
    pageSize: input.pageSize,
    queryMode: "plain",
    deriveDetails: false,
  };
}

function relationshipCheckpoint(input: {
  target: RelationshipTarget;
  parentActRecordId: string;
  pageSize: number;
}): DerivedCheckpointSpec {
  return {
    streamType: input.target.streamType,
    checkpointKind: "relationship",
    partitionKey: `relationship:${encodeURIComponent(input.parentActRecordId)}`,
    requiredness: "optional_capability",
    parentSourceRecordId: null,
    parentActRecordId: input.parentActRecordId,
    sourceRecordId: null,
    nextSkip: 0,
    pageSize: input.pageSize,
    queryMode: "projected",
    deriveDetails: false,
  };
}

function contactNotesCheckpoint(input: {
  contactActRecordId: string;
  pageSize: number;
}): DerivedCheckpointSpec {
  return {
    streamType: "note",
    checkpointKind: "relationship",
    partitionKey: `contact-notes:${encodeURIComponent(input.contactActRecordId)}`,
    requiredness: "required",
    parentSourceRecordId: null,
    parentActRecordId: input.contactActRecordId,
    sourceRecordId: null,
    nextSkip: 0,
    pageSize: input.pageSize,
    queryMode: "plain",
    deriveDetails: false,
  };
}

export function planRootDerivedCheckpoints(input: {
  rootStream: ActRootStreamType;
  items: readonly ArchiveSourceItem[];
  pageSize: number;
  queryMode: ActQueryMode;
  deriveDetails: boolean;
}): DerivedCheckpointSpec[] {
  const result: DerivedCheckpointSpec[] = [];
  const detailIds = new Set<string>();
  const relationshipKeys = new Set<string>();
  const contactNoteIds = new Set<string>();
  const targets = relationshipTargets[input.rootStream] ?? [];

  for (const item of input.items) {
    const actRecordId = item.actRecordId;
    if (!actRecordId) continue;
    if (
      input.queryMode === "projected" &&
      input.deriveDetails &&
      !detailIds.has(actRecordId)
    ) {
      detailIds.add(actRecordId);
      result.push(
        detailCheckpoint({
          streamType: input.rootStream,
          actRecordId,
          pageSize: input.pageSize,
        }),
      );
    }
    if (input.rootStream === "contact" && !contactNoteIds.has(actRecordId)) {
      contactNoteIds.add(actRecordId);
      result.push(
        contactNotesCheckpoint({
          contactActRecordId: actRecordId,
          pageSize: input.pageSize,
        }),
      );
    }
    for (const target of targets) {
      if (hasInlineCoverage(item.raw, target)) continue;
      const key = `${target.streamType}\u0000${actRecordId}`;
      if (relationshipKeys.has(key)) continue;
      relationshipKeys.add(key);
      result.push(
        relationshipCheckpoint({
          target,
          parentActRecordId: actRecordId,
          pageSize: input.pageSize,
        }),
      );
    }
  }
  return result;
}

export function createPlainListFallbackCheckpoint(input: {
  rootStream: ActRootStreamType;
  pageSize: number;
}): DerivedCheckpointSpec {
  return {
    streamType: input.rootStream,
    checkpointKind: "plain_list_fallback",
    partitionKey: `plain-full:${input.rootStream}`,
    requiredness: "optional_capability",
    parentSourceRecordId: null,
    parentActRecordId: null,
    sourceRecordId: null,
    nextSkip: 0,
    pageSize: input.pageSize,
    queryMode: "plain",
    deriveDetails: false,
  };
}

export type PaginationProgress = {
  outcome: "continue" | "complete" | "pagination_stalled";
  errorCode: "pagination_stalled" | null;
  nextConsecutiveNonemptyPagesWithoutNewKeys: number;
  limitation: string | null;
  affectedCompleteness: "partial" | null;
};

export function evaluatePaginationProgress(input: {
  checkpointKind: ActCheckpointKind;
  requiredness: ActCheckpointRequiredness;
  currentSkip: number;
  nextSkip: number | null;
  pageFingerprint: string;
  receiptFingerprints: readonly string[];
  pageSourceKeys: readonly string[];
  seenSourceKeys: readonly string[];
  consecutiveNonemptyPagesWithoutNewKeys: number;
}): PaginationProgress {
  const seen = new Set(input.seenSourceKeys);
  const hasNewSourceKey = input.pageSourceKeys.some((key) => !seen.has(key));
  const nextConsecutive =
    input.pageSourceKeys.length > 0 && !hasNewSourceKey
      ? input.consecutiveNonemptyPagesWithoutNewKeys + 1
      : 0;
  const repeatedFingerprint = input.receiptFingerprints.includes(
    input.pageFingerprint,
  );
  const nonIncreasingCursor =
    input.nextSkip !== null && input.nextSkip <= input.currentSkip;
  const stalled =
    repeatedFingerprint || nonIncreasingCursor || nextConsecutive >= 2;
  const optionalLimitation =
    input.requiredness === "optional_capability" &&
    (input.checkpointKind === "relationship" ||
      input.checkpointKind === "plain_list_fallback");

  if (stalled) {
    return {
      outcome: "pagination_stalled",
      errorCode: "pagination_stalled",
      nextConsecutiveNonemptyPagesWithoutNewKeys: nextConsecutive,
      limitation: optionalLimitation
        ? `${input.checkpointKind}_pagination_stalled`
        : null,
      affectedCompleteness: optionalLimitation ? "partial" : null,
    };
  }
  return {
    outcome: input.nextSkip === null ? "complete" : "continue",
    errorCode: null,
    nextConsecutiveNonemptyPagesWithoutNewKeys: nextConsecutive,
    limitation: null,
    affectedCompleteness: null,
  };
}
