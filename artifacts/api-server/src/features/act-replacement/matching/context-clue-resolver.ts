export type ContextClueFamily =
  | "identity"
  | "direct_contact"
  | "web_identity"
  | "location"
  | "archive_relationship"
  | "event_context"
  | "narrative_context";

export type ContextTargetEntityType =
  | "organization"
  | "contact"
  | "booking"
  | "calling_list"
  | "activity";

export type ContextClueEvidence = {
  family: ContextClueFamily;
  label: string;
  targetEntityType: ContextTargetEntityType;
  targetEntityId: string;
  authority: "authoritative" | "supporting";
};

export type ContextResolution =
  | {
      kind: "resolved";
      targetEntityType: ContextTargetEntityType;
      targetEntityId: string;
      reason: string;
      evidence: ContextClueEvidence[];
    }
  | { kind: "none"; reason: string; evidence: ContextClueEvidence[] }
  | {
      kind: "ambiguous";
      candidateIds: string[];
      reason: string;
      evidence: ContextClueEvidence[];
    };

const authorityRank: Record<ContextClueEvidence["authority"], number> = {
  authoritative: 0,
  supporting: 1,
};

function targetKey(clue: ContextClueEvidence): string {
  return `${clue.targetEntityType}\u0000${clue.targetEntityId}`;
}

function compareEvidence(
  left: ContextClueEvidence,
  right: ContextClueEvidence,
): number {
  return (
    left.family.localeCompare(right.family) ||
    left.targetEntityType.localeCompare(right.targetEntityType) ||
    left.targetEntityId.localeCompare(right.targetEntityId) ||
    authorityRank[left.authority] - authorityRank[right.authority] ||
    left.label.localeCompare(right.label)
  );
}

function normalizedEvidence(
  clues: readonly ContextClueEvidence[],
): ContextClueEvidence[] {
  const selected = new Map<string, ContextClueEvidence>();
  for (const clue of [...clues].sort(compareEvidence)) {
    const label = clue.label.trim();
    const targetEntityId = clue.targetEntityId.trim();
    if (!label || !targetEntityId) continue;
    const normalized = { ...clue, label, targetEntityId };
    const key = `${targetKey(normalized)}\u0000${normalized.family}`;
    const current = selected.get(key);
    if (
      !current ||
      authorityRank[normalized.authority] < authorityRank[current.authority] ||
      (normalized.authority === current.authority &&
        normalized.label.localeCompare(current.label) < 0)
    ) {
      selected.set(key, normalized);
    }
  }
  return [...selected.values()].sort(compareEvidence);
}

/**
 * Resolves conservative context evidence without assigning numeric weights.
 * One authoritative target wins. Otherwise all evidence must agree on one
 * target and span at least two independent clue families.
 */
export function resolveContextClues(
  clues: readonly ContextClueEvidence[],
): ContextResolution {
  const evidence = normalizedEvidence(clues);
  const authoritativeTargets = new Map<
    string,
    { targetEntityType: ContextTargetEntityType; targetEntityId: string }
  >();
  const allTargets = new Map<
    string,
    { targetEntityType: ContextTargetEntityType; targetEntityId: string }
  >();
  const familiesByTarget = new Map<string, Set<ContextClueFamily>>();

  for (const clue of evidence) {
    const key = targetKey(clue);
    const target = {
      targetEntityType: clue.targetEntityType,
      targetEntityId: clue.targetEntityId,
    };
    allTargets.set(key, target);
    const families = familiesByTarget.get(key) ?? new Set();
    families.add(clue.family);
    familiesByTarget.set(key, families);
    if (clue.authority === "authoritative") {
      authoritativeTargets.set(key, target);
    }
  }

  const candidateIds = [...new Set(
    [...allTargets.values()].map((target) => target.targetEntityId),
  )].sort();

  if (authoritativeTargets.size === 1 && allTargets.size === 1) {
    const [key, target] = authoritativeTargets.entries().next().value!;
    if ([...authoritativeTargets.keys()].every((candidate) => candidate === key)) {
      return {
        kind: "resolved",
        ...target,
        reason: "authoritative_context_clue",
        evidence,
      };
    }
  }

  if (authoritativeTargets.size > 1 || allTargets.size > 1) {
    return {
      kind: "ambiguous",
      candidateIds,
      reason: "conflicting_context_clues",
      evidence,
    };
  }

  const onlyTarget = allTargets.entries().next().value as
    | [
        string,
        { targetEntityType: ContextTargetEntityType; targetEntityId: string },
      ]
    | undefined;
  if (!onlyTarget || (familiesByTarget.get(onlyTarget[0])?.size ?? 0) < 2) {
    return {
      kind: "none",
      reason: "insufficient_independent_context_clues",
      evidence,
    };
  }

  return {
    kind: "resolved",
    ...onlyTarget[1],
    reason: "two_independent_context_clues",
    evidence,
  };
}
