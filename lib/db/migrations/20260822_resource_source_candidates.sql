CREATE TABLE IF NOT EXISTS resource_source_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id uuid NOT NULL REFERENCES business_source_documents(id) ON DELETE CASCADE,
  source_name text NOT NULL,
  normalized_name text NOT NULL,
  year_built integer NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  serial_number text NOT NULL,
  matched_resource_id uuid REFERENCES resources(id) ON DELETE SET NULL,
  match_state text NOT NULL DEFAULT 'pending',
  match_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resource_source_candidates_match_state_valid
    CHECK (match_state IN ('pending','exact_match','applied','ignored')),
  CONSTRAINT resource_source_candidates_year_built_range
    CHECK (year_built BETWEEN 1900 AND 2100)
);

CREATE UNIQUE INDEX IF NOT EXISTS resource_source_candidates_source_serial_unique
  ON resource_source_candidates(source_document_id, serial_number);
CREATE INDEX IF NOT EXISTS resource_source_candidates_state_idx
  ON resource_source_candidates(match_state);
CREATE INDEX IF NOT EXISTS resource_source_candidates_normalized_name_idx
  ON resource_source_candidates(normalized_name);
