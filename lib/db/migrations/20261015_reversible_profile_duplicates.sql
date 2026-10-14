CREATE TABLE IF NOT EXISTS profile_duplicate_dismissals (
  left_id uuid NOT NULL REFERENCES organizations(id),
  right_id uuid NOT NULL REFERENCES organizations(id),
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(left_id, right_id),
  CHECK(left_id < right_id)
);
-- Immutable snapshots/provenance; no expiry cleanup. Undo remains available beyond 30 days.
CREATE TABLE IF NOT EXISTS profile_merge_journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survivor_id uuid NOT NULL REFERENCES organizations(id),
  source_id uuid NOT NULL REFERENCES organizations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  choices jsonb NOT NULL,
  conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
  CHECK(survivor_id <> source_id)
);
CREATE INDEX IF NOT EXISTS profile_merge_journal_survivor_idx ON profile_merge_journal(survivor_id, created_at DESC);
