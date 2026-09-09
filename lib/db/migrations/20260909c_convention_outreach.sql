CREATE TABLE IF NOT EXISTS convention_editions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  convention text NOT NULL CHECK (length(trim(convention)) BETWEEN 1 AND 200),
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2200),
  summary text NOT NULL DEFAULT '',
  recommendation text NOT NULL DEFAULT '',
  sources text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  archived_at timestamptz,
  copied_from uuid REFERENCES convention_editions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(convention, year)
);
CREATE TABLE IF NOT EXISTS convention_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL REFERENCES convention_editions(id) ON DELETE RESTRICT,
  source_key text NOT NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(edition_id, source_key),
  CHECK (data->>'group' IN ('returning','new','replacement','confirm','special')),
  CHECK (data->>'outcome' IN ('not_contacted','sent','replied','interested','follow_up','declined','booked','do_not_contact'))
);
CREATE INDEX IF NOT EXISTS convention_members_profile_idx ON convention_members(organization_id, contact_id);
CREATE TABLE IF NOT EXISTS convention_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL REFERENCES convention_editions(id) ON DELETE RESTRICT,
  member_id uuid REFERENCES convention_members(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  actor text NOT NULL,
  mutation_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(edition_id, mutation_key)
);
CREATE INDEX IF NOT EXISTS convention_history_member_idx ON convention_history(member_id, occurred_at);
CREATE TABLE IF NOT EXISTS convention_reviews (
  edition_id uuid NOT NULL REFERENCES convention_editions(id) ON DELETE RESTRICT,
  actor text NOT NULL,
  reviewed_revision integer NOT NULL CHECK (reviewed_revision > 0),
  note text NOT NULL DEFAULT '',
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(edition_id, actor)
);

