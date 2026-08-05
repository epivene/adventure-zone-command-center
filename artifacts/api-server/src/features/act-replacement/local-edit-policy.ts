import { fingerprintSourceContent } from "./source-fingerprint";

export type LocalFieldState = { entityType: string; entityId: string; fieldName: string; value: unknown; importedFingerprint?: string | null };
export type OverwriteProof = { entityType: string; entityId: string; fieldName: string; sourceVersionId: string; expectedLocalValueFingerprint: string; decisionId: string; decision: "use_source"; sourceValue: unknown };

export function localValueFingerprint(value: unknown): string { return fingerprintSourceContent({ value }); }
export function canFillMissing(value: unknown): boolean { return value === null || value === undefined || value === ""; }
export function verifyOverwrite(input: { local: LocalFieldState; proof: OverwriteProof; expectedSourceVersionId: string; decision?: { id: string; sourceVersionId: string; scope: "field_conflict"; decision: string; fieldName: string; targetEntityType?: string | null; targetEntityId?: string | null } }): { ok: true } | { ok: false; code: string } {
  const { local, proof, decision } = input;
  if (!decision || decision.id !== proof.decisionId || decision.scope !== "field_conflict" || decision.decision !== proof.decision || decision.sourceVersionId !== input.expectedSourceVersionId) return { ok: false, code: "overwrite_decision_invalid" };
  if (decision.fieldName !== proof.fieldName || decision.targetEntityType !== proof.entityType || decision.targetEntityId !== proof.entityId) return { ok: false, code: "overwrite_target_invalid" };
  if (proof.sourceVersionId !== input.expectedSourceVersionId) return { ok: false, code: "source_version_stale" };
  if (localValueFingerprint(local.value) !== proof.expectedLocalValueFingerprint) return { ok: false, code: "local_edit_detected" };
  return { ok: true };
}
