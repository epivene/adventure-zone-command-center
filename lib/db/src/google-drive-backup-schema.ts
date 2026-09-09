import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { googleWorkspaceConnections } from "./google-workspace-schema";

export const googleDriveBackupStateValues = [
  "disabled",
  "preview",
  "pilot",
  "active",
  "paused",
  "reauthorization_required",
] as const;
export type GoogleDriveBackupState =
  (typeof googleDriveBackupStateValues)[number];

export const googleDriveBackupEntityKindValues = [
  "profile_summary",
  "follow_up_summary",
  "document",
] as const;
export type GoogleDriveBackupEntityKind =
  (typeof googleDriveBackupEntityKindValues)[number];

export const googleDriveBackupJobStatusValues = [
  "queued",
  "processing",
  "retry",
  "blocked",
  "failed",
  "succeeded",
] as const;
export type GoogleDriveBackupJobStatus =
  (typeof googleDriveBackupJobStatusValues)[number];

export const googleDriveBackupRunModeValues = [
  "preview",
  "pilot",
  "backfill",
] as const;
export type GoogleDriveBackupRunMode =
  (typeof googleDriveBackupRunModeValues)[number];

export const googleDriveBackupRunStateValues = [
  "planning",
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
] as const;
export type GoogleDriveBackupRunState =
  (typeof googleDriveBackupRunStateValues)[number];

export const googleDriveBackupConfig = pgTable(
  "google_drive_backup_config",
  {
    id: text("id").primaryKey().default("default"),
    connectionId: uuid("connection_id").references(
      () => googleWorkspaceConnections.id,
      { onDelete: "set null" },
    ),
    rootFolderName: text("root_folder_name")
      .default("Adventure Zone Command Center Backup")
      .notNull(),
    rootFolderId: text("root_folder_id"),
    rootWebViewLink: text("root_web_view_link"),
    state: text("state")
      .$type<GoogleDriveBackupState>()
      .default("disabled")
      .notNull(),
    successfulPilotAt: timestamp("successful_pilot_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("google_drive_backup_config_singleton", sql`${table.id} = 'default'`),
    check(
      "google_drive_backup_config_root_name",
      sql`${table.rootFolderName} = 'Adventure Zone Command Center Backup'`,
    ),
    check(
      "google_drive_backup_config_state_valid",
      sql`${table.state} in ('disabled','preview','pilot','active','paused','reauthorization_required')`,
    ),
  ],
);

export const googleDriveBackupRuns = pgTable(
  "google_drive_backup_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    mode: text("mode").$type<GoogleDriveBackupRunMode>().notNull(),
    state: text("state")
      .$type<GoogleDriveBackupRunState>()
      .default("planning")
      .notNull(),
    profileLimit: integer("profile_limit"),
    cursor: jsonb("cursor")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    counts: jsonb("counts")
      .$type<Record<string, number>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    createdBy: text("created_by").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("google_drive_backup_runs_state_created_idx").on(
      table.state,
      table.createdAt,
    ),
    check(
      "google_drive_backup_runs_mode_valid",
      sql`${table.mode} in ('preview','pilot','backfill')`,
    ),
    check(
      "google_drive_backup_runs_state_valid",
      sql`${table.state} in ('planning','queued','running','paused','completed','failed')`,
    ),
    check(
      "google_drive_backup_runs_profile_limit_valid",
      sql`${table.profileLimit} is null or (${table.profileLimit} between 1 and 25)`,
    ),
    check(
      "google_drive_backup_runs_cursor_object",
      sql`jsonb_typeof(${table.cursor}) = 'object'`,
    ),
    check(
      "google_drive_backup_runs_counts_object",
      sql`jsonb_typeof(${table.counts}) = 'object'`,
    ),
  ],
);

export const googleDriveBackupJobs = pgTable(
  "google_drive_backup_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityKind: text("entity_kind").$type<GoogleDriveBackupEntityKind>().notNull(),
    entityId: uuid("entity_id").notNull(),
    runId: uuid("run_id").references(() => googleDriveBackupRuns.id, {
      onDelete: "set null",
    }),
    priority: integer("priority").default(100).notNull(),
    requestGeneration: bigint("request_generation", { mode: "number" })
      .default(1)
      .notNull(),
    claimedGeneration: bigint("claimed_generation", { mode: "number" }),
    status: text("status")
      .$type<GoogleDriveBackupJobStatus>()
      .default("queued")
      .notNull(),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("google_drive_backup_jobs_entity_unique").on(
      table.entityKind,
      table.entityId,
    ),
    index("google_drive_backup_jobs_claim_idx").on(
      table.status,
      table.priority,
      table.nextAttemptAt,
      table.requestedAt,
    ),
    index("google_drive_backup_jobs_run_idx").on(table.runId, table.status),
    check(
      "google_drive_backup_jobs_entity_kind_valid",
      sql`${table.entityKind} in ('profile_summary','follow_up_summary','document')`,
    ),
    check(
      "google_drive_backup_jobs_status_valid",
      sql`${table.status} in ('queued','processing','retry','blocked','failed','succeeded')`,
    ),
    check(
      "google_drive_backup_jobs_priority_valid",
      sql`${table.priority} between 0 and 100`,
    ),
    check(
      "google_drive_backup_jobs_generation_positive",
      sql`${table.requestGeneration} > 0`,
    ),
    check(
      "google_drive_backup_jobs_attempts_nonnegative",
      sql`${table.attempts} >= 0`,
    ),
  ],
);

export const googleDriveBackupFolders = pgTable(
  "google_drive_backup_folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    logicalPath: text("logical_path").notNull(),
    driveFolderId: text("drive_folder_id").notNull(),
    parentLogicalPath: text("parent_logical_path"),
    parentDriveFolderId: text("parent_drive_folder_id").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("google_drive_backup_folders_path_unique").on(table.logicalPath),
    unique("google_drive_backup_folders_drive_id_unique").on(table.driveFolderId),
    check(
      "google_drive_backup_folders_identity_nonblank",
      sql`btrim(${table.logicalPath}) <> '' and btrim(${table.driveFolderId}) <> '' and btrim(${table.parentDriveFolderId}) <> ''`,
    ),
  ],
);

export const googleDriveBackupMappings = pgTable(
  "google_drive_backup_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityKind: text("entity_kind").$type<GoogleDriveBackupEntityKind>().notNull(),
    entityId: uuid("entity_id").notNull(),
    driveFileId: text("drive_file_id").notNull(),
    driveParentId: text("drive_parent_id").notNull(),
    logicalPath: text("logical_path").notNull(),
    sha256Hex: text("sha256_hex").notNull(),
    sourceVersion: text("source_version").notNull(),
    lastExportedAt: timestamp("last_exported_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    sourceRemovedAt: timestamp("source_removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("google_drive_backup_mappings_entity_unique").on(
      table.entityKind,
      table.entityId,
    ),
    unique("google_drive_backup_mappings_drive_id_unique").on(table.driveFileId),
    index("google_drive_backup_mappings_path_idx").on(table.logicalPath),
    check(
      "google_drive_backup_mappings_entity_kind_valid",
      sql`${table.entityKind} in ('profile_summary','follow_up_summary','document')`,
    ),
    check(
      "google_drive_backup_mappings_identity_nonblank",
      sql`btrim(${table.driveFileId}) <> '' and btrim(${table.driveParentId}) <> '' and btrim(${table.logicalPath}) <> '' and btrim(${table.sourceVersion}) <> ''`,
    ),
    check(
      "google_drive_backup_mappings_sha256_valid",
      sql`${table.sha256Hex} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
