ALTER TABLE lead_import_rows
  ADD COLUMN IF NOT EXISTS territory_status text,
  ADD COLUMN IF NOT EXISTS fit_status text;

UPDATE lead_import_rows
SET territory_status = CASE
      WHEN territory_status in ('open','ask_amy_dave','closed','licensing_issue','needs_review') THEN territory_status
      ELSE 'needs_review'
    END,
    fit_status = CASE
      WHEN fit_status in ('approved','needs_review','not_a_fit') THEN fit_status
      ELSE 'needs_review'
    END;

ALTER TABLE lead_import_rows
  ALTER COLUMN territory_status SET DEFAULT 'needs_review',
  ALTER COLUMN territory_status SET NOT NULL,
  ALTER COLUMN fit_status SET DEFAULT 'needs_review',
  ALTER COLUMN fit_status SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE lead_import_rows DROP CONSTRAINT IF EXISTS lead_import_rows_territory_status_valid;
  ALTER TABLE lead_import_rows DROP CONSTRAINT IF EXISTS lead_import_rows_fit_status_valid;
  ALTER TABLE lead_import_rows ADD CONSTRAINT lead_import_rows_territory_status_valid
    CHECK (territory_status in ('open','ask_amy_dave','closed','licensing_issue','needs_review'));
  ALTER TABLE lead_import_rows ADD CONSTRAINT lead_import_rows_fit_status_valid
    CHECK (fit_status in ('approved','needs_review','not_a_fit'));
END $$;

DO $$ BEGIN
  IF to_regclass(current_schema() || '.communication_templates') IS NOT NULL THEN
    ALTER TABLE communication_templates ADD COLUMN IF NOT EXISTS template_version text;
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

ALTER TABLE communication_blocks
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS target_type text,
  ADD COLUMN IF NOT EXISTS organization_id uuid,
  ADD COLUMN IF NOT EXISTS contact_id uuid,
  ADD COLUMN IF NOT EXISTS normalized_email text,
  ADD COLUMN IF NOT EXISTS row_id uuid,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS removed_by text,
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS removal_reason text;

-- Legacy versions allowed a null recipient target. Drop the active-target index
-- before fail-closed repair so conversion cannot collide with an existing global
-- block; the canonical index is recreated after deterministic de-duplication.
DROP INDEX IF EXISTS communication_blocks_active_target_unique;

UPDATE communication_blocks
SET id = coalesce(id, gen_random_uuid()),
    target_type = coalesce(target_type, 'internal_preview'),
    reason = coalesce(nullif(btrim(reason), ''), 'Startup repair: retained as fail-closed internal preview block'),
    active = coalesce(active, true),
    created_by = coalesce(nullif(btrim(created_by), ''), 'system:startup-repair'),
    created_at = coalesce(created_at, now());

UPDATE communication_blocks
SET target_type = 'internal_preview',
    normalized_email = NULL,
    reason = reason || ' [Startup repair: missing recipient target; converted to global internal preview.]'
WHERE target_type = 'recipient_email' AND normalized_email IS NULL;

WITH ranked_active_targets AS (
  SELECT id, row_number() OVER (
    PARTITION BY target_type, coalesce(organization_id::text,''),
      coalesce(contact_id::text,''), coalesce(normalized_email,''), coalesce(row_id::text,'')
    ORDER BY created_at, id
  ) AS ordinal
  FROM communication_blocks
  WHERE active
)
UPDATE communication_blocks block
SET active = false,
    removed_by = coalesce(block.removed_by, 'system:startup-repair'),
    removed_at = coalesce(block.removed_at, now()),
    removal_reason = coalesce(block.removal_reason, 'Startup repair: duplicate active communication block')
FROM ranked_active_targets ranked
WHERE block.id = ranked.id AND ranked.ordinal > 1;

ALTER TABLE communication_blocks
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN target_type SET NOT NULL,
  ALTER COLUMN reason SET NOT NULL,
  ALTER COLUMN active SET DEFAULT true,
  ALTER COLUMN active SET NOT NULL,
  ALTER COLUMN created_by SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'communication_blocks'::regclass AND contype = 'p') THEN
    ALTER TABLE communication_blocks ADD CONSTRAINT communication_blocks_pkey PRIMARY KEY (id);
  END IF;
  ALTER TABLE communication_blocks DROP CONSTRAINT IF EXISTS communication_blocks_target_valid;
  ALTER TABLE communication_blocks DROP CONSTRAINT IF EXISTS communication_blocks_exact_target;
  ALTER TABLE communication_blocks DROP CONSTRAINT IF EXISTS communication_blocks_organization_fk;
  ALTER TABLE communication_blocks DROP CONSTRAINT IF EXISTS communication_blocks_contact_fk;
  ALTER TABLE communication_blocks DROP CONSTRAINT IF EXISTS communication_blocks_row_fk;
  ALTER TABLE communication_blocks ADD CONSTRAINT communication_blocks_target_valid
    CHECK (target_type in ('organization','contact','recipient_email','lead_import_row','internal_preview'));
  ALTER TABLE communication_blocks ADD CONSTRAINT communication_blocks_exact_target CHECK (
    (target_type = 'organization' AND organization_id IS NOT NULL AND contact_id IS NULL AND normalized_email IS NULL AND row_id IS NULL)
    OR (target_type = 'contact' AND organization_id IS NULL AND contact_id IS NOT NULL AND normalized_email IS NULL AND row_id IS NULL)
    OR (target_type = 'lead_import_row' AND organization_id IS NULL AND contact_id IS NULL AND normalized_email IS NULL AND row_id IS NOT NULL)
    OR (target_type = 'recipient_email' AND organization_id IS NULL AND contact_id IS NULL AND row_id IS NULL
      AND normalized_email IS NOT NULL
      AND normalized_email = lower(btrim(normalized_email))
      AND normalized_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    OR (target_type = 'internal_preview' AND organization_id IS NULL AND contact_id IS NULL AND normalized_email IS NULL AND row_id IS NULL)
  );
  ALTER TABLE communication_blocks ADD CONSTRAINT communication_blocks_organization_fk
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;
  ALTER TABLE communication_blocks ADD CONSTRAINT communication_blocks_contact_fk
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE RESTRICT;
  ALTER TABLE communication_blocks ADD CONSTRAINT communication_blocks_row_fk
    FOREIGN KEY (row_id) REFERENCES lead_import_rows(id) ON DELETE RESTRICT;
END $$;

DROP INDEX IF EXISTS communication_blocks_active_target_unique;
CREATE UNIQUE INDEX communication_blocks_active_target_unique ON communication_blocks
  (target_type, coalesce(organization_id::text,''), coalesce(contact_id::text,''), coalesce(normalized_email,''), coalesce(row_id::text,''))
  WHERE active;
DROP INDEX IF EXISTS communication_blocks_active_lookup_idx;
CREATE INDEX communication_blocks_active_lookup_idx ON communication_blocks
  (active, normalized_email, organization_id, contact_id, row_id);

CREATE TABLE IF NOT EXISTS communication_block_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id uuid NOT NULL,
  action text NOT NULL,
  actor_id text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE communication_block_events
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS block_id uuid,
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS actor_id text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

ALTER TABLE communication_block_events
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN block_id SET NOT NULL,
  ALTER COLUMN action SET NOT NULL,
  ALTER COLUMN actor_id SET NOT NULL,
  ALTER COLUMN reason SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'communication_block_events'::regclass AND contype = 'p') THEN
    ALTER TABLE communication_block_events ADD CONSTRAINT communication_block_events_pkey PRIMARY KEY (id);
  END IF;
  ALTER TABLE communication_block_events DROP CONSTRAINT IF EXISTS communication_block_events_block_id_fkey;
  ALTER TABLE communication_block_events DROP CONSTRAINT IF EXISTS communication_block_events_block_fk;
  ALTER TABLE communication_block_events DROP CONSTRAINT IF EXISTS communication_block_events_action_check;
  ALTER TABLE communication_block_events DROP CONSTRAINT IF EXISTS communication_block_events_action_valid;
  ALTER TABLE communication_block_events ADD CONSTRAINT communication_block_events_block_fk
    FOREIGN KEY (block_id) REFERENCES communication_blocks(id) ON DELETE RESTRICT;
  ALTER TABLE communication_block_events ADD CONSTRAINT communication_block_events_action_valid
    CHECK (action in ('created','removed'));
END $$;

DROP INDEX IF EXISTS communication_block_events_history_idx;
CREATE INDEX communication_block_events_history_idx ON communication_block_events (block_id, created_at);

INSERT INTO communication_block_events (block_id, action, actor_id, reason, created_at)
SELECT block.id, 'created', block.created_by, block.reason, block.created_at
FROM communication_blocks block
WHERE NOT EXISTS (
  SELECT 1 FROM communication_block_events event
  WHERE event.block_id = block.id AND event.action = 'created'
);

INSERT INTO communication_block_events (block_id, action, actor_id, reason, created_at)
SELECT block.id, 'removed', coalesce(block.removed_by, 'system:startup-repair'),
  coalesce(block.removal_reason, 'Startup repair: retained historical removal'),
  coalesce(block.removed_at, block.created_at)
FROM communication_blocks block
WHERE NOT block.active AND NOT EXISTS (
  SELECT 1 FROM communication_block_events event
  WHERE event.block_id = block.id AND event.action = 'removed'
);

CREATE OR REPLACE FUNCTION communication_blocks_created_event_backfill_v2_ready()
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;

CREATE OR REPLACE FUNCTION communication_blocks_write_created_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO communication_block_events (block_id, action, actor_id, reason)
  VALUES (NEW.id, 'created', NEW.created_by, NEW.reason);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS communication_blocks_created_event ON communication_blocks;
CREATE TRIGGER communication_blocks_created_event
AFTER INSERT ON communication_blocks
FOR EACH ROW EXECUTE FUNCTION communication_blocks_write_created_event();
