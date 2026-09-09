export type BackupEntityKind = "profile_summary" | "follow_up_summary" | "document";

export interface GoogleDriveBackupJob {
  id: string;
  entityKind: BackupEntityKind;
  entityId: string;
  requestGeneration: number;
  claimedGeneration: number;
  attempts: number;
  priority: number;
  runId: string | null;
}

export interface BackupMapping {
  entityKind: BackupEntityKind;
  entityId: string;
  driveFileId: string;
  driveParentId: string;
  logicalPath: string;
  sha256Hex: string;
  sourceVersion: string;
}

export interface BackupFolderMapping {
  logicalPath: string;
  driveFolderId: string;
  parentLogicalPath: string | null;
  parentDriveFolderId: string;
}

export interface GoogleDriveBackupConfigRecord {
  connectionId: string | null;
  rootFolderId: string | null;
  rootWebViewLink: string | null;
  state: "disabled" | "preview" | "pilot" | "active" | "paused" | "reauthorization_required";
}

type QueryResult = { rows: Array<Record<string, unknown>>; rowCount?: number | null };
export type GoogleDriveBackupSqlPool = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

function requiredText(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function job(row: Record<string, unknown> | undefined): GoogleDriveBackupJob | null {
  if (!row) return null;
  return {
    id: requiredText(row.id, "GOOGLE_DRIVE_BACKUP_JOB_INVALID"),
    entityKind: requiredText(row.entity_kind, "GOOGLE_DRIVE_BACKUP_JOB_INVALID") as BackupEntityKind,
    entityId: requiredText(row.entity_id, "GOOGLE_DRIVE_BACKUP_JOB_INVALID"),
    requestGeneration: Number(row.request_generation),
    claimedGeneration: Number(row.claimed_generation),
    attempts: Number(row.attempts),
    priority: Number(row.priority),
    runId: typeof row.run_id === "string" ? row.run_id : null,
  };
}

export class PostgresGoogleDriveBackupRepository {
  constructor(private readonly pool: GoogleDriveBackupSqlPool) {}

  async getConfig(): Promise<GoogleDriveBackupConfigRecord> {
    const result = await this.pool.query(
      `SELECT connection_id, root_folder_id, root_web_view_link, state
         FROM google_drive_backup_config WHERE id = 'default'`,
    );
    const row = result.rows[0];
    if (!row) throw new Error("GOOGLE_DRIVE_BACKUP_CONFIG_MISSING");
    return {
      connectionId: typeof row.connection_id === "string" ? row.connection_id : null,
      rootFolderId: typeof row.root_folder_id === "string" ? row.root_folder_id : null,
      rootWebViewLink: typeof row.root_web_view_link === "string" ? row.root_web_view_link : null,
      state: requiredText(row.state, "GOOGLE_DRIVE_BACKUP_CONFIG_INVALID") as GoogleDriveBackupConfigRecord["state"],
    };
  }

  async claimNext(workerId: string, now: Date): Promise<GoogleDriveBackupJob | null> {
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT id
           FROM google_drive_backup_jobs
          WHERE (
            (status IN ('queued','retry') AND next_attempt_at <= $2)
            OR (status = 'processing' AND lease_expires_at <= $2)
          )
          ORDER BY priority DESC, requested_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE google_drive_backup_jobs j
          SET status = 'processing',
              attempts = attempts + 1,
              claimed_generation = request_generation,
              locked_by = $1,
              locked_at = $2,
              lease_expires_at = $2 + interval '5 minutes',
              updated_at = $2
         FROM candidate
        WHERE j.id = candidate.id
       RETURNING j.*`,
      [workerId, now],
    );
    return job(result.rows[0]);
  }

  async getMapping(entityKind: BackupEntityKind, entityId: string): Promise<BackupMapping | null> {
    const result = await this.pool.query(
      `SELECT * FROM google_drive_backup_mappings
        WHERE entity_kind = $1 AND entity_id = $2 LIMIT 1`,
      [entityKind, entityId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      entityKind,
      entityId,
      driveFileId: requiredText(row.drive_file_id, "GOOGLE_DRIVE_BACKUP_MAPPING_INVALID"),
      driveParentId: requiredText(row.drive_parent_id, "GOOGLE_DRIVE_BACKUP_MAPPING_INVALID"),
      logicalPath: requiredText(row.logical_path, "GOOGLE_DRIVE_BACKUP_MAPPING_INVALID"),
      sha256Hex: requiredText(row.sha256_hex, "GOOGLE_DRIVE_BACKUP_MAPPING_INVALID"),
      sourceVersion: requiredText(row.source_version, "GOOGLE_DRIVE_BACKUP_MAPPING_INVALID"),
    };
  }

  async getFolder(logicalPath: string): Promise<BackupFolderMapping | null> {
    const result = await this.pool.query(
      `SELECT * FROM google_drive_backup_folders WHERE logical_path = $1 LIMIT 1`,
      [logicalPath],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      logicalPath,
      driveFolderId: requiredText(row.drive_folder_id, "GOOGLE_DRIVE_BACKUP_FOLDER_INVALID"),
      parentLogicalPath: typeof row.parent_logical_path === "string" ? row.parent_logical_path : null,
      parentDriveFolderId: requiredText(row.parent_drive_folder_id, "GOOGLE_DRIVE_BACKUP_FOLDER_INVALID"),
    };
  }

  async upsertFolder(input: BackupFolderMapping, now: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO google_drive_backup_folders (
         logical_path, drive_folder_id, parent_logical_path, parent_drive_folder_id,
         verified_at, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$5,$5)
       ON CONFLICT (logical_path) DO UPDATE SET
         drive_folder_id = EXCLUDED.drive_folder_id,
         parent_logical_path = EXCLUDED.parent_logical_path,
         parent_drive_folder_id = EXCLUDED.parent_drive_folder_id,
         verified_at = EXCLUDED.verified_at,
         updated_at = EXCLUDED.updated_at`,
      [input.logicalPath, input.driveFolderId, input.parentLogicalPath, input.parentDriveFolderId, now],
    );
  }

  async upsertMapping(input: BackupMapping, now: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO google_drive_backup_mappings (
         entity_kind, entity_id, drive_file_id, drive_parent_id, logical_path,
         sha256_hex, source_version, last_exported_at, source_removed_at,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$8,$8)
       ON CONFLICT (entity_kind, entity_id) DO UPDATE SET
         drive_file_id = EXCLUDED.drive_file_id,
         drive_parent_id = EXCLUDED.drive_parent_id,
         logical_path = EXCLUDED.logical_path,
         sha256_hex = EXCLUDED.sha256_hex,
         source_version = EXCLUDED.source_version,
         last_exported_at = EXCLUDED.last_exported_at,
         source_removed_at = NULL,
         updated_at = EXCLUDED.updated_at`,
      [input.entityKind, input.entityId, input.driveFileId, input.driveParentId,
       input.logicalPath, input.sha256Hex, input.sourceVersion, now],
    );
  }

  async markSucceeded(id: string, claimedGeneration: number, now: Date): Promise<void> {
    await this.pool.query(
      `WITH finished_job AS (
         UPDATE google_drive_backup_jobs
            SET status = CASE WHEN request_generation = $2 THEN 'succeeded' ELSE 'queued' END,
                next_attempt_at = CASE WHEN request_generation = $2 THEN next_attempt_at ELSE $3 END,
                completed_at = CASE WHEN request_generation = $2 THEN $3 ELSE NULL END,
                locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
                last_error_code = NULL, last_error_message = NULL, updated_at = $3
          WHERE id = $1 AND status = 'processing' AND claimed_generation = $2
          RETURNING run_id
       ), completed_run AS (
         UPDATE google_drive_backup_runs r
            SET state = 'completed', finished_at = $3, updated_at = $3
          WHERE r.id = (SELECT run_id FROM finished_job)
            AND r.mode = 'pilot'
            AND NOT EXISTS (
              SELECT 1 FROM google_drive_backup_jobs j
               WHERE j.run_id = r.id AND j.status <> 'succeeded'
            )
          RETURNING mode
       )
       UPDATE google_drive_backup_config c
          SET successful_pilot_at = $3, state = 'paused', updated_at = $3
        WHERE c.id = 'default' AND EXISTS (SELECT 1 FROM completed_run)`,
      [id, claimedGeneration, now],
    );
  }

  async markRetry(id: string, claimedGeneration: number, code: string, message: string, now: Date): Promise<void> {
    const safeMessage = message.slice(0, 500);
    await this.pool.query(
      `UPDATE google_drive_backup_jobs
          SET status = CASE
                WHEN request_generation <> $2 THEN 'queued'
                WHEN attempts >= 10 THEN 'failed'
                ELSE 'retry'
              END,
              next_attempt_at = CASE WHEN request_generation <> $2 THEN $5
                ELSE $5 + make_interval(secs => LEAST(3600, 15 * power(2, LEAST(attempts, 8))::int))
              END,
              completed_at = CASE WHEN request_generation = $2 AND attempts >= 10 THEN $5 ELSE NULL END,
              locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
              last_error_code = $3, last_error_message = $4, updated_at = $5
        WHERE id = $1 AND status = 'processing' AND claimed_generation = $2`,
      [id, claimedGeneration, code, safeMessage, now],
    );
  }

  async markBlocked(id: string, claimedGeneration: number, code: string, message: string, now: Date): Promise<void> {
    await this.finish(id, claimedGeneration, "blocked", code, message, now);
    await this.pool.query(
      `UPDATE google_drive_backup_config
          SET state = 'reauthorization_required', last_error_code = $1,
              last_error_message = $2, updated_at = $3
        WHERE id = 'default'`,
      [code, message.slice(0, 500), now],
    );
  }

  async markFailed(id: string, claimedGeneration: number, code: string, message: string, now: Date): Promise<void> {
    await this.finish(id, claimedGeneration, "failed", code, message, now);
  }

  private async finish(id: string, generation: number, status: "blocked" | "failed", code: string, message: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE google_drive_backup_jobs
          SET status = CASE WHEN request_generation = $2 THEN $3 ELSE 'queued' END,
              next_attempt_at = CASE WHEN request_generation = $2 THEN next_attempt_at ELSE $6 END,
              completed_at = CASE WHEN request_generation = $2 THEN $6 ELSE NULL END,
              locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
              last_error_code = $4, last_error_message = $5, updated_at = $6
        WHERE id = $1 AND status = 'processing' AND claimed_generation = $2`,
      [id, generation, status, code, message.slice(0, 500), now],
    );
  }

  async markSourceRemoved(job: GoogleDriveBackupJob, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE google_drive_backup_mappings SET source_removed_at = $3, updated_at = $3
        WHERE entity_kind = $1 AND entity_id = $2`,
      [job.entityKind, job.entityId, now],
    );
    await this.markSucceeded(job.id, job.claimedGeneration, now);
  }

  async retryFailed(now: Date): Promise<number> {
    const result = await this.pool.query(
      `UPDATE google_drive_backup_jobs
          SET status = 'queued', attempts = 0, next_attempt_at = $1,
              completed_at = NULL, last_error_code = NULL,
              last_error_message = NULL, updated_at = $1
        WHERE status IN ('failed','blocked')
       RETURNING id`,
      [now],
    );
    return result.rowCount ?? result.rows.length;
  }
}
