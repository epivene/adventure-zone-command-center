CREATE TABLE IF NOT EXISTS event_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES event_families(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE RESTRICT,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_family_members_source_valid CHECK (source IN ('approved_rule','approved_ai','manual')),
  UNIQUE (family_id, organization_id)
);

CREATE TABLE IF NOT EXISTS event_family_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_name text NOT NULL,
  normalized_name text NOT NULL,
  candidate_ids jsonb NOT NULL,
  candidate_fingerprint text NOT NULL,
  source text NOT NULL,
  confidence numeric(4,3) NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_family_suggestions_candidate_ids_array CHECK (jsonb_typeof(candidate_ids) = 'array'),
  CONSTRAINT event_family_suggestions_source_valid CHECK (source IN ('rule','ai')),
  CONSTRAINT event_family_suggestions_status_valid CHECK (status IN ('pending','approved','dismissed')),
  CONSTRAINT event_family_suggestions_confidence_valid CHECK (confidence >= 0 AND confidence <= 1),
  UNIQUE (normalized_name, candidate_fingerprint)
);

CREATE INDEX IF NOT EXISTS event_families_normalized_name_idx ON event_families(normalized_name);
CREATE INDEX IF NOT EXISTS event_family_members_family_id_idx ON event_family_members(family_id);
CREATE INDEX IF NOT EXISTS event_family_suggestions_pending_idx ON event_family_suggestions(status, created_at DESC);
