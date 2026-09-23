ALTER TABLE design_templates
  DROP CONSTRAINT IF EXISTS design_templates_type_check;
ALTER TABLE design_templates
  DROP CONSTRAINT IF EXISTS design_templates_type_valid;
ALTER TABLE design_templates
  ADD CONSTRAINT design_templates_type_valid
  CHECK (type IN ('flyer','social_post','email','brochure','review_request','contract','proposal','blank'));

ALTER TABLE design_projects
  DROP CONSTRAINT IF EXISTS design_projects_type_check;
ALTER TABLE design_projects
  DROP CONSTRAINT IF EXISTS design_projects_type_valid;
ALTER TABLE design_projects
  ADD CONSTRAINT design_projects_type_valid
  CHECK (type IN ('flyer','social_post','email','brochure','review_request','contract','proposal','blank'));
