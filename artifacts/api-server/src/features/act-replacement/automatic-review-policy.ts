import type { ManifestOutcome } from "./manifest-builder";

export type AutomaticReviewDisposition =
  | "auto_resolved"
  | "safe_ready"
  | "archived_only"
  | "failed";

export type AutomaticReviewBasis =
  | "safe_create"
  | "trusted_exact_match"
  | "proven_context_match"
  | "not_automatically_safe";

export type AutomaticReviewProof = {
  version: 1;
  eligible: boolean;
  disposition: AutomaticReviewDisposition;
  basis: AutomaticReviewBasis;
};

export type AutomaticReviewOperation = {
  action: string;
  safeByDefault: boolean;
  status: string;
  targetType: string;
};

type ProofBearingOperation = AutomaticReviewOperation & {
  automaticReview?: unknown;
  payload?: unknown;
};

const maximumEvidence = 20;
const automaticallyImportableActions = new Set([
  "link_existing",
  "create",
  "fill_missing",
  "create_relationship",
]);
const compatibleTargetTypes = new Set([
  "organization",
  "contact",
  "booking",
  "calling_list",
  "activity",
  "organization_contact",
  "booking_contact",
  "calling_list_member",
  "activity_association",
]);
const identityTargetTypes = new Set([
  "organization",
  "contact",
  "booking",
  "calling_list",
  "activity",
]);
const contextClueFamilies = new Set([
  "identity",
  "direct_contact",
  "web_identity",
  "location",
  "archive_relationship",
  "event_context",
  "narrative_context",
]);
const trustedExactReasons = new Set([
  "exact_external_link",
  "manual_assignment",
  "manual_review",
]);
const dispositions = new Set<AutomaticReviewDisposition>([
  "auto_resolved",
  "safe_ready",
  "archived_only",
  "failed",
]);
const bases = new Set<AutomaticReviewBasis>([
  "safe_create",
  "trusted_exact_match",
  "proven_context_match",
  "not_automatically_safe",
]);

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function selectedTargetTypesFromOperations(
  operations: readonly AutomaticReviewOperation[],
): ReadonlySet<string> {
  const selectedTargetTypes = new Set<string>();
  for (const operation of operations) {
    if (
      operation.action !== "link_existing" ||
      !isAutomaticallyImportableOperation(operation)
    ) continue;
    if (compatibleTargetTypes.has(operation.targetType)) {
      selectedTargetTypes.add(operation.targetType);
    }
  }
  return selectedTargetTypes;
}

export function hasProvenContextMatch(
  input: {
    outcome: Pick<ManifestOutcome, "match">;
    selectedTargetTypes: ReadonlySet<string>;
  },
): boolean {
  const match = object(input.outcome.match);
  const localId = match.localId;
  if (
    match.kind !== "exact" ||
    typeof localId !== "string" ||
    !localId ||
    !Array.isArray(match.evidence) ||
    match.evidence.length === 0 ||
    match.evidence.length > maximumEvidence
  ) return false;

  let authoritative = false;
  const families = new Set<string>();
  for (const rawEvidence of match.evidence) {
    const evidence = object(rawEvidence);
    if (
      typeof evidence.family !== "string" ||
      !contextClueFamilies.has(evidence.family) ||
      evidence.targetEntityId !== localId ||
      typeof evidence.targetEntityType !== "string" ||
      !compatibleTargetTypes.has(evidence.targetEntityType) ||
      !input.selectedTargetTypes.has(evidence.targetEntityType) ||
      (evidence.authority !== "authoritative" &&
        evidence.authority !== "supporting")
    ) return false;
    if (evidence.authority === "authoritative") authoritative = true;
    families.add(evidence.family);
  }
  return authoritative || families.size >= 2;
}

export function isAutomaticallyImportableOperation(
  operation: AutomaticReviewOperation,
): boolean {
  return isAutomaticallyImportableAction(operation) &&
    (operation.status === "pending" || operation.status === "failed");
}

export function isAutomaticallyImportableAction(
  operation: Pick<AutomaticReviewOperation, "action" | "safeByDefault">,
): boolean {
  return operation.safeByDefault &&
    automaticallyImportableActions.has(operation.action);
}

function exactMatchBasis(
  outcome: { match: unknown },
  operations: readonly AutomaticReviewOperation[],
): AutomaticReviewBasis | null {
  const match = object(outcome.match);
  if (match.kind !== "exact") return null;

  if (match.evidence !== undefined) {
    return hasProvenContextMatch({
      outcome: { match: outcome.match as ManifestOutcome["match"] },
      selectedTargetTypes: selectedTargetTypesFromOperations(operations),
    })
      ? "proven_context_match"
      : null;
  }

  return typeof match.reason === "string" && trustedExactReasons.has(match.reason)
    ? "trusted_exact_match"
    : null;
}

function operationBasis(input: {
  outcome: { state: string; match: unknown };
  operations: readonly AutomaticReviewOperation[];
  operation: AutomaticReviewOperation;
}): AutomaticReviewBasis | null {
  if (!isAutomaticallyImportableOperation(input.operation)) return null;
  const match = object(input.outcome.match);
  if (input.operation.action === "create") {
    if (match.kind === "ambiguous") return null;
    return match.kind === "exact"
      ? exactMatchBasis(input.outcome, input.operations)
      : "safe_create";
  }
  if (input.operation.action === "create_relationship") {
    if (match.kind === "ambiguous") return null;
    if (match.kind === "exact") {
      return exactMatchBasis(input.outcome, input.operations);
    }
    const hasSafeCreateRoot = input.operations.some((operation) =>
      operation.action === "create" &&
      identityTargetTypes.has(operation.targetType) &&
      isAutomaticallyImportableOperation(operation)
    );
    return hasSafeCreateRoot ? "safe_create" : null;
  }
  if (
    input.operation.action === "link_existing" ||
    input.operation.action === "fill_missing"
  ) return exactMatchBasis(input.outcome, input.operations);
  return null;
}

function evaluate(input: {
  outcome: { state: string; match: unknown };
  operations: readonly AutomaticReviewOperation[];
}): {
  disposition: AutomaticReviewDisposition;
  basisByOperation: Map<AutomaticReviewOperation, AutomaticReviewBasis>;
} {
  const basisByOperation = new Map<
    AutomaticReviewOperation,
    AutomaticReviewBasis
  >();
  if (input.outcome.state === "failed") {
    return { disposition: "failed", basisByOperation };
  }

  const match = object(input.outcome.match);
  if (
    match.kind === "ambiguous" ||
    input.outcome.state === "unassigned" ||
    input.outcome.state === "unsupported" ||
    input.outcome.state === "ignored"
  ) return { disposition: "archived_only", basisByOperation };

  for (const operation of input.operations) {
    const basis = operationBasis({ ...input, operation });
    if (basis) basisByOperation.set(operation, basis);
  }
  if (basisByOperation.size === 0) {
    return { disposition: "archived_only", basisByOperation };
  }
  const autoResolved = [...basisByOperation.values()].some(
    (basis) => basis === "proven_context_match",
  );
  return {
    disposition: autoResolved ? "auto_resolved" : "safe_ready",
    basisByOperation,
  };
}

export function automaticReviewProof(input: {
  outcome: { state: string; match: unknown };
  operations: readonly AutomaticReviewOperation[];
  operation: AutomaticReviewOperation;
}): AutomaticReviewProof {
  const result = evaluate(input);
  const basis = operationBasis(input);
  return {
    version: 1,
    eligible: Boolean(basis),
    disposition: result.disposition,
    basis: basis ?? "not_automatically_safe",
  };
}

export function readAutomaticReviewProof(value: unknown): AutomaticReviewProof | null {
  const proof = object(value);
  if (
    Object.keys(proof).length !== 4 ||
    !Object.hasOwn(proof, "version") ||
    !Object.hasOwn(proof, "eligible") ||
    !Object.hasOwn(proof, "disposition") ||
    !Object.hasOwn(proof, "basis") ||
    proof.version !== 1 ||
    typeof proof.eligible !== "boolean" ||
    typeof proof.disposition !== "string" ||
    !dispositions.has(proof.disposition as AutomaticReviewDisposition) ||
    typeof proof.basis !== "string" ||
    !bases.has(proof.basis as AutomaticReviewBasis)
  ) return null;
  const eligibleBasis =
    proof.basis === "safe_create" ||
    proof.basis === "trusted_exact_match" ||
    proof.basis === "proven_context_match";
  if (proof.eligible !== eligibleBasis) return null;
  if (
    (proof.basis === "proven_context_match" &&
      proof.disposition !== "auto_resolved") ||
    ((proof.basis === "safe_create" || proof.basis === "trusted_exact_match") &&
      proof.disposition !== "safe_ready")
  ) return null;
  return proof as AutomaticReviewProof;
}

export function readAutomaticReviewProofForOperation(
  operation: Pick<ProofBearingOperation, "automaticReview" | "payload">,
): AutomaticReviewProof | null {
  const payload = object(operation.payload);
  return readAutomaticReviewProof(
    operation.automaticReview ?? payload.automaticReview,
  );
}

export function isAutomaticallyApprovedOperation(
  operation: ProofBearingOperation,
): boolean {
  const proof = readAutomaticReviewProofForOperation(operation);
  if (
    proof?.eligible !== true ||
    !compatibleTargetTypes.has(operation.targetType) ||
    !isAutomaticallyImportableOperation(operation)
  ) {
    return false;
  }
  return proof.basis === "safe_create"
    ? operation.action === "create" || operation.action === "create_relationship"
    : operation.action === "link_existing"
      || operation.action === "fill_missing"
      || operation.action === "create_relationship";
}

export function automaticReviewDisposition(input: {
  outcome: { state: string; match: unknown };
  operations: readonly AutomaticReviewOperation[];
}): AutomaticReviewDisposition {
  return evaluate(input).disposition;
}
