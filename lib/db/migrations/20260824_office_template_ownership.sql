BEGIN;

ALTER TABLE communication_templates
  ADD COLUMN IF NOT EXISTS owner_kind text NOT NULL DEFAULT 'company',
  ADD COLUMN IF NOT EXISTS owner_office_account_id uuid,
  ADD COLUMN IF NOT EXISTS created_by_kind text NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS created_by_id uuid,
  ADD COLUMN IF NOT EXISTS source_template_id uuid;

UPDATE communication_templates
SET owner_kind = 'company'
WHERE owner_kind IS NULL;

UPDATE communication_templates
SET created_by_kind = 'system'
WHERE created_by_kind IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'communication_templates_owner_kind_valid'
  ) THEN
    ALTER TABLE communication_templates
      ADD CONSTRAINT communication_templates_owner_kind_valid
      CHECK (owner_kind IN ('company','shared_office','office_user'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'communication_templates_created_by_kind_valid'
  ) THEN
    ALTER TABLE communication_templates
      ADD CONSTRAINT communication_templates_created_by_kind_valid
      CHECK (created_by_kind IN ('system','owner','office_user'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'communication_templates_owner_account_shape_valid'
  ) THEN
    ALTER TABLE communication_templates
      ADD CONSTRAINT communication_templates_owner_account_shape_valid
      CHECK (
        (owner_kind = 'office_user' AND owner_office_account_id IS NOT NULL)
        OR
        (owner_kind IN ('company','shared_office') AND owner_office_account_id IS NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'communication_templates_owner_office_account_fk'
  ) THEN
    ALTER TABLE communication_templates
      ADD CONSTRAINT communication_templates_owner_office_account_fk
      FOREIGN KEY (owner_office_account_id)
      REFERENCES office_accounts(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'communication_templates_source_template_fk'
  ) THEN
    ALTER TABLE communication_templates
      ADD CONSTRAINT communication_templates_source_template_fk
      FOREIGN KEY (source_template_id)
      REFERENCES communication_templates(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS communication_templates_state_owner_kind_idx
  ON communication_templates(state, owner_kind);

CREATE INDEX IF NOT EXISTS communication_templates_owner_account_state_idx
  ON communication_templates(owner_office_account_id, state);

CREATE INDEX IF NOT EXISTS communication_templates_source_template_idx
  ON communication_templates(source_template_id);

COMMIT;
