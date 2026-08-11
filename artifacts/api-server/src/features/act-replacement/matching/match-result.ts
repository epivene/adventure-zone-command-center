import type { ContextClueEvidence } from "./context-clue-resolver";

export type MatchResult =
  | { kind: "exact"; localId: string; reason: string; evidence?: ContextClueEvidence[] }
  | { kind: "none"; reason: string; evidence?: ContextClueEvidence[] }
  | { kind: "ambiguous"; candidateIds: string[]; reason: string; evidence?: ContextClueEvidence[]; overflow?: boolean };

export const MATCH_COLLECTION_LIMIT = 20;

export class BoundedCollection<T> {
  private readonly selected = new Map<string, T>();
  overflow = false;

  constructor(
    private readonly key: (value: T) => string,
    private readonly limit = MATCH_COLLECTION_LIMIT,
  ) {}

  add(value: T): void {
    const key = this.key(value);
    if (!key || this.selected.has(key)) return;
    if (this.selected.size < this.limit) {
      this.selected.set(key, value);
      return;
    }
    this.overflow = true;
    const largest = [...this.selected.keys()].sort().at(-1);
    if (largest && key.localeCompare(largest) < 0) {
      this.selected.delete(largest);
      this.selected.set(key, value);
    }
  }

  values(): T[] {
    return [...this.selected.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, value]) => value);
  }
}

export class BoundedIdSet extends BoundedCollection<string> {
  constructor(limit = MATCH_COLLECTION_LIMIT) {
    super((value) => value.trim(), limit);
  }
}

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

export function boundedUniqueSorted(ids: Iterable<string>): {
  values: string[];
  overflow: boolean;
} {
  const selected = new BoundedIdSet();
  for (const id of ids) selected.add(id);
  return { values: selected.values(), overflow: selected.overflow };
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
  return externalLinkCandidateSet(identity, links).values;
}

export function externalLinkCandidateSet(
  identity: ExternalLinkIdentity,
  links: readonly ExternalLink[] | undefined,
): { values: string[]; overflow: boolean } {
  const selected = new BoundedIdSet();
  for (const link of links ?? []) {
    if (
      link.localId.trim() &&
      identity.sourceDatabaseKey != null &&
      link.sourceDatabaseKey === identity.sourceDatabaseKey &&
      identity.sourceEntityType != null &&
      link.sourceEntityType === identity.sourceEntityType &&
      link.entityType === identity.targetEntityType &&
      identity.sourceActRecordId != null &&
      link.actRecordId === identity.sourceActRecordId &&
      (link.sourceRecordId == null || link.sourceRecordId === identity.sourceRecordId)
    ) selected.add(link.localId);
  }
  return { values: selected.values(), overflow: selected.overflow };
}
