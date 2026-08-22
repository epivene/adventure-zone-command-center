CREATE TABLE IF NOT EXISTS attendance_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id uuid NOT NULL REFERENCES business_source_documents(id) ON DELETE CASCADE,
  source_row_number integer NOT NULL,
  month text NOT NULL,
  original_event_name text NOT NULL,
  original_location text NOT NULL,
  normalized_event_name text NOT NULL,
  normalized_location text NOT NULL,
  matched_organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  matched_location_id uuid REFERENCES organization_locations(id) ON DELETE SET NULL,
  match_state text NOT NULL DEFAULT 'pending',
  match_confidence numeric(4,3),
  match_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_import_rows_match_state_valid
    CHECK (match_state IN ('pending','confident','approved','new_profile_candidate','rejected')),
  CONSTRAINT attendance_import_rows_source_row_positive CHECK (source_row_number > 0),
  CONSTRAINT attendance_import_rows_confidence_range
    CHECK (match_confidence IS NULL OR (match_confidence >= 0 AND match_confidence <= 1))
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_import_rows_source_row_unique
  ON attendance_import_rows(source_document_id, source_row_number);
CREATE INDEX IF NOT EXISTS attendance_import_rows_match_state_idx
  ON attendance_import_rows(match_state);
CREATE INDEX IF NOT EXISTS attendance_import_rows_normalized_event_location_idx
  ON attendance_import_rows(normalized_event_name, normalized_location);

CREATE TABLE IF NOT EXISTS attendance_import_year_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_row_id uuid NOT NULL REFERENCES attendance_import_rows(id) ON DELETE CASCADE,
  year integer NOT NULL,
  status text NOT NULL,
  CONSTRAINT attendance_import_year_statuses_year_range CHECK (year BETWEEN 1900 AND 2100),
  CONSTRAINT attendance_import_year_statuses_status_valid
    CHECK (status IN ('attended','blacklisted','cancelled_last_minute'))
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_import_year_statuses_row_year_unique
  ON attendance_import_year_statuses(import_row_id, year);

CREATE TABLE IF NOT EXISTS event_attendance_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  organization_location_id uuid REFERENCES organization_locations(id) ON DELETE SET NULL,
  source_import_row_id uuid NOT NULL REFERENCES attendance_import_rows(id) ON DELETE RESTRICT,
  year integer NOT NULL,
  month text NOT NULL,
  status text NOT NULL,
  original_event_name text NOT NULL,
  original_location text NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_attendance_history_status_valid
    CHECK (status IN ('attended','blacklisted','cancelled_last_minute'))
);
CREATE UNIQUE INDEX IF NOT EXISTS event_attendance_history_source_year_unique
  ON event_attendance_history(source_import_row_id, year);
CREATE INDEX IF NOT EXISTS event_attendance_history_organization_year_idx
  ON event_attendance_history(organization_id, year);
CREATE INDEX IF NOT EXISTS event_attendance_history_status_year_idx
  ON event_attendance_history(status, year);
