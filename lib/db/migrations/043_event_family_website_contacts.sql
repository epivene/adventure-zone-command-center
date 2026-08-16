ALTER TABLE event_families
  ADD COLUMN IF NOT EXISTS website text;

CREATE TABLE IF NOT EXISTS event_family_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES event_families(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  role text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, contact_id)
);

CREATE INDEX IF NOT EXISTS event_family_contacts_family_idx
  ON event_family_contacts(family_id);

CREATE INDEX IF NOT EXISTS event_family_contacts_contact_idx
  ON event_family_contacts(contact_id);

CREATE UNIQUE INDEX IF NOT EXISTS event_family_contacts_one_primary_per_family
  ON event_family_contacts(family_id)
  WHERE is_primary = true;
