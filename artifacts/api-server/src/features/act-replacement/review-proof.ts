import { fingerprintSourceContent } from "./source-fingerprint";
import { approvalProjectionIsIncomplete } from "./approval-projection";

type ReviewProofOperation = {
  action: string;
  sourceVersionId: string;
  targetType: string;
  payload: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const optionalValueMatches = (
  record: Record<string, unknown>,
  key: string,
  expected: unknown,
) => !(key in record)
  || fingerprintSourceContent({ value: record[key] }) === fingerprintSourceContent({ value: expected });

const optionalFingerprintMatches = (
  record: Record<string, unknown>,
  key: string,
  value: unknown,
) => !(key in record)
  || record[key] === fingerprintSourceContent({ value });

export function hasReviewedOverwriteProof(
  operation: ReviewProofOperation,
): boolean {
  if (approvalProjectionIsIncomplete(operation.payload)) return false;
  const proof = operation.payload.proof;
  const decision = operation.payload.decision;
  const targetEntityId = operation.payload.entityId;
  return operation.action === "overwrite_reviewed"
    && isRecord(proof)
    && "localValue" in proof
    && "sourceValue" in proof
    && proof.entityType === operation.targetType
    && proof.entityId === targetEntityId
    && proof.fieldName === operation.payload.fieldName
    && proof.sourceVersionId === operation.sourceVersionId
    && typeof proof.expectedLocalValueFingerprint === "string"
    && proof.expectedLocalValueFingerprint !== ""
    && proof.expectedLocalValueFingerprint === fingerprintSourceContent({ value: proof.localValue })
    && typeof proof.decisionId === "string"
    && proof.decisionId !== ""
    && proof.decision === "use_source"
    && fingerprintSourceContent({ value: proof.sourceValue }) === fingerprintSourceContent({ value: operation.payload.value })
    && isRecord(decision)
    && typeof decision.id === "string"
    && decision.id.trim() !== ""
    && decision.scope === "field_conflict"
    && decision.decision === "use_source"
    && proof.decisionId === decision.id
    && proof.decision === decision.decision
    && optionalValueMatches(decision, "reviewedSourceValue", proof.sourceValue)
    && optionalFingerprintMatches(decision, "reviewedSourceValueFingerprint", proof.sourceValue)
    && optionalValueMatches(decision, "reviewedLocalValue", proof.localValue)
    && optionalFingerprintMatches(decision, "reviewedLocalValueFingerprint", proof.localValue)
    && optionalFingerprintMatches(proof, "sourceValueFingerprint", proof.sourceValue)
    && optionalFingerprintMatches(proof, "localValueFingerprint", proof.localValue)
    && decision.sourceVersionId === operation.sourceVersionId
    && decision.fieldName === operation.payload.fieldName
    && decision.targetEntityType === operation.targetType
    && typeof targetEntityId === "string"
    && targetEntityId.trim() !== ""
    && decision.targetEntityId === targetEntityId;
}

export function isReviewedRelationship(
  operation: ReviewProofOperation,
): boolean {
  return operation.action === "create_relationship"
    && ("decision" in operation.payload
      || "parentEntityId" in operation.payload
      || "relationshipSlot" in operation.payload);
}

export function hasReviewedRelationshipProof(
  operation: ReviewProofOperation,
): boolean {
  if (approvalProjectionIsIncomplete(operation.payload)) return false;
  const decision = operation.payload.decision;
  return operation.action === "create_relationship"
    && isRecord(decision)
    && typeof decision.id === "string"
    && decision.id.trim() !== ""
    && decision.sourceVersionId === operation.sourceVersionId
    && decision.scope === "relationship"
    && decision.decision === "assign_parent"
    && typeof operation.payload.relationshipSlot === "string"
    && operation.payload.relationshipSlot !== ""
    && decision.relationshipSlot === operation.payload.relationshipSlot
    && typeof operation.payload.parentEntityId === "string"
    && operation.payload.parentEntityId !== ""
    && decision.targetEntityId === operation.payload.parentEntityId
    && typeof operation.payload.parentType === "string"
    && operation.payload.parentType !== ""
    && decision.targetEntityType === operation.payload.parentType
    && (decision.fieldName === undefined || decision.fieldName === null);
}
