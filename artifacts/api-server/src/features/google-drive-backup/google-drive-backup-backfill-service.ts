import type { BusinessDocumentCategory } from "@workspace/db";
import { resolveDocumentBackupPath, resolveProfileBackupPath } from "./google-drive-backup-path-resolver";
import type { GoogleDriveBackupSqlPool } from "./google-drive-backup-repository";

export interface BackupPreview {
  profileCount: number;
  followUpPdfCount: number;
  documentCount: number;
  needsFilingCount: number;
  byYear: Record<string, number>;
  byDocumentType: Record<string, number>;
  samplePaths: readonly string[];
  warnings: readonly string[];
}

export interface BackupRun {
  id: string;
  mode: "pilot" | "backfill";
  state: "queued" | "running" | "paused" | "completed" | "failed";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function run(row: Record<string, unknown> | undefined): BackupRun {
  if (!row) throw new Error("GOOGLE_DRIVE_BACKUP_RUN_SAVE_FAILED");
  return { id: text(row.id), mode: text(row.mode) as BackupRun["mode"], state: text(row.state) as BackupRun["state"] };
}

export class GoogleDriveBackupBackfillService {
  constructor(private readonly pool: GoogleDriveBackupSqlPool) {}

  private async profiles() {
    return (await this.pool.query(
      `SELECT o.id, o.name, o.updated_at
         FROM organizations o
        WHERE o.consolidated_into_id IS NULL
        ORDER BY o.updated_at DESC, o.id`,
    )).rows;
  }

  private async documents() {
    return (await this.pool.query(
      `SELECT d.id, d.display_name, d.original_filename, d.category,
              d.effective_date, d.issue_date, d.created_at,
              COALESCE(l.organization_id, b.organization_id) AS organization_id,
              o.name AS organization_name, b.starts_at AS booking_starts_at
         FROM business_documents d
         LEFT JOIN LATERAL (
           SELECT organization_id, booking_id
             FROM business_document_links
            WHERE document_id = d.id
            ORDER BY (organization_id IS NOT NULL) DESC, created_at, id LIMIT 1
         ) l ON true
         LEFT JOIN bookings b ON b.id = l.booking_id
         LEFT JOIN organizations o
           ON o.id = COALESCE(l.organization_id, b.organization_id)
        WHERE d.lifecycle <> 'deleted'
        ORDER BY d.updated_at DESC, d.id`,
    )).rows;
  }

  async preview(_now: Date): Promise<BackupPreview> {
    const [profiles, documents] = await Promise.all([this.profiles(), this.documents()]);
    const samplePaths: string[] = [];
    for (const profile of profiles.slice(0, 25)) {
      const organizationId = text(profile.id);
      const displayName = text(profile.name) || "Unnamed profile";
      for (const kind of ["profile_summary", "follow_up_summary"] as const) {
        if (samplePaths.length < 50) samplePaths.push(resolveProfileBackupPath({ organizationId, displayName, kind }).logicalPath);
      }
    }
    const byYear: Record<string, number> = {};
    const byDocumentType: Record<string, number> = {};
    let needsFilingCount = 0;
    for (const document of documents) {
      const path = resolveDocumentBackupPath({
        documentId: text(document.id),
        displayName: text(document.display_name) || "Unnamed document",
        originalFilename: text(document.original_filename) || "document",
        category: (text(document.category) || "other") as BusinessDocumentCategory,
        organizationId: text(document.organization_id) || null,
        organizationName: text(document.organization_name) || null,
        effectiveDate: text(document.effective_date) || null,
        bookingStartsAt: text(document.booking_starts_at) || null,
        issueDate: text(document.issue_date) || null,
        createdAt: text(document.created_at) || null,
      });
      const year = path.directories[1]!;
      const type = path.directories[2]!;
      byYear[year] = (byYear[year] ?? 0) + 1;
      byDocumentType[type] = (byDocumentType[type] ?? 0) + 1;
      if (year === "Needs Filing") needsFilingCount += 1;
      if (samplePaths.length < 50) samplePaths.push(path.logicalPath);
    }
    return {
      profileCount: profiles.length,
      followUpPdfCount: profiles.length,
      documentCount: documents.length,
      needsFilingCount,
      byYear,
      byDocumentType,
      samplePaths,
      warnings: needsFilingCount ? [`${needsFilingCount} document(s) need a filing year.`] : [],
    };
  }

  async startPilot(input: { profileLimit: number; now: Date; createdBy: string }): Promise<BackupRun> {
    if (!Number.isInteger(input.profileLimit) || input.profileLimit < 1 || input.profileLimit > 25) {
      throw new Error("GOOGLE_DRIVE_BACKUP_PILOT_LIMIT_INVALID");
    }
    const result = await this.pool.query(
      `WITH created AS (
         INSERT INTO google_drive_backup_runs (
           mode, state, profile_limit, created_by, started_at, created_at, updated_at
         ) VALUES ('pilot','queued',$1,$2,$3,$3,$3) RETURNING *
       ), configured AS (
         UPDATE google_drive_backup_config
            SET state = 'pilot', updated_at = $3 WHERE id = 'default'
       ) SELECT * FROM created`,
      [input.profileLimit, input.createdBy, input.now],
    );
    const created = run(result.rows[0]);
    await this.enqueueNextBatch(created.id, input.now);
    return { ...created, state: "running" };
  }

  async startBackfill(input: { now: Date; createdBy: string }): Promise<BackupRun> {
    const result = await this.pool.query(
      `WITH eligible AS (
         SELECT 1 FROM google_drive_backup_config
          WHERE id = 'default' AND successful_pilot_at IS NOT NULL
            AND root_folder_id IS NOT NULL
       ), created AS (
         INSERT INTO google_drive_backup_runs (
           mode, state, created_by, started_at, created_at, updated_at
         ) SELECT 'backfill','queued',$1,$2,$2,$2 FROM eligible RETURNING *
       ), configured AS (
         UPDATE google_drive_backup_config
            SET state = 'active', updated_at = $2
          WHERE EXISTS (SELECT 1 FROM created) AND id = 'default'
       ) SELECT * FROM created`,
      [input.createdBy, input.now],
    );
    if (!result.rows[0]) throw new Error("GOOGLE_DRIVE_BACKUP_PILOT_REQUIRED");
    const created = run(result.rows[0]);
    await this.enqueueNextBatch(created.id, input.now);
    return { ...created, state: "running" };
  }

  async pause(now: Date): Promise<BackupRun> {
    const result = await this.pool.query(
      `WITH changed AS (
         UPDATE google_drive_backup_runs SET state = 'paused', updated_at = $1
          WHERE state IN ('queued','running') RETURNING *
       ), configured AS (
         UPDATE google_drive_backup_config SET state = 'paused', updated_at = $1
          WHERE EXISTS (SELECT 1 FROM changed) AND id = 'default'
       ) SELECT * FROM changed ORDER BY created_at DESC LIMIT 1`,
      [now],
    );
    return run(result.rows[0]);
  }

  async resume(now: Date): Promise<BackupRun> {
    const result = await this.pool.query(
      `WITH changed AS (
         UPDATE google_drive_backup_runs SET state = 'running', updated_at = $1
          WHERE state = 'paused' RETURNING *
       ), configured AS (
         UPDATE google_drive_backup_config SET state = 'active', updated_at = $1
          WHERE EXISTS (SELECT 1 FROM changed) AND id = 'default'
       ) SELECT * FROM changed ORDER BY created_at DESC LIMIT 1`,
      [now],
    );
    return run(result.rows[0]);
  }

  async enqueueNextBatch(runId: string, now: Date): Promise<{ enqueued: number; completed: boolean }> {
    const result = await this.pool.query(
      `WITH selected_profiles AS (
         SELECT o.id, o.updated_at
           FROM organizations o
           JOIN google_drive_backup_runs r ON r.id = $1
          WHERE o.consolidated_into_id IS NULL
            AND r.state IN ('queued','running')
            AND (
              SELECT count(*) FROM google_drive_backup_jobs pending
               WHERE pending.run_id = r.id
                 AND pending.status IN ('queued','retry','processing')
            ) < 100
            AND (r.mode <> 'pilot' OR
              o.id IN (
                SELECT p.id FROM organizations p
                 WHERE p.consolidated_into_id IS NULL
                 ORDER BY p.updated_at DESC, p.id LIMIT r.profile_limit
              ))
            AND (
              COALESCE(r.cursor->>'updatedAt','') = ''
              OR (o.updated_at, o.id) < (
                (r.cursor->>'updatedAt')::timestamptz,
                (r.cursor->>'id')::uuid
              )
            )
          ORDER BY o.updated_at DESC, o.id DESC
          LIMIT 100
       ), profile_jobs AS (
         SELECT enqueue_google_drive_backup_job(kind::text, p.id, 10, $1)
           FROM selected_profiles p
           CROSS JOIN (VALUES ('profile_summary'),('follow_up_summary')) kinds(kind)
       ), document_jobs AS (
         SELECT enqueue_google_drive_backup_job('document', l.document_id, 10, $1)
           FROM business_document_links l
           LEFT JOIN bookings linked_booking ON linked_booking.id = l.booking_id
           JOIN selected_profiles p
             ON p.id = COALESCE(l.organization_id, linked_booking.organization_id)
           JOIN business_documents d ON d.id = l.document_id AND d.lifecycle <> 'deleted'
       ), tail AS (
         SELECT id, updated_at FROM selected_profiles
          ORDER BY updated_at ASC, id ASC LIMIT 1
       ), updated AS (
         UPDATE google_drive_backup_runs r SET
           state = CASE
             WHEN NOT EXISTS (SELECT 1 FROM selected_profiles)
              AND NOT EXISTS (
                SELECT 1 FROM google_drive_backup_jobs j
                 WHERE j.run_id = r.id AND j.status <> 'succeeded'
              )
             THEN 'completed' ELSE 'running' END,
           cursor = COALESCE((SELECT jsonb_build_object('updatedAt',updated_at,'id',id) FROM tail), r.cursor),
           finished_at = CASE
             WHEN NOT EXISTS (SELECT 1 FROM selected_profiles)
              AND NOT EXISTS (
                SELECT 1 FROM google_drive_backup_jobs j
                 WHERE j.run_id = r.id AND j.status <> 'succeeded'
              )
             THEN $2 ELSE NULL END,
           updated_at = $2
         WHERE r.id = $1 RETURNING state
       )
       SELECT (
                (SELECT count(*) FROM profile_jobs) +
                (SELECT count(*) FROM document_jobs)
              )::int AS enqueued,
              (SELECT state = 'completed' FROM updated) AS completed`,
      [runId, now],
    );
    const row = result.rows[0] ?? {};
    return { enqueued: Number(row.enqueued ?? 0), completed: row.completed === true };
  }
}
