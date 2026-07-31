import { DrizzleLocalCandidateRepository } from "@/features/act-migration/local-candidate-repository";
import {
  DrizzleActMigrationPreviewRepository,
  type MigrationPreviewQuery,
  type StoredMigrationPreviewPage,
} from "@/features/act-migration/preview-repository";
import { ActMigrationPreviewService } from "@/features/act-migration/preview-service";
import { DrizzleActMigrationApplyRepository } from "@/features/act-migration/apply-repository";
import { ActMigrationApplyService } from "@/features/act-migration/apply-service";
import { MigrationCallingListApplyRepository } from "@/features/act-migration/calling-list-apply-repository";
import { MigrationEntityApplyRepository } from "@/features/act-migration/entity-apply-repository";
import { MigrationRelationshipApplyRepository } from "@/features/act-migration/relationship-apply-repository";
import {
  ActMigrationRunNotFoundError,
  DrizzleActMigrationSnapshotRepository,
  type SnapshotProgress,
} from "@/features/act-migration/snapshot-repository";
import { ActMigrationSnapshotService } from "@/features/act-migration/snapshot-service";
import { getActEnvironment } from "@/lib/env";

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

async function migrationDatabase() {
  return (await import("@/db/client")).db;
}

export async function createActMigrationCaptureService() {
  const environment = getActEnvironment();
  const [{ ActApiError }, { ActClient }, { HttpActMigrationSourceClient }] =
    await Promise.all([
      import("@/features/act-sync/act-errors"),
      import("@/features/act-sync/act-client"),
      import("@/features/act-migration/source-client"),
    ]);
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
      const preview = await previews.getPreviewIfStored(progress.runId, input.query);
      const reviewSummary = preview?.reviewSummary ?? {
        approved: 0,
        pending: 0,
        blocked: 0,
        ignored: 0,
        byTarget: {},
        bulkEligible: 0,
      };
      return {
        progress,
        preview,
        ...(preview
          ? {
              apply: {
                ready: progress.status === "previewed" && preview.report.complete,
                summary: {
                  ...reviewSummary,
                  applied: 0,
                  failed: reviewSummary.blocked,
                },
                byTarget: reviewSummary.byTarget,
                bulkEligible: reviewSummary.bulkEligible,
              },
            }
          : {}),
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

export async function createActMigrationApplyService() {
  const database = await migrationDatabase();
  const entities = new MigrationEntityApplyRepository(database);
  const relationships = new MigrationRelationshipApplyRepository(database);
  const callingLists = new MigrationCallingListApplyRepository(database);
  return new ActMigrationApplyService(
    new DrizzleActMigrationApplyRepository(database),
    {
      organization: {
        apply: (operation) => entities.applyOrganization(operation),
      },
      contact: {
        apply: (operation) => entities.applyContact(operation),
      },
      organization_contact: {
        apply: (operation) => relationships.applyOrganizationContact(operation),
      },
      booking: {
        apply: (operation) => relationships.applyBooking(operation),
      },
      booking_contact: {
        apply: (operation) => relationships.applyBookingContact(operation),
      },
      calling_list: {
        apply: (operation) => callingLists.applyCallingList(operation),
      },
      calling_list_member: {
        apply: (operation) => callingLists.applyMembership(operation),
      },
    },
  );
}
