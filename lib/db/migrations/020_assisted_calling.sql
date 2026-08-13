BEGIN;

DO $$
BEGIN
  CREATE TYPE contact_phone_type AS ENUM ('mobile', 'office', 'alternate', 'unknown');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS contact_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  number text NOT NULL,
  normalized_number text,
  type contact_phone_type NOT NULL DEFAULT 'unknown',
  extension text,
  label text,
  "primary" boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'local',
  do_not_call_at timestamptz,
  do_not_call_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_phones_number_nonblank CHECK (btrim(number) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS contact_phones_one_primary_per_contact
  ON contact_phones (contact_id) WHERE "primary";
CREATE INDEX IF NOT EXISTS contact_phones_normalized_number_idx
  ON contact_phones (normalized_number);

INSERT INTO contact_phones (contact_id, number, normalized_number, type, "primary", source)
SELECT id, phone, normalized_phone, 'unknown', true, 'legacy'
FROM contacts
WHERE btrim(coalesce(phone, '')) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM contact_phones WHERE contact_phones.contact_id = contacts.id
  );

COMMIT;
