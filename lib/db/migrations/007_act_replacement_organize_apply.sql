-- Phase 2 organize/apply durable manifest and provenance foundation.

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS timeline_sort_at timestamptz,
  ADD COLUMN IF NOT EXISTS date_is_import_fallback boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_record_id uuid,
  ADD COLUMN IF NOT EXISTS source_version_id uuid,
  ADD COLUMN IF NOT EXISTS source_type text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activities_source_record_fk'
      AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE activities ADD CONSTRAINT activities_source_record_fk
      FOREIGN KEY (source_record_id) REFERENCES act_source_records(id) ON DELETE RESTRICT;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activities_source_version_fk'
      AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE activities ADD CONSTRAINT activities_source_version_fk
      FOREIGN KEY (source_version_id) REFERENCES act_source_record_versions(id) ON DELETE RESTRICT;
  END IF;
END $$;
UPDATE activities SET timeline_sort_at = COALESCE(occurred_at, created_at) WHERE timeline_sort_at IS NULL;
ALTER TABLE activities ALTER COLUMN occurred_at DROP NOT NULL, ALTER COLUMN occurred_at DROP DEFAULT, ALTER COLUMN timeline_sort_at SET NOT NULL;
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_parent_required;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activities_parent_required'
      AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE activities ADD CONSTRAINT activities_parent_required
      CHECK (organization_id IS NOT NULL OR contact_id IS NOT NULL OR booking_id IS NOT NULL OR source_record_id IS NOT NULL);
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activities_occurred_at_required_for_local'
      AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE activities ADD CONSTRAINT activities_occurred_at_required_for_local
      CHECK (occurred_at IS NOT NULL OR source_record_id IS NOT NULL);
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activities_source_type_valid'
      AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE activities ADD CONSTRAINT activities_source_type_valid
      CHECK (source_type IS NULL OR source_type IN ('note','history','activity'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS activities_source_record_id_unique ON activities(source_record_id) WHERE source_record_id IS NOT NULL;

ALTER TABLE act_external_links ADD COLUMN IF NOT EXISTS source_database_key text, ADD COLUMN IF NOT EXISTS source_record_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'act_external_links_source_database_key_nonblank'
      AND conrelid = 'act_external_links'::regclass
  ) THEN
    ALTER TABLE act_external_links ADD CONSTRAINT act_external_links_source_database_key_nonblank
      CHECK (source_database_key IS NULL OR btrim(source_database_key) <> '');
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'act_external_links_source_record_fk'
      AND conrelid = 'act_external_links'::regclass
  ) THEN
    ALTER TABLE act_external_links ADD CONSTRAINT act_external_links_source_record_fk
      FOREIGN KEY (source_record_id) REFERENCES act_source_records(id) ON DELETE RESTRICT;
  END IF;
END $$;
DROP INDEX IF EXISTS act_external_links_source_external_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS act_external_links_legacy_source_external_id_unique ON act_external_links(source_entity_type, act_record_id) WHERE source_database_key IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS act_external_links_database_source_record_unique ON act_external_links(source_record_id) WHERE source_record_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS act_external_links_database_source_act_id_unique ON act_external_links(source_database_key,source_entity_type,act_record_id) WHERE source_database_key IS NOT NULL;
ALTER TABLE calling_list_memberships DROP CONSTRAINT IF EXISTS calling_list_memberships_source_valid;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'calling_list_memberships_source_valid'
      AND conrelid = 'calling_list_memberships'::regclass
  ) THEN
    ALTER TABLE calling_list_memberships ADD CONSTRAINT calling_list_memberships_source_valid
      CHECK (source IN ('act_migration','act_import','manual'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS act_replacement_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES act_replacement_runs(id) ON DELETE CASCADE, source_record_id uuid NOT NULL REFERENCES act_source_records(id), source_version_id uuid NOT NULL REFERENCES act_source_record_versions(id), state text NOT NULL DEFAULT 'pending', normalized jsonb, mapping_warnings jsonb NOT NULL DEFAULT '[]'::jsonb, unsupported_field_paths jsonb NOT NULL DEFAULT '[]'::jsonb, candidates jsonb, issues jsonb, match jsonb, target_entity_type text, target_entity_id uuid, lease_owner text, lease_expires_at timestamptz, retry_after timestamptz, retryable boolean NOT NULL DEFAULT true, attempt_count integer NOT NULL DEFAULT 0, last_error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id, source_record_id), CHECK (state IN ('pending','leased','ready','already_present','awaiting_review','unassigned','unsupported','applied','failed')), CHECK (target_entity_type IS NULL OR target_entity_type IN ('organization','contact','booking','calling_list','activity'))
);
CREATE TABLE IF NOT EXISTS act_source_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_record_id uuid NOT NULL REFERENCES act_source_records(id) ON DELETE RESTRICT, target_entity_type text NOT NULL, target_entity_id uuid NOT NULL, role text NOT NULL DEFAULT 'primary', is_primary boolean NOT NULL DEFAULT false, manual_authority boolean NOT NULL, assigned_by text NOT NULL, superseded_at timestamptz, superseded_by text, source_version_id uuid REFERENCES act_source_record_versions(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(source_record_id,target_entity_type,target_entity_id), CHECK (manual_authority = true AND btrim(assigned_by) <> ''), CHECK (superseded_at IS NULL OR (superseded_by IS NOT NULL AND btrim(superseded_by) <> '')), CHECK (target_entity_type IN ('organization','contact','booking','calling_list','activity'))
);
CREATE TABLE IF NOT EXISTS act_replacement_review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_record_id uuid NOT NULL REFERENCES act_source_records(id) ON DELETE RESTRICT, source_version_id uuid NOT NULL REFERENCES act_source_record_versions(id), scope text NOT NULL, decision text NOT NULL, request_key text NOT NULL, field_name text, target_entity_type text, target_entity_id uuid, active boolean NOT NULL DEFAULT true, superseded_at timestamptz, superseded_by uuid, created_at timestamptz NOT NULL DEFAULT now(), CHECK (scope IN ('duplicate_identity','field_conflict','unsupported_record')), CHECK ((scope = 'field_conflict' AND field_name IS NOT NULL AND btrim(field_name) <> '') OR (scope <> 'field_conflict' AND field_name IS NULL)), CHECK (superseded_at IS NULL OR superseded_by IS NOT NULL), CHECK (decision IN ('link_existing','keep_separate','keep_local','use_source','ignore_source')), CHECK (target_entity_type IS NULL OR target_entity_type IN ('organization','contact','booking','calling_list','activity'))
);
CREATE UNIQUE INDEX IF NOT EXISTS act_replacement_review_decisions_active_unique ON act_replacement_review_decisions(source_record_id,scope,coalesce(field_name,'')) WHERE active = true;
CREATE TABLE IF NOT EXISTS act_replacement_apply_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES act_replacement_runs(id) ON DELETE CASCADE, source_record_id uuid NOT NULL REFERENCES act_source_records(id), source_version_id uuid NOT NULL REFERENCES act_source_record_versions(id), operation_key text NOT NULL, target_type text NOT NULL, action text NOT NULL, payload jsonb NOT NULL, dependency_operation_keys jsonb NOT NULL DEFAULT '[]'::jsonb, required_for_source_outcome boolean NOT NULL DEFAULT false, safe_by_default boolean NOT NULL DEFAULT false, batch_id uuid, status text NOT NULL DEFAULT 'pending', approved_by text, approved_at timestamptz, lease_owner text, lease_expires_at timestamptz, retryable boolean NOT NULL DEFAULT true, retry_after timestamptz, executed_at timestamptz, attempt_count integer NOT NULL DEFAULT 0, last_error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id,operation_key), CHECK (action IN ('create','link_existing','fill_missing','overwrite_reviewed','create_relationship','record_provenance')), CHECK (target_type IN ('organization','contact','booking','calling_list','activity','organization_contact','booking_contact','calling_list_member','activity_association')), CHECK (status IN ('pending','leased','applied','already_present','blocked','failed')), CHECK (approved_at IS NULL OR approved_by IS NOT NULL), CHECK ((status = 'leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR status <> 'leased')
);
CREATE TABLE IF NOT EXISTS act_replacement_apply_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_key text NOT NULL UNIQUE, run_id uuid NOT NULL REFERENCES act_replacement_runs(id) ON DELETE CASCADE, manifest_digest text NOT NULL, selected_operation_ids jsonb NOT NULL DEFAULT '[]'::jsonb, dependency_closed_operation_ids jsonb NOT NULL DEFAULT '[]'::jsonb, selected_count integer NOT NULL DEFAULT 0, dependency_count integer NOT NULL DEFAULT 0, rejected_count integer NOT NULL DEFAULT 0, state text NOT NULL DEFAULT 'queued', started_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK (state IN ('queued','applying','complete','complete_with_issues'))
);
CREATE UNIQUE INDEX IF NOT EXISTS act_replacement_apply_batches_one_active_per_run ON act_replacement_apply_batches(run_id) WHERE state IN ('queued','applying');
CREATE TABLE IF NOT EXISTS act_imported_field_origins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_type text NOT NULL, entity_id uuid NOT NULL, field_name text NOT NULL, source_record_id uuid NOT NULL REFERENCES act_source_records(id), source_version_id uuid NOT NULL REFERENCES act_source_record_versions(id), operation_id uuid NOT NULL REFERENCES act_replacement_apply_operations(id), source_value_fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(entity_type,entity_id,field_name), CHECK (entity_type IN ('organization','contact','booking','calling_list','activity')), CHECK (btrim(field_name) <> '')
);
CREATE TABLE IF NOT EXISTS activity_associations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE, organization_id uuid REFERENCES organizations(id), contact_id uuid REFERENCES contacts(id), booking_id uuid REFERENCES bookings(id), created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT activity_associations_exactly_one_target CHECK (num_nonnulls(organization_id,contact_id,booking_id) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS activity_associations_activity_organization_unique ON activity_associations(activity_id,organization_id) WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS activity_associations_activity_contact_unique ON activity_associations(activity_id,contact_id) WHERE contact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS activity_associations_activity_booking_unique ON activity_associations(activity_id,booking_id) WHERE booking_id IS NOT NULL;
