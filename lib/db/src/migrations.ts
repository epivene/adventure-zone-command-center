import { access, readFile } from "node:fs/promises";

const advisoryLockSql =
  "SELECT pg_advisory_lock(hashtext('adventure-zone:act-review-migrations'))";
const advisoryUnlockSql =
  "SELECT pg_advisory_unlock(hashtext('adventure-zone:act-review-migrations'))";

export interface ActReviewMigration {
  name: string;
  markerSql: string;
  sql: string;
}

interface MigrationClient {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
}

interface MigrationPool {
  connect(): Promise<MigrationClient>;
}

const migrationFiles = [
  {
    name: "014_act_review_bulk_decisions.sql",
    markerSql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'act_replacement_review_decisions'
        AND column_name = 'decided_by'
    ) AS ready`,
  },
  {
    name: "015_act_bulk_review_requests.sql",
    markerSql:
      "SELECT to_regclass(current_schema() || '.act_replacement_bulk_review_requests') IS NOT NULL AS ready",
  },
  {
    name: "016_act_review_conflict_proof.sql",
    markerSql: `SELECT COUNT(*) = 4 AS ready
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'act_replacement_review_decisions'
        AND column_name IN (
          'reviewed_source_value',
          'reviewed_source_value_fingerprint',
          'reviewed_local_value',
          'reviewed_local_value_fingerprint'
        )`,
  },
  {
    name: "017_act_relationship_parent_decisions.sql",
    markerSql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'act_replacement_review_decisions'
        AND column_name = 'relationship_slot'
    ) AS ready`,
  },
  {
    name: "018_act_review_decision_integrity.sql",
    markerSql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'act_replacement_review_decisions'
        AND column_name = 'request_fingerprint'
    ) AS ready`,
  },
  {
    name: "019_act_approval_provenance.sql",
    markerSql: `SELECT COUNT(*) = 2 AS ready
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'act_replacement_approval_requests'
        AND column_name IN ('approval_mode', 'approval_mode_version')`,
  },
  {
    name: "020_act_automatic_review_recovery.sql",
    markerSql: `SELECT COUNT(*) = 5 AS ready
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'act_replacement_bulk_review_requests'
        AND column_name IN (
          'expected_manifest_digest', 'automatic_summary', 'rebuild_state',
          'rebuild_token', 'rebuild_lease_expires_at'
        )`,
  },
  {
    name: "021_act_manifest_digest_version.sql",
    markerSql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'act_replacement_runs'
        AND column_name = 'manifest_digest_version'
    ) AS ready`,
  },
  {
    name: "020_assisted_calling.sql",
    markerSql: "SELECT to_regclass(current_schema() || '.contact_phones') IS NOT NULL AS ready",
  },
  {
    name: "021_call_session_metadata.sql",
    markerSql: `SELECT COUNT(*) = 6 AS ready
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'call_sessions'
        AND column_name IN ('phone_id', 'direction', 'method', 'phone_number_snapshot', 'phone_extension_snapshot', 'script_kind')`,
  },
  {
    name: "022_contact_phone_legacy_compatibility.sql",
    markerSql: `SELECT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'contacts_sync_primary_phone'
        AND NOT tgisinternal
    ) AS ready`,
  },
  {
    name: "023_contact_phone_canonical_dnc.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.contact_phones_contact_normalized_number_unique') IS NOT NULL
      AND to_regprocedure(current_schema() || '.normalize_north_american_phone(text)') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'contacts_normalize_legacy_phone'
          AND NOT tgisinternal
      )
      AND EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'contacts_sync_primary_phone'
          AND NOT tgisinternal
      ) AS ready`,
  },
  {
    name: "024_ai_booking_suggestions.sql",
    markerSql:
      "SELECT to_regclass(current_schema() || '.ai_booking_suggestions') IS NOT NULL AS ready",
  },
  {
    name: "022_act_manifest_generation.sql",
    markerSql: `SELECT COUNT(*) = 2 AS ready
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (
          (table_name = 'act_replacement_runs' AND column_name = 'manifest_generation')
          OR
          (table_name = 'act_replacement_apply_operations' AND column_name = 'manifest_generation')
        )`,
  },
  {
    name: "023_act_archive_profile_import.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.act_archive_profile_import_jobs') IS NOT NULL
      AND to_regclass(current_schema() || '.act_archive_profile_import_sources') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = to_regclass(current_schema() || '.act_external_links')
          AND conname = 'act_external_links_contact_primary_sync_valid'
          AND position('SOURCE_DATABASE_KEY IS NOT NULL' in upper(pg_get_constraintdef(oid))) > 0
          AND position('SOURCE_RECORD_ID IS NOT NULL' in upper(pg_get_constraintdef(oid))) > 0
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass(current_schema() || '.act_external_links')
          AND conname = 'act_external_links_archive_source_scope_fk'
      ) AS ready`,
  },
  {
    name: "023a_act_archive_profile_import_membership.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.act_archive_profile_import_sources') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = 'act_archive_profile_import_sources_job_phase_source_idx'
          AND position('(job_id, phase, source_record_id)' in lower(indexdef)) > 0
      )
      AND EXISTS (
        SELECT 1 FROM pg_index indexes
        WHERE indexes.indexrelid = to_regclass(current_schema() || '.act_archive_profile_import_sources_job_phase_source_idx')
          AND indexes.indisvalid
          AND NOT indexes.indisunique
          AND indexes.indpred IS NULL
          AND indexes.indnatts = 3
          AND pg_get_indexdef(indexes.indexrelid, 1, true) = 'job_id'
          AND pg_get_indexdef(indexes.indexrelid, 2, true) = 'phase'
          AND pg_get_indexdef(indexes.indexrelid, 3, true) = 'source_record_id'
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass(current_schema() || '.act_archive_profile_import_jobs')
          AND conname = 'act_archive_profile_import_jobs_id_database_unique'
          AND contype = 'u'
          AND position('UNIQUE (ID, SOURCE_DATABASE_KEY)' in upper(pg_get_constraintdef(oid))) > 0
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass(current_schema() || '.act_archive_profile_import_sources')
          AND conname = 'act_archive_profile_import_sources_pkey'
          AND contype = 'p'
          AND position('PRIMARY KEY (JOB_ID, SOURCE_RECORD_ID)' in upper(pg_get_constraintdef(oid))) > 0
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass(current_schema() || '.act_archive_profile_import_sources')
          AND conname = 'act_archive_profile_import_sources_job_id_fk'
          AND contype = 'f'
          AND confdeltype = 'c'
          AND position('FOREIGN KEY (JOB_ID)' in upper(pg_get_constraintdef(oid))) > 0
          AND position('REFERENCES ACT_ARCHIVE_PROFILE_IMPORT_JOBS(ID)' in upper(pg_get_constraintdef(oid))) > 0
          AND position('ON DELETE CASCADE' in upper(pg_get_constraintdef(oid))) > 0
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass(current_schema() || '.act_archive_profile_import_sources')
          AND conname = 'act_archive_profile_import_sources_source_record_id_fk'
          AND contype = 'f'
          AND confdeltype = 'c'
          AND position('FOREIGN KEY (SOURCE_RECORD_ID)' in upper(pg_get_constraintdef(oid))) > 0
          AND position('REFERENCES ACT_SOURCE_RECORDS(ID)' in upper(pg_get_constraintdef(oid))) > 0
          AND position('ON DELETE CASCADE' in upper(pg_get_constraintdef(oid))) > 0
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass(current_schema() || '.act_archive_profile_import_sources')
          AND conname = 'act_archive_profile_import_sources_source_version_id_fk'
          AND contype = 'f'
          AND confdeltype = 'c'
          AND position('FOREIGN KEY (SOURCE_VERSION_ID)' in upper(pg_get_constraintdef(oid))) > 0
          AND position('REFERENCES ACT_SOURCE_RECORD_VERSIONS(ID)' in upper(pg_get_constraintdef(oid))) > 0
          AND position('ON DELETE CASCADE' in upper(pg_get_constraintdef(oid))) > 0
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass(current_schema() || '.act_archive_profile_import_sources')
          AND conname = 'act_archive_profile_import_sources_phase_valid'
          AND contype = 'c'
          AND regexp_replace(
            lower(pg_get_expr(conbin, conrelid)), '[()[:space:]]', '', 'g'
          ) = 'phase=anyarray[''companies''::text,''contacts''::text]'
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass(current_schema() || '.act_archive_profile_import_sources')
          AND conname = 'act_archive_profile_import_sources_job_database_fk'
          AND contype = 'f'
          AND confdeltype = 'a'
          AND confupdtype = 'a'
          AND position('FOREIGN KEY (JOB_ID, SOURCE_DATABASE_KEY)' in upper(pg_get_constraintdef(oid))) > 0
          AND position('REFERENCES ACT_ARCHIVE_PROFILE_IMPORT_JOBS(ID, SOURCE_DATABASE_KEY)' in upper(pg_get_constraintdef(oid))) > 0
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass(current_schema() || '.act_archive_profile_import_sources')
          AND conname = 'act_archive_profile_import_sources_source_database_fk'
          AND contype = 'f'
          AND confdeltype = 'a'
          AND confupdtype = 'a'
          AND position('FOREIGN KEY (SOURCE_RECORD_ID, SOURCE_DATABASE_KEY)' in upper(pg_get_constraintdef(oid))) > 0
          AND position('REFERENCES ACT_SOURCE_RECORDS(ID, SOURCE_DATABASE_KEY, STREAM_TYPE)' in upper(pg_get_constraintdef(oid))) > 0
      ) AS ready`,
  },
  {
    name: "043_act_archive_full_recovery.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.act_archive_recovery_runs') IS NOT NULL
      AND to_regclass(current_schema() || '.act_archive_recovery_items') IS NOT NULL
      AND to_regclass(current_schema() || '.act_archive_recovery_decisions') IS NOT NULL
      AS ready`,
  },
  {
    name: "044_finance_admin_evidence.sql",
    markerSql: `SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'leg_expenses'
          AND column_name = 'assignment_source'
      )
      AND to_regclass(current_schema() || '.leg_finance_audit') IS NOT NULL
      AS ready`,
  },
  {
    name: "060_profile_photos.sql",
    markerSql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'organizations'
        AND column_name = 'profile_image_data_url'
    ) AS ready`,
  },
  {
    name: "20260825_lead_relationship_classification.sql",
    markerSql: `SELECT (
      (SELECT COUNT(*) = 9
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'lead_import_rows'
          AND column_name IN (
            'relationship_outcome',
            'relationship_anchor_at',
            'relationship_cutoff_date',
            'relationship_evidence_ids',
            'latest_outbound_at',
            'latest_verified_response_at',
            'relationship_review_required',
            'relationship_classified_at',
            'relationship_classified_by'
          ))
      AND (SELECT COUNT(*) = 3
        FROM pg_constraint
        WHERE conrelid = to_regclass(current_schema() || '.lead_import_rows')
          AND conname IN (
            'lead_import_rows_relationship_outcome_valid',
            'lead_import_rows_relationship_evidence_array',
            'lead_import_rows_relationship_classification_complete'
          ))
      AND to_regclass(current_schema() || '.lead_import_rows_relationship_outcome_idx') IS NOT NULL
    ) AS ready`,
  },
  {
    name: "20260825_lead_calendar_availability.sql",
    markerSql: `SELECT (
        select count(*) = 11 from information_schema.columns
        where table_schema = current_schema() and table_name = 'lead_availability_snapshots'
          and column_name = any(array['id','row_id','review_version','proposed_start_date','proposed_end_date','ready','checked_by','checked_at','selected_calendar_ids','source_events','reservations'])
      )
      and (select count(*) = 6 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and conname = any(array['lead_availability_snapshots_row_fk','lead_availability_snapshots_row_version_unique','lead_availability_snapshots_window_valid','lead_availability_snapshots_calendar_ids_array','lead_availability_snapshots_source_events_array','lead_availability_snapshots_reservations_array']))
      and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and contype = 'f' and confdeltype = 'r')
      and not exists (
        select 1 from information_schema.columns
        where table_schema = current_schema() and table_name = 'lead_availability_snapshots'
          and ((column_name in ('id','row_id') and data_type <> 'uuid')
            or (column_name = 'review_version' and data_type <> 'integer')
            or (column_name in ('proposed_start_date','proposed_end_date') and data_type <> 'date')
            or (column_name = 'ready' and data_type <> 'boolean')
            or (column_name = 'checked_by' and data_type <> 'text')
            or (column_name = 'checked_at' and data_type <> 'timestamp with time zone')
            or (column_name in ('selected_calendar_ids','source_events','reservations') and data_type <> 'jsonb'))
      )
      and not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'lead_availability_snapshots' and column_name = any(array['id','row_id','review_version','proposed_start_date','proposed_end_date','ready','checked_by','checked_at','selected_calendar_ids','source_events','reservations']) and is_nullable <> 'NO')
      and exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'lead_availability_snapshots' and column_name = 'id' and column_default like '%gen_random_uuid%')
      and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and contype = 'p' and pg_get_constraintdef(oid) like 'PRIMARY KEY (id)%')
      and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and conname = 'lead_availability_snapshots_row_fk' and contype = 'f' and confdeltype = 'r' and confrelid = to_regclass(current_schema() || '.lead_import_rows') and pg_get_constraintdef(oid) like 'FOREIGN KEY (row_id) REFERENCES %lead_import_rows(id)%')
      and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and conname = 'lead_availability_snapshots_row_version_unique' and contype = 'u' and replace(lower(pg_get_constraintdef(oid)), ' ', '') like 'unique(row_id,review_version)%')
      and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and conname = 'lead_availability_snapshots_window_valid' and contype = 'c' and replace(lower(pg_get_constraintdef(oid)), ' ', '') like '%proposed_end_date>=proposed_start_date%')
      and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and conname = 'lead_availability_snapshots_calendar_ids_array' and contype = 'c' and lower(pg_get_constraintdef(oid)) like '%jsonb_typeof(selected_calendar_ids)%array%')
      and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and conname = 'lead_availability_snapshots_source_events_array' and contype = 'c' and lower(pg_get_constraintdef(oid)) like '%jsonb_typeof(source_events)%array%')
      and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and conname = 'lead_availability_snapshots_reservations_array' and contype = 'c' and lower(pg_get_constraintdef(oid)) like '%jsonb_typeof(reservations)%array%')
      and exists (select 1 from pg_indexes where schemaname = current_schema() and indexname = 'lead_availability_snapshots_row_checked_idx' and position('(row_id, checked_at desc)' in lower(indexdef)) > 0) AS ready`,
  },
  {
    name: "20260826_lead_inventory_policy.sql",
    markerSql: `SELECT
      (SELECT count(*) = 2 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'package_templates'
         AND column_name IN ('normal_capacity', 'temporary_unavailable_quantity'))
      AND EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'lead_availability_snapshots'
         AND column_name = 'package_availability' AND data_type = 'jsonb')
      AND (SELECT count(*) = 3 FROM pg_constraint
       WHERE conrelid IN (to_regclass(current_schema() || '.package_templates'), to_regclass(current_schema() || '.lead_availability_snapshots'))
         AND conname IN ('package_templates_normal_capacity_nonnegative', 'package_templates_temporary_unavailable_quantity_nonnegative', 'lead_availability_snapshots_package_availability_object'))
      AS ready`,
  },
  {
    name: "20260828_booking_duplicate_consolidation.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.booking_consolidations') IS NOT NULL
      AND to_regclass(current_schema() || '.bookings_exact_event_identity_unique') IS NOT NULL
      AS ready`,
  },
  {
    name: "070_booking_opportunities.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.booking_opportunities') IS NOT NULL
      AND to_regclass(current_schema() || '.booking_opportunity_queue_overrides') IS NOT NULL
      AND to_regclass(current_schema() || '.booking_opportunities_organization_year_unique') IS NOT NULL
      AS ready`,
  },
  {
    name: "071_booking_opportunity_email_state.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.booking_opportunity_email_state') IS NOT NULL
      AND to_regclass(current_schema() || '.booking_opportunity_email_state_current_unique') IS NOT NULL
      AND to_regclass(current_schema() || '.booking_opportunity_email_state_send_request_unique') IS NOT NULL
      AND to_regclass(current_schema() || '.booking_opportunity_email_state_schedule_request_unique') IS NOT NULL
      AS ready`,
  },
] as const;

async function resolveMigrationDirectory(): Promise<URL> {
  const candidates = [
    new URL("../migrations/", import.meta.url),
    new URL("./migrations/", import.meta.url),
  ];

  for (const candidate of candidates) {
    try {
      await access(new URL(migrationFiles[0].name, candidate));
      return candidate;
    } catch {
      // Try the bundled production location next.
    }
  }

  throw new Error("Act review migration files are unavailable");
}

export async function loadActReviewMigrations(): Promise<ActReviewMigration[]> {
  const directory = await resolveMigrationDirectory();
  return Promise.all(
    migrationFiles.map(async ({ name, markerSql }) => ({
      name,
      markerSql,
      sql: await readFile(new URL(name, directory), "utf8"),
    })),
  );
}

export async function runActReviewMigrations(options?: {
  pool?: MigrationPool;
  migrations?: ActReviewMigration[];
}): Promise<string[]> {
  const migrationPool =
    options?.pool ?? (await import("./index")).pool;
  const migrations = options?.migrations ?? (await loadActReviewMigrations());
  const client = await migrationPool.connect();
  const applied: string[] = [];
  let locked = false;

  try {
    await client.query(advisoryLockSql);
    locked = true;

    for (const migration of migrations) {
      const marker = await client.query(migration.markerSql);
      if (marker.rows[0]?.["ready"] === true) continue;
      await client.query(migration.sql);
      applied.push(migration.name);
    }

    return applied;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (locked) {
      await client.query(advisoryUnlockSql).catch(() => undefined);
    }
    client.release();
  }
}
