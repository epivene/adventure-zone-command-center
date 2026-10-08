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
    markerSql:
      "SELECT to_regclass(current_schema() || '.contact_phones') IS NOT NULL AS ready",
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
  {
    name: "072_booking_opportunity_email_dispatch.sql",
    markerSql: `SELECT COUNT(*) = 3 AS ready
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'booking_opportunity_email_state'
        AND column_name IN (
          'dispatch_lease_owner',
          'dispatch_lease_expires_at',
          'dispatch_attempt_count'
        )`,
  },
  {
    name: "073_booking_opportunity_email_controls.sql",
    markerSql: `SELECT COUNT(*) = 2 AS ready
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'booking_opportunities'
        AND column_name IN (
          'email_automation_protected',
          'territory_exception_approved'
        )`,
  },
  {
    name: "20260903_website_inquiry_inbox.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.website_inquiries') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'office_accounts'
          AND column_name = 'can_review_website_inquiries'
      ) AS ready`,
  },
  {
    name: "20260905_boss_workspace.sql",
    markerSql:
      "SELECT to_regclass(current_schema() || '.boss_assignments') IS NOT NULL AS ready",
  },
  {
    name: "20260906_adobe_contracts.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.contract_agreements') IS NOT NULL
      AND to_regclass(current_schema() || '.contract_provider_events') IS NOT NULL
      AS ready`,
  },
  {
    name: "20260907_marketing_campaigns.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.marketing_audiences') IS NOT NULL
      AND to_regclass(current_schema() || '.marketing_audience_members') IS NOT NULL
      AND to_regclass(current_schema() || '.marketing_campaigns') IS NOT NULL
      AND to_regclass(current_schema() || '.marketing_campaign_recipients') IS NOT NULL
      AND to_regclass(current_schema() || '.marketing_campaign_deliveries') IS NOT NULL
      AND to_regclass(current_schema() || '.marketing_campaign_events') IS NOT NULL
      AND (SELECT COUNT(*) = 2 FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'marketing_campaigns'
             AND column_name IN ('subject_template', 'body_template'))
      AS ready`,
  },
  {
    name: "20260907_coi_expiration.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.design_certificates') IS NOT NULL
      AND to_regclass(current_schema() || '.design_certificates_asset_unique') IS NOT NULL
      AS ready`,
  },
  {
    name: "20260908_contract_builder.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.contract_templates') IS NOT NULL
      AND to_regclass(current_schema() || '.contract_settings') IS NOT NULL
      AND to_regclass(current_schema() || '.contract_drafts') IS NOT NULL
      AND to_regclass(current_schema() || '.contract_versions') IS NOT NULL
      AND to_regclass(current_schema() || '.contract_files') IS NOT NULL
      AND to_regclass(current_schema() || '.contract_status_events') IS NOT NULL
      AND to_regclass(current_schema() || '.contract_coi_drafts') IS NOT NULL
      AS ready`,
  },
  {
    name: "20260908a_contract_template_v1.sql",
    markerSql: `SELECT EXISTS (
      SELECT 1 FROM contract_templates
      WHERE stable_key = 'adventure-zone-standard'
        AND version = 1
        AND state = 'active'
    ) AS ready`,
  },
  {
    name: "20260909b_boss_work_requests.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.boss_work_requests') IS NOT NULL
      AND to_regclass(current_schema() || '.boss_convention_submissions') IS NOT NULL
      AND to_regclass(current_schema() || '.communication_template_reviews') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'communication_templates'
          AND column_name = 'body_format'
      ) AS ready`,
  },
  {
    name: "20260909_early_bird_promo.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.early_bird_promo_enrollments') IS NOT NULL
      AND to_regclass(current_schema() || '.early_bird_promo_offer_org_year_unique') IS NOT NULL
      AND (SELECT COUNT(*) = 2
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'early_bird_promo_enrollments'
          AND column_name IN ('claim_lease_owner', 'claim_lease_expires_at'))
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'office_email_drafts'
          AND column_name = 'office_account_id'
          AND is_nullable = 'YES'
      ) AS ready`,
  },
  {
    name: "20260909_outreach_planner.sql",
    markerSql: `SELECT
      (SELECT count(*) = 5 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('outreach_openings','outreach_candidates','outreach_attempts','outreach_research_tasks','outreach_audit'))
      AND NOT EXISTS (SELECT 1 FROM (VALUES ('outreach_openings','id'),('outreach_openings','title'),('outreach_openings','event_year'),('outreach_openings','starts_on'),('outreach_openings','ends_on'),('outreach_openings','leg_id'),('outreach_openings','quantities'),('outreach_openings','created_at'),('outreach_openings','status'),('outreach_candidates','id'),('outreach_candidates','opening_id'),('outreach_candidates','opportunity_id'),('outreach_candidates','tier'),('outreach_candidates','manual_rank'),('outreach_candidates','decision_due_at'),('outreach_candidates','meaningful_reply_at'),('outreach_candidates','convention_ends_on'),('outreach_candidates','released_at'),('outreach_candidates','checked_at'),('outreach_candidates','source_snapshot'),('outreach_candidates','created_at'),('outreach_candidates','history_review'),('outreach_attempts','id'),('outreach_attempts','candidate_id'),('outreach_attempts','source_id'),('outreach_attempts','stage'),('outreach_attempts','occurred_at'),('outreach_attempts','actor'),('outreach_attempts','created_at'),('outreach_research_tasks','id'),('outreach_research_tasks','opening_id'),('outreach_research_tasks','criteria'),('outreach_research_tasks','status'),('outreach_research_tasks','created_at'),('outreach_research_tasks','results'),('outreach_audit','id'),('outreach_audit','actor'),('outreach_audit','action'),('outreach_audit','entity_id'),('outreach_audit','detail'),('outreach_audit','created_at')) expected(table_name,column_name) LEFT JOIN information_schema.columns actual ON actual.table_schema=current_schema() AND actual.table_name=expected.table_name AND actual.column_name=expected.column_name WHERE actual.column_name IS NULL)
      AND (SELECT count(*) = 5 FROM pg_indexes WHERE schemaname = current_schema() AND indexname IN ('outreach_candidates_membership_unique','outreach_candidates_live_opportunity_unique','outreach_attempts_source_unique','outreach_attempts_stage_unique','outreach_research_criteria_unique'))
      AND (SELECT count(*) = 6 FROM pg_constraint WHERE connamespace = current_schema()::regnamespace AND conname IN ('outreach_openings_status_valid','outreach_openings_window_valid','outreach_openings_quantities_valid','outreach_candidates_rank_valid','outreach_candidates_tier_valid','outreach_attempts_stage_valid'))
      AND (SELECT count(*) = 5 FROM pg_constraint WHERE contype='f' AND conrelid IN (to_regclass(current_schema() || '.outreach_openings'),to_regclass(current_schema() || '.outreach_candidates'),to_regclass(current_schema() || '.outreach_attempts'),to_regclass(current_schema() || '.outreach_research_tasks')))
      AS ready`,
  },
  {
    name: "20260909_outreach_allocation.sql",
    markerSql: `SELECT
      (SELECT count(*)=3 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN ('outreach_allocation_mutex','outreach_booking_demand','outreach_holds'))
      AND NOT EXISTS (SELECT 1 FROM (VALUES ('outreach_allocation_mutex','generation'),('outreach_booking_demand','facts_fingerprint'),('outreach_booking_demand','quantities'),('outreach_booking_demand','resource_ids'),('outreach_booking_demand','revision'),('outreach_booking_demand','actor'),('outreach_booking_demand','reason'),('outreach_booking_demand','updated_at'),('outreach_holds','candidate_id'),('outreach_holds','booking_id'),('outreach_holds','opportunity_id'),('outreach_holds','leg_id'),('outreach_holds','event_starts_on'),('outreach_holds','event_ends_on'),('outreach_holds','starts_on'),('outreach_holds','ends_on'),('outreach_holds','quantities'),('outreach_holds','resource_ids'),('outreach_holds','location'),('outreach_holds','demand_fingerprint'),('outreach_holds','revision'),('outreach_holds','state'),('outreach_holds','owner'),('outreach_holds','expires_at'),('outreach_holds','ended_at'),('outreach_holds','created_at')) expected(table_name,column_name) LEFT JOIN information_schema.columns actual ON actual.table_schema=current_schema() AND actual.table_name=expected.table_name AND actual.column_name=expected.column_name WHERE actual.column_name IS NULL)
      AND (SELECT count(*)=2 FROM pg_indexes WHERE schemaname=current_schema() AND indexname IN ('outreach_holds_active_booking_unique','outreach_holds_live_window'))
      AND (SELECT count(*)=17 FROM pg_constraint WHERE connamespace=current_schema()::regnamespace AND conname IN ('outreach_allocation_mutex_pkey','outreach_allocation_mutex_id_check','outreach_booking_demand_pkey','outreach_booking_demand_quantities_check','outreach_booking_demand_resource_ids_check','outreach_booking_demand_revision_check','outreach_booking_demand_actor_check','outreach_booking_demand_reason_check','outreach_holds_pkey','outreach_holds_quantities_check','outreach_holds_resource_ids_check','outreach_holds_revision_check','outreach_holds_owner_check','outreach_holds_location_check','outreach_holds_state_valid','outreach_holds_window_valid','outreach_holds_lifecycle_valid'))
      AND (SELECT count(*)=5 FROM pg_constraint WHERE contype='f' AND conrelid IN (to_regclass(current_schema() || '.outreach_booking_demand'),to_regclass(current_schema() || '.outreach_holds')))
      AND NOT EXISTS (SELECT 1 FROM (VALUES ('outreach_booking_demand','booking_id','bookings'),('outreach_holds','candidate_id','outreach_candidates'),('outreach_holds','booking_id','bookings'),('outreach_holds','opportunity_id','booking_opportunities'),('outreach_holds','leg_id','travel_legs')) expected(child_table,child_column,parent_table) WHERE NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype='f' AND c.conrelid=to_regclass(current_schema() || '.' || expected.child_table) AND c.confrelid=to_regclass(current_schema() || '.' || expected.parent_table) AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname=expected.child_column)] AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]))
      AND NOT EXISTS (SELECT 1 FROM (VALUES ('outreach_allocation_mutex','id'),('outreach_allocation_mutex','generation'),('outreach_booking_demand','booking_id'),('outreach_booking_demand','quantities'),('outreach_booking_demand','resource_ids'),('outreach_booking_demand','facts_fingerprint'),('outreach_booking_demand','revision'),('outreach_booking_demand','actor'),('outreach_booking_demand','reason'),('outreach_booking_demand','updated_at'),('outreach_holds','id'),('outreach_holds','candidate_id'),('outreach_holds','booking_id'),('outreach_holds','opportunity_id'),('outreach_holds','leg_id'),('outreach_holds','event_starts_on'),('outreach_holds','event_ends_on'),('outreach_holds','starts_on'),('outreach_holds','ends_on'),('outreach_holds','quantities'),('outreach_holds','resource_ids'),('outreach_holds','location'),('outreach_holds','demand_fingerprint'),('outreach_holds','revision'),('outreach_holds','state'),('outreach_holds','owner'),('outreach_holds','expires_at'),('outreach_holds','created_at')) required(table_name,column_name) LEFT JOIN information_schema.columns actual ON actual.table_schema=current_schema() AND actual.table_name=required.table_name AND actual.column_name=required.column_name WHERE actual.column_name IS NULL OR actual.is_nullable<>'NO')
      AND to_regprocedure('outreach_quantities_valid(jsonb)') IS NOT NULL
      AND to_regprocedure('outreach_resource_ids_valid(jsonb)') IS NOT NULL
      AS ready`,
  },
  {
    name: "20260909_outreach_commitments.sql",
    markerSql: `SELECT
      (SELECT count(*)=3 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN ('outreach_write_receipts','outreach_reconciliation_facts','outreach_route_anchors'))
      AND NOT EXISTS (SELECT 1 FROM (VALUES ('outreach_write_receipts','transaction_id'),('outreach_write_receipts','mode'),('outreach_write_receipts','source'),('outreach_write_receipts','validated'),('outreach_write_receipts','dirty'),('outreach_write_receipts','created_at'),('outreach_reconciliation_facts','id'),('outreach_reconciliation_facts','source'),('outreach_reconciliation_facts','actor'),('outreach_reconciliation_facts','reason'),('outreach_reconciliation_facts','booking_ids'),('outreach_reconciliation_facts','facts_fingerprint'),('outreach_reconciliation_facts','state'),('outreach_reconciliation_facts','detail'),('outreach_reconciliation_facts','created_at'),('outreach_reconciliation_facts','resolved_at'),('outreach_route_anchors','id'),('outreach_route_anchors','leg_id'),('outreach_route_anchors','resource_id'),('outreach_route_anchors','direction'),('outreach_route_anchors','latitude'),('outreach_route_anchors','longitude'),('outreach_route_anchors','available_at'),('outreach_route_anchors','valid_until'),('outreach_route_anchors','source'),('outreach_route_anchors','reason'),('outreach_route_anchors','actor'),('outreach_route_anchors','identity_fingerprint'),('outreach_route_anchors','revision'),('outreach_route_anchors','recorded_at'),('outreach_route_anchors','revoked_at')) expected(table_name,column_name) LEFT JOIN information_schema.columns actual ON actual.table_schema=current_schema() AND actual.table_name=expected.table_name AND actual.column_name=expected.column_name WHERE actual.column_name IS NULL)
      AND (SELECT count(*)=11 FROM pg_constraint WHERE connamespace=current_schema()::regnamespace AND conname IN ('outreach_write_receipts_mode_check','outreach_reconciliation_facts_state_check','outreach_route_anchors_direction_check','outreach_route_anchors_latitude_check','outreach_route_anchors_longitude_check','outreach_route_anchors_source_check','outreach_route_anchors_reason_check','outreach_route_anchors_check','outreach_route_anchors_check1','outreach_route_anchors_leg_id_fkey','outreach_route_anchors_resource_id_fkey'))
      AND (SELECT count(*)=2 FROM pg_indexes WHERE schemaname=current_schema() AND indexname IN ('outreach_anchors_identity_live','outreach_reconciliation_pending'))
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='outreach_capacity_validation' AND tgrelid=to_regclass(current_schema() || '.outreach_write_receipts'))
      AND NOT EXISTS (SELECT 1 FROM (VALUES ('bookings'),('booking_operational_windows'),('booking_package_selections'),('booking_resource_assignments'),('booking_resource_package_attributions'),('package_templates'),('resources'),('travel_legs'),('google_operational_calendar_links'),('google_workspace_calendar_scopes'),('google_workspace_connections'),('outreach_holds'),('outreach_booking_demand'),('outreach_route_anchors'),('outreach_reconciliation_facts')) expected(name) WHERE to_regclass(current_schema() || '.' || expected.name) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='outreach_capacity_guard' AND tgrelid=to_regclass(current_schema() || '.' || expected.name))) AS ready`,
  },
  {
    name: "20260909c_convention_outreach.sql",
    markerSql: `SELECT to_regclass(current_schema() || '.convention_editions') IS NOT NULL
      AND to_regclass(current_schema() || '.convention_members') IS NOT NULL
      AND to_regclass(current_schema() || '.convention_history') IS NOT NULL
      AND to_regclass(current_schema() || '.convention_reviews') IS NOT NULL AS ready`,
  },
  {
    name: "20260909d_template_review_repair.sql",
    markerSql: `SELECT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = to_regclass(current_schema() || '.communication_template_reviews')
        AND tgname = 'communication_template_reviews_supersede_pending'
        AND NOT tgisinternal
    ) AS ready`,
  },
  {
    name: "20260909_outreach_dispatch.sql",
    markerSql: `SELECT to_regclass(current_schema() || '.outreach_dispatches') IS NOT NULL
      AND to_regclass(current_schema() || '.outreach_offer_approvals') IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM (VALUES ('outreach_offer_approvals','draft_kind'),('outreach_offer_approvals','draft_id'),('outreach_offer_approvals','digest'),('outreach_offer_approvals','intent'),('outreach_offer_approvals','hold_id'),('outreach_offer_approvals','hold_revision'),('outreach_offer_approvals','stage'),('outreach_offer_approvals','actor'),('outreach_offer_approvals','reason'),('outreach_offer_approvals','approved_at'),('outreach_dispatches','id'),('outreach_dispatches','draft_kind'),('outreach_dispatches','draft_id'),('outreach_dispatches','hold_id'),('outreach_dispatches','hold_revision'),('outreach_dispatches','digest'),('outreach_dispatches','intent'),('outreach_dispatches','stage'),('outreach_dispatches','payload'),('outreach_dispatches','state'),('outreach_dispatches','confirmation'),('outreach_dispatches','last_error'),('outreach_dispatches','review_after'),('outreach_dispatches','created_at'),('outreach_dispatches','updated_at')) expected(table_name,column_name) LEFT JOIN information_schema.columns actual ON actual.table_schema=current_schema() AND actual.table_name=expected.table_name AND actual.column_name=expected.column_name WHERE actual.column_name IS NULL)
      AND (SELECT count(*)=9 FROM pg_constraint WHERE connamespace=current_schema()::regnamespace AND conname IN ('outreach_offer_approvals_pkey','outreach_offer_intent_check','outreach_offer_kind_check','outreach_offer_hold_check','outreach_offer_hold_fk','outreach_dispatches_pkey','outreach_dispatch_state_check','outreach_dispatch_hold_fk','outreach_dispatch_confirmed_check'))
      AND (SELECT count(*)=2 FROM pg_indexes WHERE schemaname=current_schema() AND indexname IN ('outreach_dispatch_one_delivery','outreach_dispatch_unresolved_hold'))
      AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='outreach_dispatch_guard' AND tgrelid=to_regclass(current_schema() || '.outreach_dispatches'))
      AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='outreach_hold_delivery_guard' AND tgrelid=to_regclass(current_schema() || '.outreach_holds'))
      AND position('dispatch_attempt_count' in coalesce(pg_get_functiondef(to_regprocedure(current_schema() || '.outreach_draft_revision()')),'')) > 0
      AND NOT EXISTS(SELECT 1 FROM (VALUES ('booking_opportunity_email_state'),('office_email_drafts')) expected(name) WHERE to_regclass(current_schema() || '.' || expected.name) IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='outreach_draft_content_revision' AND tgrelid=to_regclass(current_schema() || '.' || expected.name)) OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=expected.name AND column_name='outreach_content_revision')))
      AND to_regclass(current_schema() || '.outreach_inbound_observations') IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM (VALUES ('id'),('message_id'),('thread_id'),('organization_id'),('opportunity_id'),('event_year'),('received_at'),('metadata'),('state'),('classification'),('reviewed_opportunity_id'),('reviewed_at'),('actor'),('reason'),('source_reference')) expected(name) WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='outreach_inbound_observations' AND column_name=expected.name))
      AND (SELECT count(*)=2 FROM pg_indexes WHERE schemaname=current_schema() AND indexname IN ('outreach_inbound_message_identity','outreach_inbound_review'))
      AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='outreach_dispatches' AND column_name='verification')
      AND to_regclass(current_schema() || '.outreach_source_reviews') IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM (VALUES ('candidate_id'),('source_id'),('classification'),('occurred_at'),('actor'),('reason'),('reviewed_at')) expected(name) WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='outreach_source_reviews' AND column_name=expected.name))
      AND (SELECT count(*)=2 FROM pg_constraint WHERE connamespace=current_schema()::regnamespace AND conname IN ('outreach_source_reviews_pkey','outreach_source_review_classification'))
      AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass(current_schema() || '.outreach_inbound_observations') AND conname='outreach_inbound_pkey')
      AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='outreach_dispatches' AND column_name='tracking_state') AS ready`,
  },
  {
    name: "20260910_outreach_workspace.sql",
    markerSql: `SELECT NOT EXISTS(SELECT 1 FROM (VALUES ('outreach_candidates','snoozed_until'),('outreach_candidates','cadence_override'),('outreach_research_tasks','qualification_criteria'),('outreach_research_tasks','target_count')) expected(table_name,column_name) LEFT JOIN information_schema.columns actual ON actual.table_schema=current_schema() AND actual.table_name=expected.table_name AND actual.column_name=expected.column_name WHERE actual.column_name IS NULL)
      AND to_regprocedure(current_schema() || '.outreach_valid_cadence(jsonb)') IS NOT NULL
      AND (SELECT count(*)=3 FROM pg_constraint WHERE connamespace=current_schema()::regnamespace AND conname IN ('outreach_candidates_cadence_valid','outreach_research_target_valid','outreach_research_qualification_valid'))
      AND to_regclass(current_schema() || '.outreach_candidates_snoozed_idx') IS NOT NULL AS ready`,
  },
  {
    name: "20260910_convention_planning_questionnaire.sql",
    markerSql: `SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass(current_schema() || '.boss_work_requests')
        AND conname = 'boss_work_requests_type_valid'
        AND pg_get_constraintdef(oid) LIKE '%convention_planning_questionnaire%'
    ) AS ready`,
  },
  {
    name: "20260910_communication_template_review_sets.sql",
    markerSql: `SELECT
      (SELECT COUNT(*) = 3
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'communication_template_reviews'
          AND column_name IN ('position', 'template_name_snapshot', 'verified_links'))
      AND to_regclass(current_schema() || '.communication_template_reviews_request_template_unique') IS NOT NULL
      AND to_regclass(current_schema() || '.communication_template_reviews_request_position_unique') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass(current_schema() || '.communication_template_reviews')
        AND conname = 'communication_template_reviews_request_id_key')
    AND to_regclass(current_schema() || '.communication_template_reviews_request_unique') IS NULL
      AS ready`,
  },
  {
    name: "20260910_public_directory_leads.sql",
    markerSql: `SELECT to_regclass(current_schema() || '.directory_import_20260910_batch') IS NOT NULL AS ready`,
  },
  {
    name: "20260910_rmaf_online_directory.sql",
    markerSql: `SELECT to_regclass(current_schema() || '.directory_import_20260910_batch') IS NOT NULL
      AND EXISTS (SELECT 1 FROM directory_import_20260910_batch WHERE batch = 'rmaf-online-directory-20260910-v1') AS ready`,
  },
  {
    name: "20260912_profile_html_email_delivery.sql",
    markerSql: `SELECT
      (SELECT count(*) = 17
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'office_email_drafts'
          AND column_name IN (
            'body_format', 'design_project_id', 'design_version_id',
            'scheduled_for', 'business_time_zone', 'gmail_draft_id',
            'gmail_message_id', 'gmail_thread_id', 'send_request_key',
            'schedule_request_key', 'dispatch_lease_owner',
            'dispatch_lease_expires_at', 'dispatch_attempt_count',
            'last_attempt_at', 'next_attempt_at', 'last_failure_code',
            'last_failure_message'
          ))
      AND (SELECT count(*) = 4
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname IN (
            'office_email_drafts_design_project_unique',
            'office_email_drafts_send_request_unique',
            'office_email_drafts_schedule_request_unique',
            'office_email_drafts_dispatch_idx'
          ))
      AND (SELECT count(*) = 4
        FROM pg_constraint
        WHERE connamespace = current_schema()::regnamespace
          AND conname IN (
            'office_email_drafts_state_valid',
            'office_email_drafts_body_format_valid',
            'office_email_drafts_design_project_fk',
            'office_email_drafts_design_version_fk'
          )) AS ready`,
  },
  {
    name: "20260921_event_date_coverage.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.event_date_facts') IS NOT NULL
      AND to_regclass(current_schema() || '.event_date_coverage_runs') IS NOT NULL
      AND to_regclass(current_schema() || '.event_date_coverage_items') IS NOT NULL
      AND to_regclass(current_schema() || '.event_date_facts_one_active_per_org') IS NOT NULL
      AND to_regclass(current_schema() || '.event_date_coverage_items_run_org_unique') IS NOT NULL
      AS ready`,
  },
  {
    name: "20260929_profile_research_event_date_target.sql",
    markerSql: `SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'profile_research_suggestions'::regclass
        AND conname = 'profile_research_suggestions_target_kind_check'
        AND pg_get_constraintdef(oid) LIKE '%event_date_fact%'
    ) AS ready`,
  },
  {
    name: '20261001_leg_planning.sql',
    markerSql: `SELECT
      NOT EXISTS(SELECT 1 FROM (VALUES ('leg_season_plans'),('crew_availability'),('package_sets'),('package_set_members'),('leg_event_plans'),('leg_plan_crew_commitments'),('leg_plan_splits'),('leg_plan_authorities'),('leg_plan_approval_requests'),('leg_plan_approval_decisions'),('leg_plan_mutation_receipts')) t(name) WHERE to_regclass(current_schema()||'.'||t.name) IS NULL)
      AND NOT EXISTS(SELECT 1 FROM (VALUES ('leg_season_plans_identity'),('crew_availability_window'),('package_set_members_identity'),('leg_plan_crew_window'),('leg_plan_crew_identity'),('leg_plan_split_distinct'),('leg_plan_receipt_identity')) t(name) WHERE NOT EXISTS(SELECT 1 FROM pg_constraint WHERE connamespace=current_schema()::regnamespace AND conname=t.name))
      AND NOT EXISTS(SELECT 1 FROM (VALUES ('crew_availability_worker_window'),('package_set_members_resource'),('leg_event_plans_leg'),('leg_plan_crew_worker_window'),('leg_plan_splits_bookings'),('leg_plan_requests_bookings'),('leg_plan_decisions_request')) t(name) WHERE to_regclass(current_schema()||'.'||t.name) IS NULL)
      AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='leg_plan_decision_immutable' AND tgrelid=to_regclass(current_schema()||'.leg_plan_approval_decisions'))
      AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='leg_planning_write_guard' AND tgrelid=to_regclass(current_schema()||'.leg_plan_crew_commitments'))
      AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='leg_planning_receipt_validation' AND tgrelid=to_regclass(current_schema()||'.outreach_write_receipts')) AS ready`,
  },
  {
    name: "20261002_booking_date_provenance.sql",
    markerSql: `SELECT to_regclass(current_schema()||'.booking_date_evidence') IS NOT NULL
      AND to_regclass(current_schema()||'.booking_date_repair_previews') IS NOT NULL
      AND to_regclass(current_schema()||'.booking_date_repair_receipts') IS NOT NULL
      AND to_regprocedure('booking_resolved_dates(uuid,timestamptz,timestamptz,timestamptz,timestamptz)') IS NOT NULL
      AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='booking_date_receipt_immutable' AND tgrelid=to_regclass(current_schema()||'.booking_date_repair_receipts')) AS ready`,
  },
  {
    name: "20260912_profile_booking_decisions.sql",
    markerSql: `SELECT
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'organizations' AND column_name = 'application_deadline')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'organizations' AND column_name = 'recommended_deal_model')
      AND to_regclass(current_schema() || '.organizations_application_deadline_idx') IS NOT NULL
      AND to_regclass(current_schema() || '.organizations_recommended_deal_model_idx') IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'organizations'::regclass AND conname = 'organizations_recommended_deal_model_valid')
      AS ready`,
  },
  {
    name: "20260921_event_date_coverage.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.event_date_facts') IS NOT NULL
      AND to_regclass(current_schema() || '.event_date_facts_one_active_per_org') IS NOT NULL
      AND to_regclass(current_schema() || '.event_date_coverage_runs') IS NOT NULL
      AND to_regclass(current_schema() || '.event_date_coverage_items') IS NOT NULL
      AND to_regclass(current_schema() || '.event_date_coverage_items_run_org_unique') IS NOT NULL
      AS ready`,
  },
  {
    name: "20261008_festival_editions.sql",
    markerSql: "SELECT to_regclass(current_schema() || '.festival_editions') IS NOT NULL AND to_regclass(current_schema() || '.festival_editions_organization_year') IS NOT NULL AS ready",
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

export async function ensureFestivalEditionSchema(): Promise<void> {
  const directory = await resolveMigrationDirectory();
  const required = ["20260912_profile_booking_decisions.sql", "20260921_event_date_coverage.sql", "20261008_festival_editions.sql"];
  const migrations = await Promise.all(required.map(async name => {
    const migration = migrationFiles.find(item => item.name === name);
    if (!migration) throw new Error(`Required profile migration is missing: ${name}`);
    return { ...migration, sql: await readFile(new URL(name, directory), "utf8") };
  }));
  await runActReviewMigrations({ migrations });
}

export async function runActReviewMigrations(options?: {
  pool?: MigrationPool;
  migrations?: ActReviewMigration[];
}): Promise<string[]> {
  const migrationPool = options?.pool ?? (await import("./index")).pool;
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
      const repaired = await client.query(migration.markerSql);
      if (repaired.rows[0]?.["ready"] !== true)
        throw new Error(`Migration ${migration.name} remains incomplete after repair; deployment must stop.`);
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
