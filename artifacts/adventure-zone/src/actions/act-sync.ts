// Client-side stubs for the Act! sync workflow (not yet ported to Express).
// These keep the review UI compiling by exposing the same result shapes and
// signatures the original server actions did, while returning a clear
// "not available" error at runtime.

import type {
  SyncApplyDecision,
  SyncApplyRowResult,
} from "@/features/act-sync/sync-service";

export type ActSyncActionResult =
  | { ok: true; runId: string; queueToken?: string }
  | { ok: false; error: string };

export type ActSyncApplyActionResult =
  | { ok: true; result: { runId: string; rows: SyncApplyRowResult[] } }
  | {
      ok: false;
      error: string;
      interruptedRow?: SyncApplyRowResult;
      processedRows?: SyncApplyRowResult[];
    };

const NOT_AVAILABLE = "Act! sync is not available in this environment yet.";

export async function testActConnectionAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  return { ok: false, error: NOT_AVAILABLE };
}

export async function createActSyncPreviewAction(): Promise<ActSyncActionResult> {
  return { ok: false, error: NOT_AVAILABLE };
}

export async function stageActSyncDecisionsAction(
  _runId: string,
  _decisions: readonly SyncApplyDecision[],
  _replaceExisting: boolean,
  _queueToken?: string,
): Promise<ActSyncActionResult> {
  return { ok: false, error: NOT_AVAILABLE };
}

export async function clearActSyncStagedDecisionsAction(
  _runId: string,
  _queueToken?: string,
): Promise<ActSyncActionResult> {
  return { ok: false, error: NOT_AVAILABLE };
}

export async function applyActSyncAction(
  _runId: string,
  _decisions: readonly SyncApplyDecision[],
  _queueToken?: string,
): Promise<ActSyncApplyActionResult> {
  return { ok: false, error: NOT_AVAILABLE };
}
