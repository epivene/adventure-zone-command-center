ALTER TABLE communication_template_reviews
  ADD COLUMN IF NOT EXISTS position integer,
  ADD COLUMN IF NOT EXISTS template_name_snapshot text,
  ADD COLUMN IF NOT EXISTS verified_links jsonb;

UPDATE communication_template_reviews AS review
SET
  position = COALESCE(review.position, 0),
  template_name_snapshot = COALESCE(review.template_name_snapshot, template.name, 'Email template'),
  verified_links = COALESCE(review.verified_links, '[]'::jsonb)
FROM communication_templates AS template
WHERE template.id = review.template_id
  AND (
    review.position IS NULL
    OR review.template_name_snapshot IS NULL
    OR review.verified_links IS NULL
  );

UPDATE communication_template_reviews
SET
  position = COALESCE(position, 0),
  template_name_snapshot = COALESCE(template_name_snapshot, 'Email template'),
  verified_links = COALESCE(verified_links, '[]'::jsonb)
WHERE position IS NULL OR template_name_snapshot IS NULL OR verified_links IS NULL;

ALTER TABLE communication_template_reviews
  ALTER COLUMN position SET DEFAULT 0,
  ALTER COLUMN position SET NOT NULL,
  ALTER COLUMN template_name_snapshot SET NOT NULL,
  ALTER COLUMN verified_links SET DEFAULT '[]'::jsonb,
  ALTER COLUMN verified_links SET NOT NULL;

ALTER TABLE communication_template_reviews
    DROP CONSTRAINT IF EXISTS communication_template_reviews_request_id_key;

  DROP INDEX IF EXISTS communication_template_reviews_request_unique;

CREATE UNIQUE INDEX IF NOT EXISTS communication_template_reviews_request_template_unique
  ON communication_template_reviews (request_id, template_id);

CREATE UNIQUE INDEX IF NOT EXISTS communication_template_reviews_request_position_unique
  ON communication_template_reviews (request_id, position);
