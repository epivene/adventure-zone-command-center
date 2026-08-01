import type {
  MigrationPreviewQuery,
  StoredMigrationPreviewPage,
} from "@/features/act-migration/preview-repository";
import type { MigrationApplyCounts } from "@/features/act-migration/apply-repository";
import type { SnapshotProgress } from "@/features/act-migration/snapshot-repository";
import type { MigrationApplyBatchStatus } from "@/features/act-migration/migration-types";

// The Act! migration capture, preview, and apply services run against the Act!
// API and the application database. They are not yet ported to the Express
// backend, so the factory functions below throw a clear "not available" error
// at runtime. The exported types remain accurate so the review UI compiles and
// keeps the intended prop shapes.

export type StoredMigrationApplyState = {
  ready: boolean;
  summary: {
    approved: number;
    pending: number;
    blocked: number;
    ignored: number;
    applied: number;
    failed: number;
  };
  byTarget: Record<string, Record<string, number>>;
  bulkEligible: number;
  batch?: {
    id: string;
    status: MigrationApplyBatchStatus;
    counts: MigrationApplyCounts;
  };
};

export type StoredMigrationWorkspace = {
  progress: SnapshotProgress;
  preview: StoredMigrationPreviewPage | null;
  apply?: StoredMigrationApplyState;
};

export interface ActMigrationWorkspaceReader {
  getWorkspace(input: {
    runId?: string;
    query: MigrationPreviewQuery;
  }): Promise<StoredMigrationWorkspace | null>;
}

const NOT_AVAILABLE_MESSAGE =
  "Act! migration is not available in this environment yet.";

export async function createActMigrationCaptureService(): Promise<never> {
  throw new Error(NOT_AVAILABLE_MESSAGE);
}

export async function createActMigrationWorkspaceReader():
  Promise<ActMigrationWorkspaceReader> {
  return {
    async getWorkspace() {
      return null;
    },
  };
}

export async function createActMigrationPreviewService(): Promise<never> {
  throw new Error(NOT_AVAILABLE_MESSAGE);
}

export async function createActMigrationApplyService(): Promise<never> {
  throw new Error(NOT_AVAILABLE_MESSAGE);
}
