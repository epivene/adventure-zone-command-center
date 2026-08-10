import type { ContextClueEvidence } from "./context-clue-resolver";

export type MatchResult =
  | { kind: "exact"; localId: string; reason: string; evidence?: ContextClueEvidence[]; evidenceTruncated?: boolean }
  | { kind: "none"; reason: string; evidence?: ContextClueEvidence[]; evidenceTruncated?: boolean }
  | { kind: "ambiguous"; candidateIds: string[]; reason: string; evidence?: ContextClueEvidence[]; evidenceTruncated?: boolean; candidateIdsTruncated?: boolean };

export type ExternalLink = {
  localId: string;
  entityType?: string | null;
  sourceEntityType?: string | null;
  actRecordId?: string | null;
  sourceDatabaseKey?: string | null;
  sourceRecordId?: string | null;
};
export type ExternalLinkIdentity = {
  sourceRecordId: string;
  sourceDatabaseKey?: string | null;
  sourceEntityType?: string | null;
  sourceActRecordId?: string | null;
  targetEntityType: string;
};

export type ManualAssignment = { localId: string; active?: boolean };

export function uniqueSorted(ids: Iterable<string>): string[] {
  return [...new Set([...ids].filter((id) => id.trim() !== ""))].sort();
}

export function resultFromCandidates(
  ids: Iterable<string>,
  exactReason: string,
  ambiguousReason: string,
): MatchResult {
  const candidateIds = uniqueSorted(ids);
  if (candidateIds.length === 1) return { kind: "exact", localId: candidateIds[0]!, reason: exactReason };
  if (candidateIds.length > 1) return { kind: "ambiguous", candidateIds, reason: ambiguousReason };
  return { kind: "none", reason: "no_candidate" };
}

export function externalLinkCandidates(
  identity: ExternalLinkIdentity,
  links: readonly ExternalLink[] | undefined,
): string[] {
  return uniqueSorted((links ?? []).filter((link) =>
    link.localId.trim() &&
    identity.sourceDatabaseKey != null &&
    link.sourceDatabaseKey === identity.sourceDatabaseKey &&
    identity.sourceEntityType != null &&
    link.sourceEntityType === identity.sourceEntityType &&
    link.entityType === identity.targetEntityType &&
    identity.sourceActRecordId != null &&
    link.actRecordId === identity.sourceActRecordId &&
    (link.sourceRecordId == null || link.sourceRecordId === identity.sourceRecordId),
  ).map((link) => link.localId));
}
