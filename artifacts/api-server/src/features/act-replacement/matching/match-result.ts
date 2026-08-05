export type MatchResult =
  | { kind: "exact"; localId: string; reason: string }
  | { kind: "none"; reason: string }
  | { kind: "ambiguous"; candidateIds: string[]; reason: string };

export type ExternalLink = {
  localId: string;
  sourceDatabaseKey?: string | null;
  sourceRecordId?: string | null;
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
  sourceRecordId: string,
  links: readonly ExternalLink[] | undefined,
  sourceDatabaseKey?: string | null,
): string[] {
  return uniqueSorted((links ?? []).filter((link) =>
    link.localId.trim() &&
    link.sourceRecordId === sourceRecordId &&
    sourceDatabaseKey != null &&
    link.sourceDatabaseKey === sourceDatabaseKey,
  ).map((link) => link.localId));
}

/** Links lacking the current source identity are retained as review candidates, never auto-claimed. */
export function externalLinkReviewCandidates(
  sourceRecordId: string,
  links: readonly ExternalLink[] | undefined,
  sourceDatabaseKey?: string | null,
): string[] {
  return uniqueSorted((links ?? []).filter((link) => {
    if (!link.localId.trim()) return false;
    return link.sourceRecordId !== sourceRecordId || sourceDatabaseKey == null || link.sourceDatabaseKey !== sourceDatabaseKey;
  }).map((link) => link.localId));
}
