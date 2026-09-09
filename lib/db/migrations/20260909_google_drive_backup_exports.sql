CREATE TABLE IF NOT EXISTS google_drive_backup_config (
  id text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  connection_id uuid REFERENCES google_workspace_connections(id) ON DELETE SET NULL,
  root_folder_name text NOT NULL DEFAULT 'Adventure Zone Command Center Backup'
    CHECK (root_folder_name = 'Adventure Zone Command Center Backup'),
  root_folder_id text,
  root_web_view_link text,
  state text NOT NULL DEFAULT 'disabled'
    CHECK (state IN ('disabled','preview','pilot','active','paused','reauthorization_required')),
  successful_pilot_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO google_drive_backup_config (id) VALUES ('default')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS google_drive_backup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('preview','pilot','backfill')),
  state text NOT NULL DEFAULT 'planning'
    CHECK (state IN ('planning','queued','running','paused','completed','failed')),
  profile_limit integer CHECK (profile_limit IS NULL OR profile_limit BETWEEN 1 AND 25),
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(cursor) = 'object'),
  counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(counts) = 'object'),
  created_by text NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS google_drive_backup_runs_state_created_idx
  ON google_drive_backup_runs (state, created_at);

CREATE TABLE IF NOT EXISTS google_drive_backup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_kind text NOT NULL
    CHECK (entity_kind IN ('profile_summary','follow_up_summary','document')),
  entity_id uuid NOT NULL,
  run_id uuid REFERENCES google_drive_backup_runs(id) ON DELETE SET NULL,
  priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 100),
  request_generation bigint NOT NULL DEFAULT 1 CHECK (request_generation > 0),
  claimed_generation bigint,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','processing','retry','blocked','failed','succeeded')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_at timestamptz,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_kind, entity_id)
);
CREATE INDEX IF NOT EXISTS google_drive_backup_jobs_claim_idx
  ON google_drive_backup_jobs (status, priority DESC, next_attempt_at, requested_at);
CREATE INDEX IF NOT EXISTS google_drive_backup_jobs_run_idx
  ON google_drive_backup_jobs (run_id, status);

CREATE TABLE IF NOT EXISTS google_drive_backup_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_path text NOT NULL UNIQUE,
  drive_folder_id text NOT NULL UNIQUE,
  parent_logical_path text,
  parent_drive_folder_id text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    btrim(logical_path) <> ''
    AND btrim(drive_folder_id) <> ''
    AND btrim(parent_drive_folder_id) <> ''
  )
);

CREATE TABLE IF NOT EXISTS google_drive_backup_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_kind text NOT NULL
    CHECK (entity_kind IN ('profile_summary','follow_up_summary','document')),
  entity_id uuid NOT NULL,
  drive_file_id text NOT NULL UNIQUE,
  drive_parent_id text NOT NULL,
  logical_path text NOT NULL,
  sha256_hex text NOT NULL CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
  source_version text NOT NULL,
  last_exported_at timestamptz NOT NULL DEFAULT now(),
  source_removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_kind, entity_id),
  CHECK (
    btrim(drive_file_id) <> ''
    AND btrim(drive_parent_id) <> ''
    AND btrim(logical_path) <> ''
    AND btrim(source_version) <> ''
  )
);
CREATE INDEX IF NOT EXISTS google_drive_backup_mappings_path_idx
  ON google_drive_backup_mappings (logical_path);

CREATE OR REPLACE FUNCTION enqueue_google_drive_backup_job(
  p_entity_kind text,
  p_entity_id uuid,
  p_priority integer DEFAULT 100,
  p_run_id uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_entity_id IS NULL THEN RETURN; END IF;

  INSERT INTO google_drive_backup_jobs (
    entity_kind, entity_id, run_id, priority, status,
    next_attempt_at, requested_at, updated_at
  ) VALUES (
    p_entity_kind, p_entity_id, p_run_id, p_priority, 'queued',
    now(), now(), now()
  )
  ON CONFLICT (entity_kind, entity_id) DO UPDATE SET
    run_id = COALESCE(EXCLUDED.run_id, google_drive_backup_jobs.run_id),
    priority = GREATEST(EXCLUDED.priority, google_drive_backup_jobs.priority),
    request_generation = google_drive_backup_jobs.request_generation + 1,
    status = CASE WHEN google_drive_backup_jobs.status = 'processing'
      THEN 'processing' ELSE 'queued' END,
    next_attempt_at = CASE WHEN google_drive_backup_jobs.status = 'processing'
      THEN google_drive_backup_jobs.next_attempt_at ELSE now() END,
    locked_by = CASE WHEN google_drive_backup_jobs.status = 'processing'
      THEN google_drive_backup_jobs.locked_by ELSE NULL END,
    locked_at = CASE WHEN google_drive_backup_jobs.status = 'processing'
      THEN google_drive_backup_jobs.locked_at ELSE NULL END,
    lease_expires_at = CASE WHEN google_drive_backup_jobs.status = 'processing'
      THEN google_drive_backup_jobs.lease_expires_at ELSE NULL END,
    last_error_code = NULL,
    last_error_message = NULL,
    completed_at = NULL,
    requested_at = now(),
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_google_drive_backup_profile(
  p_organization_id uuid,
  p_priority integer DEFAULT 100
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_organization_id IS NULL THEN RETURN; END IF;
  PERFORM enqueue_google_drive_backup_job('profile_summary', p_organization_id, p_priority);
  PERFORM enqueue_google_drive_backup_job('follow_up_summary', p_organization_id, p_priority);
END;
$$;

CREATE OR REPLACE FUNCTION google_drive_backup_resolve_organization(
  p_organization_id uuid,
  p_booking_id uuid,
  p_contact_id uuid
) RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE resolved_id uuid;
BEGIN
  IF p_organization_id IS NOT NULL THEN RETURN p_organization_id; END IF;
  IF p_booking_id IS NOT NULL THEN
    SELECT COALESCE(b.organization_id, c.organization_id)
      INTO resolved_id
      FROM bookings b
      LEFT JOIN contacts c ON c.id = b.primary_contact_id
     WHERE b.id = p_booking_id;
    IF resolved_id IS NOT NULL THEN RETURN resolved_id; END IF;
  END IF;
  IF p_contact_id IS NOT NULL THEN
    SELECT c.organization_id INTO resolved_id
      FROM contacts c WHERE c.id = p_contact_id;
  END IF;
  RETURN resolved_id;
END;
$$;

CREATE OR REPLACE FUNCTION google_drive_backup_organizations_enqueue()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_id uuid; new_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_id := OLD.id; END IF;
  IF TG_OP <> 'DELETE' THEN new_id := NEW.id; END IF;
  PERFORM enqueue_google_drive_backup_profile(old_id);
  IF new_id IS DISTINCT FROM old_id THEN
    PERFORM enqueue_google_drive_backup_profile(new_id);
  END IF;
  PERFORM enqueue_google_drive_backup_job('document', l.document_id, 100)
    FROM business_document_links l
    LEFT JOIN bookings b ON b.id = l.booking_id
   WHERE l.organization_id IN (old_id, new_id)
      OR b.organization_id IN (old_id, new_id);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION google_drive_backup_contacts_enqueue()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_organization_id uuid; new_organization_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_organization_id := OLD.organization_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_organization_id := NEW.organization_id; END IF;
  PERFORM enqueue_google_drive_backup_profile(old_organization_id);
  IF new_organization_id IS DISTINCT FROM old_organization_id THEN
    PERFORM enqueue_google_drive_backup_profile(new_organization_id);
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION google_drive_backup_bookings_enqueue()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_organization_id uuid; new_organization_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_organization_id := google_drive_backup_resolve_organization(
      OLD.organization_id, OLD.id, OLD.primary_contact_id);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_organization_id := google_drive_backup_resolve_organization(
      NEW.organization_id, NEW.id, NEW.primary_contact_id);
  END IF;
  PERFORM enqueue_google_drive_backup_profile(old_organization_id);
  IF new_organization_id IS DISTINCT FROM old_organization_id THEN
    PERFORM enqueue_google_drive_backup_profile(new_organization_id);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    PERFORM enqueue_google_drive_backup_job('document', l.document_id, 100)
      FROM business_document_links l WHERE l.booking_id = OLD.id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM enqueue_google_drive_backup_job('document', l.document_id, 100)
      FROM business_document_links l WHERE l.booking_id = NEW.id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION google_drive_backup_profile_child_enqueue()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_organization_id uuid; new_organization_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_organization_id := google_drive_backup_resolve_organization(
      OLD.organization_id, OLD.booking_id, OLD.contact_id);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_organization_id := google_drive_backup_resolve_organization(
      NEW.organization_id, NEW.booking_id, NEW.contact_id);
  END IF;
  PERFORM enqueue_google_drive_backup_profile(old_organization_id);
  IF new_organization_id IS DISTINCT FROM old_organization_id THEN
    PERFORM enqueue_google_drive_backup_profile(new_organization_id);
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION google_drive_backup_document_enqueue()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_document_id uuid; new_document_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_document_id := OLD.id; END IF;
  IF TG_OP <> 'DELETE' THEN new_document_id := NEW.id; END IF;
  PERFORM enqueue_google_drive_backup_job('document', old_document_id, 100);
  IF new_document_id IS DISTINCT FROM old_document_id THEN
    PERFORM enqueue_google_drive_backup_job('document', new_document_id, 100);
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION google_drive_backup_document_child_enqueue()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_document_id uuid; new_document_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_document_id := OLD.document_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_document_id := NEW.document_id; END IF;
  PERFORM enqueue_google_drive_backup_job('document', old_document_id, 100);
  IF new_document_id IS DISTINCT FROM old_document_id THEN
    PERFORM enqueue_google_drive_backup_job('document', new_document_id, 100);
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS google_drive_backup_organizations_enqueue ON organizations;
CREATE TRIGGER google_drive_backup_organizations_enqueue
AFTER INSERT OR UPDATE OR DELETE ON organizations
FOR EACH ROW EXECUTE FUNCTION google_drive_backup_organizations_enqueue();

DROP TRIGGER IF EXISTS google_drive_backup_contacts_enqueue ON contacts;
CREATE TRIGGER google_drive_backup_contacts_enqueue
AFTER INSERT OR UPDATE OR DELETE ON contacts
FOR EACH ROW EXECUTE FUNCTION google_drive_backup_contacts_enqueue();

DROP TRIGGER IF EXISTS google_drive_backup_bookings_enqueue ON bookings;
CREATE TRIGGER google_drive_backup_bookings_enqueue
AFTER INSERT OR UPDATE OR DELETE ON bookings
FOR EACH ROW EXECUTE FUNCTION google_drive_backup_bookings_enqueue();

DROP TRIGGER IF EXISTS google_drive_backup_follow_ups_enqueue ON follow_ups;
CREATE TRIGGER google_drive_backup_follow_ups_enqueue
AFTER INSERT OR UPDATE OR DELETE ON follow_ups
FOR EACH ROW EXECUTE FUNCTION google_drive_backup_profile_child_enqueue();

DROP TRIGGER IF EXISTS google_drive_backup_activities_enqueue ON activities;
CREATE TRIGGER google_drive_backup_activities_enqueue
AFTER INSERT OR UPDATE OR DELETE ON activities
FOR EACH ROW EXECUTE FUNCTION google_drive_backup_profile_child_enqueue();

DROP TRIGGER IF EXISTS google_drive_backup_documents_enqueue ON business_documents;
CREATE TRIGGER google_drive_backup_documents_enqueue
AFTER INSERT OR UPDATE OR DELETE ON business_documents
FOR EACH ROW EXECUTE FUNCTION google_drive_backup_document_enqueue();

DROP TRIGGER IF EXISTS google_drive_backup_document_versions_enqueue
  ON business_document_versions;
CREATE TRIGGER google_drive_backup_document_versions_enqueue
AFTER INSERT OR UPDATE OR DELETE ON business_document_versions
FOR EACH ROW EXECUTE FUNCTION google_drive_backup_document_child_enqueue();

DROP TRIGGER IF EXISTS google_drive_backup_document_links_enqueue
  ON business_document_links;
CREATE TRIGGER google_drive_backup_document_links_enqueue
AFTER INSERT OR UPDATE OR DELETE ON business_document_links
FOR EACH ROW EXECUTE FUNCTION google_drive_backup_document_child_enqueue();
