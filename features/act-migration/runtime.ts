import { ActClient } from "@/features/act-sync/act-client";
import { ActApiError } from "@/features/act-sync/act-errors";
import { DrizzleLocalCandidateRepository } from "@/features/act-migration/local-candidate-repository";
import {
  DrizzleActMigrationPreviewRepository,
  type MigrationPreviewQuery,
  type StoredMigrationPreviewPage,
} from "@/features/act-migration/preview-repository";
import { ActMigrationPreviewService } from "@/features/act-migration/preview-service";
import {
  ActMigrationRunNotFoundError,
  DrizzleActMigrationSnapshotRepository,
  type SnapshotProgress,
} from "@/features/act-migration/snapshot-repository";
import { ActMigrationSnapshotService } from "@/features/act-migration/snapshot-service";
import { HttpActMigrationSourceClient } from "@/features/act-migration/source-client";
import { getActEnvironment } from "@/lib/env";

export type StoredMigrationWorkspace = {
  progress: SnapshotProgress;
  preview: StoredMigrationPreviewPage | null;
};

export interface ActMigrationWorkspaceReader {
  getWorkspace(input: {
    runId?: string;
    query: MigrationPreviewQuery;
  }): Promise<StoredMigrationWorkspace | null>;
}

async function migrationDatabase() {
  return (await import("@/db/client")).db;
}

export async function createActMigrationCaptureService() {
  const environment = getActEnvironment();
  if (!environment.configured) {
    throw new ActApiError("not_configured", false);
  }
  const database = await migrationDatabase();
  const snapshots = new DrizzleActMigrationSnapshotRepository(database);
  const client = new HttpActMigrationSourceClient(
    new ActClient(environment.config),
  );
  return new ActMigrationSnapshotService(client, snapshots);
}

export async function createActMigrationWorkspaceReader():
  Promise<ActMigrationWorkspaceReader> {
  const database = await migrationDatabase();
  const snapshots = new DrizzleActMigrationSnapshotRepository(database);
  const previews = new DrizzleActMigrationPreviewRepository(database);
  return {
    async getWorkspace(input) {
      let progress: SnapshotProgress | null;
      try {
        progress = input.runId
          ? await snapshots.getProgress(input.runId)
          : await snapshots.getLatestProgress();
      } catch (error) {
        if (error instanceof ActMigrationRunNotFoundError) return null;
        throw error;
      }
      if (!progress) return null;
      return {
        progress,
        preview: await previews.getPreviewIfStored(
          progress.runId,
          input.query,
        ),
      };
    },
  };
}

export async function createActMigrationPreviewService() {
  const database = await migrationDatabase();
  return new ActMigrationPreviewService(
    new DrizzleActMigrationSnapshotRepository(database),
    new DrizzleLocalCandidateRepository(database),
    new DrizzleActMigrationPreviewRepository(database),
  );
}
