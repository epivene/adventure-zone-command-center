ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS checklist_tags text[] NOT NULL DEFAULT ARRAY[]::text[];
