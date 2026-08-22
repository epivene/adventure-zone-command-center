CREATE TABLE IF NOT EXISTS business_source_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_filename text NOT NULL,
  display_title text NOT NULL,
  source_category text NOT NULL,
  effective_year integer,
  access_scope text NOT NULL DEFAULT 'owner',
  review_state text NOT NULL DEFAULT 'unreviewed',
  storage_reference text,
  notes text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_source_documents_access_valid CHECK (
    access_scope IN ('owner','office','manager','public_template')
  ),
  CONSTRAINT business_source_documents_review_valid CHECK (
    review_state IN ('unreviewed','reviewed','superseded','archived')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS business_source_documents_filename_unique
  ON business_source_documents(original_filename);
CREATE INDEX IF NOT EXISTS business_source_documents_category_review_idx
  ON business_source_documents(source_category, review_state);

CREATE TABLE IF NOT EXISTS business_source_fact_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id uuid NOT NULL REFERENCES business_source_documents(id) ON DELETE CASCADE,
  fact_key text NOT NULL,
  entity_kind text NOT NULL,
  entity_key text,
  proposed_value text NOT NULL,
  normalized_value text,
  source_locator text NOT NULL,
  review_state text NOT NULL DEFAULT 'proposed',
  conflict_group text,
  reviewer text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_source_fact_reviews_state_valid CHECK (
    review_state IN ('proposed','approved','conflict','rejected','superseded')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS business_source_fact_reviews_identity_unique
  ON business_source_fact_reviews(source_document_id, fact_key, source_locator);
CREATE INDEX IF NOT EXISTS business_source_fact_reviews_conflict_idx
  ON business_source_fact_reviews(review_state, conflict_group);
CREATE INDEX IF NOT EXISTS business_source_fact_reviews_entity_idx
  ON business_source_fact_reviews(entity_kind, entity_key);

CREATE TABLE IF NOT EXISTS communication_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  category text NOT NULL,
  subject_template text,
  body_template text NOT NULL,
  allowed_placeholders text[] NOT NULL DEFAULT ARRAY[]::text[],
  required_placeholders text[] NOT NULL DEFAULT ARRAY[]::text[],
  access_scope text NOT NULL DEFAULT 'owner',
  state text NOT NULL DEFAULT 'draft',
  source_document_id uuid REFERENCES business_source_documents(id) ON DELETE SET NULL,
  source_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_templates_channel_valid CHECK (
    channel IN ('email','internal_email')
  ),
  CONSTRAINT communication_templates_access_valid CHECK (
    access_scope IN ('owner','office')
  ),
  CONSTRAINT communication_templates_state_valid CHECK (
    state IN ('draft','reviewed','active','archived')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS communication_templates_code_unique
  ON communication_templates(code);
CREATE INDEX IF NOT EXISTS communication_templates_state_access_category_idx
  ON communication_templates(state, access_scope, category);

ALTER TABLE office_email_drafts
  ADD COLUMN IF NOT EXISTS communication_template_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'office_email_drafts_communication_template_fk'
  ) THEN
    ALTER TABLE office_email_drafts
      ADD CONSTRAINT office_email_drafts_communication_template_fk
      FOREIGN KEY (communication_template_id)
      REFERENCES communication_templates(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS office_email_drafts_template_idx
  ON office_email_drafts(communication_template_id)
  WHERE communication_template_id IS NOT NULL;
