ALTER TABLE communication_templates
  ADD COLUMN IF NOT EXISTS editor_document jsonb,
  ADD COLUMN IF NOT EXISTS editor_document_version integer;

ALTER TABLE communication_templates
  DROP CONSTRAINT IF EXISTS communication_templates_editor_document_shape;

ALTER TABLE communication_templates
  ADD CONSTRAINT communication_templates_editor_document_shape CHECK (
    (editor_document IS NULL AND editor_document_version IS NULL)
    OR (editor_document IS NOT NULL AND editor_document_version = 1)
  );
