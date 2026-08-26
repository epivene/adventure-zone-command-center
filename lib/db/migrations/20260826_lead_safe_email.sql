ALTER TABLE lead_import_rows
  ADD COLUMN IF NOT EXISTS territory_status text,
  ADD COLUMN IF NOT EXISTS fit_status text;

UPDATE lead_import_rows
SET territory_status = coalesce(territory_status, 'needs_review'),
    fit_status = coalesce(fit_status, 'needs_review');

ALTER TABLE lead_import_rows
  ALTER COLUMN territory_status SET DEFAULT 'needs_review',
  ALTER COLUMN territory_status SET NOT NULL,
  ALTER COLUMN fit_status SET DEFAULT 'needs_review',
  ALTER COLUMN fit_status SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_import_rows_territory_status_valid') THEN
    ALTER TABLE lead_import_rows ADD CONSTRAINT lead_import_rows_territory_status_valid CHECK (territory_status in ('open','ask_amy_dave','closed','licensing_issue','needs_review'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_import_rows_fit_status_valid') THEN
    ALTER TABLE lead_import_rows ADD CONSTRAINT lead_import_rows_fit_status_valid CHECK (fit_status in ('approved','needs_review','not_a_fit'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS communication_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL,
  organization_id uuid,
  contact_id uuid,
  normalized_email text,
  row_id uuid,
  reason text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_by text,
  removed_at timestamptz,
  removal_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS communication_blocks_active_target_unique ON communication_blocks (target_type, coalesce(organization_id::text,''), coalesce(contact_id::text,''), coalesce(normalized_email,''), coalesce(row_id::text,'')) WHERE active;
CREATE INDEX IF NOT EXISTS communication_blocks_active_lookup_idx ON communication_blocks (active, normalized_email, organization_id, contact_id, row_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communication_blocks_target_valid') THEN
    ALTER TABLE communication_blocks ADD CONSTRAINT communication_blocks_target_valid CHECK (target_type in ('organization','contact','recipient_email','lead_import_row','internal_preview'));
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communication_blocks_exact_target') THEN
    ALTER TABLE communication_blocks DROP CONSTRAINT communication_blocks_exact_target;
  END IF;
  ALTER TABLE communication_blocks ADD CONSTRAINT communication_blocks_exact_target CHECK (
    (target_type = 'organization' AND organization_id IS NOT NULL AND contact_id IS NULL AND normalized_email IS NULL AND row_id IS NULL)
    OR (target_type = 'contact' AND organization_id IS NULL AND contact_id IS NOT NULL AND normalized_email IS NULL AND row_id IS NULL)
    OR (target_type = 'lead_import_row' AND organization_id IS NULL AND contact_id IS NULL AND normalized_email IS NULL AND row_id IS NOT NULL)
    OR (target_type = 'recipient_email' AND organization_id IS NULL AND contact_id IS NULL AND row_id IS NULL AND normalized_email LIKE '%@%.%' AND normalized_email NOT LIKE '% %')
    OR (target_type = 'internal_preview' AND organization_id IS NULL AND contact_id IS NULL AND normalized_email IS NULL AND row_id IS NULL)
  );
END $$;

CREATE TABLE IF NOT EXISTS communication_block_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id uuid NOT NULL REFERENCES communication_blocks(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action in ('created','removed')),
  actor_id text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS communication_block_events_history_idx ON communication_block_events (block_id, created_at);

CREATE OR REPLACE FUNCTION communication_blocks_write_created_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO communication_block_events (block_id, action, actor_id, reason) VALUES (NEW.id, 'created', NEW.created_by, NEW.reason);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS communication_blocks_created_event ON communication_blocks;
CREATE TRIGGER communication_blocks_created_event AFTER INSERT ON communication_blocks FOR EACH ROW EXECUTE FUNCTION communication_blocks_write_created_event();
