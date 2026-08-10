export type ReviewedClosureFailureCode =
  | "operation_not_found"
  | "dependency_cycle"
  | "ineligible_source_dependency"
  | "unsafe_dependency"
  | "review_proof_required"
  | "link_target_mismatch"
  | "dependency_not_terminal"
  | "outcome_not_ready";

export type ReviewedClosureOperation = {
  operationKey: string;
  sourceRecordId: string;
  action: string;
  dependencyOperationKeys: readonly string[];
  safeByDefault: boolean;
  status: string;
  reviewedProofValid: boolean;
  selectedTargetId?: string | null;
  targetType?: string | null;
  reviewedTargetId?: string | null;
  reviewedTargetType?: string | null;
};

export type ReviewedClosureOutcome = {
  sourceRecordId: string;
  state: string;
  matchedTargetId?: string | null;
};

export type ReviewedClosureResult =
  | { ok: true; operationKeys: string[]; dependencyOperationKeys: string[] }
  | { ok: false; code: ReviewedClosureFailureCode };

const isReviewedAction = (action: string) =>
  action === "overwrite_reviewed" || action === "create_relationship";

const isTerminal = (status: string) =>
  status === "applied" || status === "already_present";

/**
 * Pure fail-closed validator shared by approval and status projection.
 * Callers provide only bounded booleans/identifiers; raw review payloads stay
 * behind the canonical proof validators that derive reviewedProofValid.
 */
export function validateReviewedClosure(input: {
  rootOperationKey: string;
  operations: readonly ReviewedClosureOperation[];
  outcomes: readonly ReviewedClosureOutcome[];
  requireTerminalIdentity?: boolean;
}): ReviewedClosureResult {
  const byKey = new Map(input.operations.map((operation) => [operation.operationKey, operation]));
  const outcomes = new Map(input.outcomes.map((outcome) => [outcome.sourceRecordId, outcome]));
  const root = byKey.get(input.rootOperationKey);
  if (!root) return { ok: false, code: "operation_not_found" };
  if (!isReviewedAction(root.action) || !root.reviewedProofValid) {
    return { ok: false, code: "review_proof_required" };
  }
  if (root.status !== "pending" && root.status !== "failed") {
    return { ok: false, code: "dependency_not_terminal" };
  }
  const outcome = outcomes.get(root.sourceRecordId);
  if (outcome?.state !== "ready") return { ok: false, code: "outcome_not_ready" };

  const closed = new Set<string>();
  const dependencies = new Set<string>();
  let hasTerminalIdentity = false;
  const visit = (
    operationKey: string,
    trail: ReadonlySet<string>,
    isDependency: boolean,
  ): ReviewedClosureFailureCode | null => {
    const operation = byKey.get(operationKey);
    if (!operation) return "operation_not_found";
    if (trail.has(operationKey)) return "dependency_cycle";
    if (closed.has(operationKey)) return null;
    if (operation.sourceRecordId !== root.sourceRecordId) {
      return "ineligible_source_dependency";
    }
    if (operation.action === "link_existing") {
      if (!outcome.matchedTargetId
        || !operation.selectedTargetId
        || operation.selectedTargetId !== outcome.matchedTargetId) {
        return "link_target_mismatch";
      }
      if (root.reviewedTargetId
        && (operation.selectedTargetId !== root.reviewedTargetId
          || !root.reviewedTargetType
          || operation.targetType !== root.reviewedTargetType)) {
        return "link_target_mismatch";
      }
      if (isTerminal(operation.status)) hasTerminalIdentity = true;
    }
    if (isReviewedAction(operation.action) && !operation.reviewedProofValid) {
      return "review_proof_required";
    }
    if (isDependency && operation.action === "overwrite_reviewed") {
      return "unsafe_dependency";
    }
    if (isTerminal(operation.status)) {
      closed.add(operationKey);
      if (isDependency) dependencies.add(operationKey);
      return null;
    }
    if (operation.status !== "pending" && operation.status !== "failed") {
      return "dependency_not_terminal";
    }
    if (isDependency && !operation.safeByDefault && !isReviewedAction(operation.action)) {
      return "unsafe_dependency";
    }
    const nextTrail = new Set(trail).add(operationKey);
    for (const dependency of operation.dependencyOperationKeys) {
      const failure = visit(dependency, nextTrail, true);
      if (failure) return failure;
    }
    closed.add(operationKey);
    if (isDependency) dependencies.add(operationKey);
    return null;
  };

  const failure = visit(input.rootOperationKey, new Set(), false);
  if (failure) return { ok: false, code: failure };
  if (input.requireTerminalIdentity && !hasTerminalIdentity) {
    return { ok: false, code: "dependency_not_terminal" };
  }
  return {
    ok: true,
    operationKeys: [...closed],
    dependencyOperationKeys: [...dependencies].sort(),
  };
}
