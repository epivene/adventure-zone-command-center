// Client-side stubs for the Act! migration workflow.
// The full migration engine runs against the Act! API and is not yet ported
// to the Express backend. These stubs keep the review UI compiling; each
// action returns a clear "not available" error at runtime while exposing the
// same result shapes the original server actions did.

import type { SnapshotProgress } from "@/features/act-migration/snapshot-repository";
import type { StoredMigrationPreviewPage } from "@/features/act-migration/preview-repository";
import type { MigrationApplyCounts as QueueApplyCounts } from "@/features/act-migration/apply-repository";

export type ActMigrationActionError = {
  ok: false;
  error: string;
  retryable: boolean;
  retryAfter: string | null;
};

export type ActMigrationProgressActionResult =
  | {
      ok: true;
      changed: boolean;
      runId: string;
      progress: SnapshotProgress;
    }
  | ActMigrationActionError;

export type ActMigrationPreviewActionResult =
  | {
      ok: true;
      changed: boolean;
      runId: string;
      preview: StoredMigrationPreviewPage;
    }
  | ActMigrationActionError;

export type ActMigrationDecisionActionResult =
  | {
      ok: true;
      changed: boolean;
      runId: string;
      proposalKey: string;
    }
  | ActMigrationActionError;

export type ActMigrationBulkDecisionActionResult =
  | {
      ok: true;
      runId: string;
      changed: number;
      remaining: number;
    }
  | ActMigrationActionError;

export type ActMigrationApplyActionResult =
  | {
      ok: true;
      runId: string;
      batchId: string;
      changed: boolean;
      counts: QueueApplyCounts;
      retryable: boolean;
      retryAfter: string | null;
      errorCode: string | null;
    }
  | ActMigrationActionError;

const NOT_AVAILABLE: ActMigrationActionError = {
  ok: false,
  error: "Act! migration is not available in this environment yet.",
  retryable: false,
  retryAfter: null,
};

export async function startActMigrationAction(): Promise<ActMigrationProgressActionResult> {
  return NOT_AVAILABLE;
}
export async function continueActMigrationAction(): Promise<ActMigrationProgressActionResult> {
  return NOT_AVAILABLE;
}
export async function resumeActMigrationAction(): Promise<ActMigrationProgressActionResult> {
  return NOT_AVAILABLE;
}
export async function finalizeActMigrationPreviewAction(_input: unknown): Promise<ActMigrationPreviewActionResult> {
  return NOT_AVAILABLE;
}
export async function saveActMigrationDecisionAction(_input: unknown): Promise<ActMigrationDecisionActionResult> {
  return NOT_AVAILABLE;
}
export async function bulkReviewActMigrationAction(_input: unknown): Promise<ActMigrationBulkDecisionActionResult> {
  return NOT_AVAILABLE;
}
export async function startActMigrationApplyAction(_input: unknown): Promise<ActMigrationApplyActionResult> {
  return NOT_AVAILABLE;
}
export async function continueActMigrationApplyAction(_input: unknown): Promise<ActMigrationApplyActionResult> {
  return NOT_AVAILABLE;
}
export async function retryActMigrationApplyAction(_input: unknown): Promise<ActMigrationApplyActionResult> {
  return NOT_AVAILABLE;
}
