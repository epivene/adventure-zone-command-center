import type { BusinessDocumentStorage } from "../business-documents/business-document-storage";
import type { GoogleDriveBackupClient } from "../google-workspace/google-api-types";
import { renderFollowUpsPdf, renderProfileSummaryPdf } from "./google-drive-backup-pdf";
import { resolveDocumentBackupPath, resolveProfileBackupPath } from "./google-drive-backup-path-resolver";
import {
  type GoogleDriveBackupJob,
  PostgresGoogleDriveBackupRepository,
} from "./google-drive-backup-repository";
import type { GoogleDriveBackupSnapshotRepository } from "./google-drive-backup-snapshot-repository";
import type { GoogleDriveBackupDocumentRepository } from "./google-drive-backup-document-repository";
import {
  DriveContainmentError,
  GoogleDriveBackupDriveService,
} from "./google-drive-backup-drive-service";

type DriveConnectionFactory = {
  createDriveBackupClient(): Promise<{
    connectionId: string;
    client: GoogleDriveBackupClient;
  } | null>;
};

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error &&
      typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) {
    return error.message;
  }
  return "GOOGLE_DRIVE_BACKUP_EXPORT_FAILED";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown backup export error";
}

function isAuthorization(code: string): boolean {
  return /REAUTHORIZATION|AUTHORIZATION_REQUIRED|DRIVE_PERMISSION/.test(code);
}

function isRetryable(code: string): boolean {
  return /RETRYABLE|RATE_LIMIT|TIMEOUT|UNAVAILABLE/.test(code);
}

export type GoogleDriveBackupWorkerResult =
  "idle" | "exported" | "skipped" | "blocked" | "failed";

export class GoogleDriveBackupWorker {
  constructor(private readonly options: {
    workerId: string;
    repository: PostgresGoogleDriveBackupRepository;
    snapshots: GoogleDriveBackupSnapshotRepository;
    documents: GoogleDriveBackupDocumentRepository;
    storage: Pick<BusinessDocumentStorage, "get">;
    connections: DriveConnectionFactory;
    backfill?: { enqueueNextBatch(runId: string, now: Date): Promise<unknown> };
  }) {}

  private async sourceFor(job: GoogleDriveBackupJob, now: Date): Promise<{
    sourceVersion: string;
    path: ReturnType<typeof resolveProfileBackupPath> | ReturnType<typeof resolveDocumentBackupPath>;
    mimeType: string;
    bytes: Uint8Array;
  } | null> {
    if (job.entityKind === "profile_summary") {
      const snapshot = await this.options.snapshots.getProfileSnapshot(job.entityId, now);
      if (!snapshot) return null;
      return {
        sourceVersion: snapshot.sourceVersion,
        path: resolveProfileBackupPath({
          organizationId: job.entityId,
          displayName: snapshot.displayName,
          kind: "profile_summary",
        }),
        mimeType: "application/pdf",
        bytes: await renderProfileSummaryPdf(snapshot),
      };
    }
    if (job.entityKind === "follow_up_summary") {
      const snapshot = await this.options.snapshots.getFollowUpSnapshot(job.entityId, now);
      if (!snapshot) return null;
      return {
        sourceVersion: snapshot.sourceVersion,
        path: resolveProfileBackupPath({
          organizationId: job.entityId,
          displayName: snapshot.displayName,
          kind: "follow_up_summary",
        }),
        mimeType: "application/pdf",
        bytes: await renderFollowUpsPdf(snapshot),
      };
    }
    const source = await this.options.documents.getCurrent(job.entityId);
    if (!source) return null;
    const bytes = await this.options.storage.get(source.storageKey);
    if (!(bytes instanceof Uint8Array)) {
      throw new Error("GOOGLE_DRIVE_BACKUP_DOCUMENT_SOURCE_CORRUPT");
    }
    return {
      sourceVersion: source.sourceVersion,
      path: resolveDocumentBackupPath(source.pathInput),
      mimeType: source.mimeType,
      bytes,
    };
  }

  async runOnce(now: Date): Promise<GoogleDriveBackupWorkerResult> {
    const config = await this.options.repository.getConfig();
    if (!["pilot", "active"].includes(config.state) || !config.rootFolderId) {
      return "idle";
    }
    const job = await this.options.repository.claimNext(this.options.workerId, now);
    if (!job) return "idle";

    try {
      const source = await this.sourceFor(job, now);
      if (!source) {
        await this.options.repository.markSourceRemoved(job, now);
        return "skipped";
      }
      const connection = await this.options.connections.createDriveBackupClient();
      if (!connection || connection.connectionId !== config.connectionId) {
        throw new Error("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
      }
      const service = new GoogleDriveBackupDriveService({
        client: connection.client,
        repository: this.options.repository,
        rootFolderId: config.rootFolderId,
      });
      const result = await service.exportFile({
        entityKind: job.entityKind,
        entityId: job.entityId,
        sourceVersion: source.sourceVersion,
        path: source.path,
        mimeType: source.mimeType,
        bytes: source.bytes,
        now,
      });
      await this.options.repository.markSucceeded(job.id, job.claimedGeneration, now);
      if (job.runId) await this.options.backfill?.enqueueNextBatch(job.runId, now);
      return result.outcome === "unchanged" ? "skipped" : "exported";
    } catch (error) {
      const code = error instanceof DriveContainmentError
        ? error.code
        : errorCode(error);
      const message = errorMessage(error);
      if (isAuthorization(code)) {
        await this.options.repository.markBlocked(job.id, job.claimedGeneration, code, message, now);
        return "blocked";
      }
      if (isRetryable(code)) {
        await this.options.repository.markRetry(job.id, job.claimedGeneration, code, message, now);
        return "failed";
      }
      await this.options.repository.markFailed(job.id, job.claimedGeneration, code, message, now);
      return "failed";
    }
  }
}
