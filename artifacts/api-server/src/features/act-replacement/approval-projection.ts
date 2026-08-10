export type ApprovalSnapshotMode = "safe" | "reviewed";

export const approvalIdentifierLimit = 200;
export const approvalJsonValueLimit = 16 * 1024;

type ProjectionState = { truncated: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function boundedIdentifier(value: unknown, state: ProjectionState) {
  if (typeof value !== "string") return value;
  if (value.length <= approvalIdentifierLimit) return value;
  state.truncated = true;
  return value.slice(0, approvalIdentifierLimit);
}

function boundedJsonValue(value: unknown, state: ProjectionState) {
  if (value === undefined) return undefined;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    state.truncated = true;
    return null;
  }
  if (Buffer.byteLength(serialized) <= approvalJsonValueLimit) return value;
  state.truncated = true;
  return null;
}

function projectRecord(
  value: unknown,
  identifiers: readonly string[],
  jsonValues: readonly string[],
  state: ProjectionState,
) {
  if (!isRecord(value)) return undefined;
  const projected: Record<string, unknown> = {};
  for (const key of identifiers) {
    if (key in value) projected[key] = boundedIdentifier(value[key], state);
  }
  for (const key of jsonValues) {
    if (key in value) projected[key] = boundedJsonValue(value[key], state);
  }
  return projected;
}

const proofIdentifiers = [
  "entityType",
  "entityId",
  "fieldName",
  "sourceVersionId",
  "expectedLocalValueFingerprint",
  "decisionId",
  "decision",
  "sourceValueFingerprint",
  "localValueFingerprint",
] as const;
const decisionIdentifiers = [
  "id",
  "sourceVersionId",
  "scope",
  "decision",
  "fieldName",
  "targetEntityType",
  "targetEntityId",
  "relationshipSlot",
  "reviewedSourceValueFingerprint",
  "reviewedLocalValueFingerprint",
] as const;

export function projectBoundedApprovalPayload(
  action: string,
  payload: Readonly<Record<string, unknown>>,
  mode: ApprovalSnapshotMode,
): Record<string, unknown> {
  const state: ProjectionState = { truncated: false };
  const projected: Record<string, unknown> = {};

  if (action === "link_existing") {
    projected.localId = boundedIdentifier(payload.localId, state);
  } else if (mode === "reviewed" && action === "overwrite_reviewed") {
    projected.entityId = boundedIdentifier(payload.entityId, state);
    projected.fieldName = boundedIdentifier(payload.fieldName, state);
    projected.value = boundedJsonValue(payload.value, state);
    projected.proof = projectRecord(payload.proof, proofIdentifiers, ["localValue", "sourceValue"], state);
    projected.decision = projectRecord(
      payload.decision,
      decisionIdentifiers,
      ["reviewedSourceValue", "reviewedLocalValue"],
      state,
    );
  } else if (mode === "reviewed" && action === "create_relationship") {
    projected.parentEntityId = boundedIdentifier(payload.parentEntityId, state);
    projected.parentType = boundedIdentifier(payload.parentType, state);
    projected.relationshipSlot = boundedIdentifier(payload.relationshipSlot, state);
    projected.decision = projectRecord(
      payload.decision,
      decisionIdentifiers,
      ["reviewedSourceValue", "reviewedLocalValue"],
      state,
    );
  }

  projected._approvalProjection = {
    mode,
    truncated: state.truncated,
    reviewedPayloadOmitted:
      mode === "safe"
      && (action === "overwrite_reviewed" || action === "create_relationship"),
  };
  return projected;
}

export function approvalProjectionIsIncomplete(
  payload: Readonly<Record<string, unknown>> | undefined,
): boolean {
  const marker = payload?._approvalProjection;
  return isRecord(marker)
    && (marker.truncated === true || marker.reviewedPayloadOmitted === true);
}
