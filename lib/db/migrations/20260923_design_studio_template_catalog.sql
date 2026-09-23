ALTER TABLE design_projects
  ADD COLUMN IF NOT EXISTS source_template_id uuid,
  ADD COLUMN IF NOT EXISTS source_catalog_revision integer,
  ADD COLUMN IF NOT EXISTS document_year integer;

ALTER TABLE design_templates
  ADD COLUMN IF NOT EXISTS catalog_key text,
  ADD COLUMN IF NOT EXISTS catalog_revision integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS template_family text,
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'design_projects_source_template_fk'
  ) THEN
    ALTER TABLE design_projects
      ADD CONSTRAINT design_projects_source_template_fk
      FOREIGN KEY (source_template_id) REFERENCES design_templates(id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE design_projects DROP CONSTRAINT IF EXISTS design_projects_type_valid;
ALTER TABLE design_projects
  ADD CONSTRAINT design_projects_type_valid
  CHECK (type IN ('flyer','social_post','email','brochure','review_request','contract','proposal','blank'));

ALTER TABLE design_templates DROP CONSTRAINT IF EXISTS design_templates_type_valid;
ALTER TABLE design_templates
  ADD CONSTRAINT design_templates_type_valid
  CHECK (type IN ('flyer','social_post','email','brochure','review_request','contract','proposal','blank'));

ALTER TABLE design_templates DROP CONSTRAINT IF EXISTS design_templates_state_valid;
ALTER TABLE design_templates
  ADD CONSTRAINT design_templates_state_valid
  CHECK (state IN ('active','archived'));

ALTER TABLE design_templates DROP CONSTRAINT IF EXISTS design_templates_family_valid;
ALTER TABLE design_templates
  ADD CONSTRAINT design_templates_family_valid
  CHECK (template_family IS NULL OR template_family IN ('email','contract','proposal'));

CREATE UNIQUE INDEX IF NOT EXISTS design_templates_catalog_key_unique
  ON design_templates(catalog_key)
  WHERE catalog_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS design_templates_family_state_idx
  ON design_templates(template_family, state);
CREATE INDEX IF NOT EXISTS design_projects_organization_year_idx
  ON design_projects(linked_organization_id, document_year, updated_at);

UPDATE design_projects
SET status = 'archived',
    archived_at = COALESCE(archived_at, now()),
    updated_at = now()
WHERE status <> 'archived';

UPDATE design_templates
SET state = 'archived',
    archived_at = COALESCE(archived_at, now()),
    updated_at = now()
WHERE state <> 'archived';

UPDATE communication_templates
SET state = 'archived',
    updated_at = now()
WHERE state <> 'archived';
