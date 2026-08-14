ALTER TABLE "activities"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "activities_deleted_at_idx"
  ON "activities" ("deleted_at");
