import type { ManifestOutcome } from "./manifest-builder";
import { approvalProjectionIsIncomplete } from "./approval-projection";

export type AutomaticReviewDisposition =
  | "auto_resolved"
  | "safe_ready"
  | "archived_only"
  | "failed";

export type AutomaticReviewOperation = {
  action: string;
  safeByDefault: boolean;
  status: string;
  targetType: string;
  selectedTargetId?: string | null;
  payload?: Readonly<Record<string, unknown>>;
};

const maximumEvidence = 20;
const automaticallyImportableActions = new Set([
  "link_existing",
  "create",
  "fill_missing",
]);
const compatibleTargetTypes = new Set([
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

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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
    match.evidenceTruncated === true ||
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
      (evidence.authority !== "authoritative" && evidence.authority !== "supporting")
    ) return false;
    if (evidence.authority === "authoritative") authoritative = true;
    families.add(evidence.family);
  }
  return authoritative || families.size >= 2;
}

export function isAutomaticallyImportableOperation(
  operation: AutomaticReviewOperation,
): boolean {
  return isAutomaticallyImportableAction(operation)
    && (operation.status === "pending" || operation.status === "failed");
}

export function isAutomaticallyImportableAction(
  operation: Pick<AutomaticReviewOperation, "action" | "safeByDefault">,
): boolean {
  return operation.safeByDefault
    && automaticallyImportableActions.has(operation.action)
}

function isLegacyExactExternalLink(match: Record<string, unknown>): boolean {
  return match.kind === "exact"
    && match.reason === "exact_external_link"
    && typeof match.localId === "string"
    && match.localId !== ""
    && match.evidenceTruncated !== true
    && (!Array.isArray(match.evidence) || match.evidence.length === 0);
}

export function isAutomaticallyImportableForOutcome(
  operation: AutomaticReviewOperation,
  outcome: { state?: string; match: unknown },
): boolean {
  if (approvalProjectionIsIncomplete(operation.payload)) return false;
  if (!isAutomaticallyImportableAction(operation)) return false;
  const match = object(outcome.match);
  if (match.kind === "ambiguous" || match.evidenceTruncated === true) {
    return false;
  }
  const selectedTargetTypes = compatibleTargetTypes.has(operation.targetType)
    ? new Set([operation.targetType])
    : new Set<string>();
  const hasProvenMatch = hasProvenContextMatch({
    outcome: { match: outcome.match as ManifestOutcome["match"] },
    selectedTargetTypes,
  });
  if (
    match.kind === "exact"
    && Array.isArray(match.evidence)
    && match.evidence.length > 0
    && !hasProvenMatch
  ) return false;
  if (operation.action !== "link_existing") return true;
  const payloadLocalId = operation.payload?.localId ?? operation.selectedTargetId;
  if (
    typeof payloadLocalId !== "string"
    || payloadLocalId === ""
    || payloadLocalId !== match.localId
  ) return false;
  if (
    outcome.state === "ready"
    && match.kind !== "none"
    && (!Array.isArray(match.evidence) || match.evidence.length === 0)
  ) return true;
  return hasProvenMatch || isLegacyExactExternalLink(match);
}

export function automaticReviewDisposition(input: {
  outcome: { state: string; match: unknown };
  operations: readonly AutomaticReviewOperation[];
}): AutomaticReviewDisposition {
  if (input.outcome.state === "failed") return "failed";
  const match = object(input.outcome.match);
  if (match.kind === "ambiguous") return "archived_only";

  const automaticActionOperations = input.operations.filter(
    isAutomaticallyImportableAction,
  );
  if (automaticActionOperations.length === 0) return "archived_only";

  const identityLinks = automaticActionOperations.filter(
    (operation) => operation.action === "link_existing",
  );
  if (identityLinks.length > 0) {
    if (!identityLinks.every((operation) =>
      isAutomaticallyImportableForOutcome(operation, input.outcome))) {
      return "archived_only";
    }
    return isLegacyExactExternalLink(match) ? "safe_ready" : "auto_resolved";
  }

  return "safe_ready";
}
