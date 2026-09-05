ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS filler boolean DEFAULT false NOT NULL;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS filler_reason text;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS filler_changed_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'organizations'::regclass
      AND conname = 'organizations_filler_reason_required'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'organizations'::regclass
      AND conname = 'organizations_filler_reason_required'
      AND contype = 'c'
      AND convalidated
      AND regexp_replace(lower(pg_get_constraintdef(oid)), '\s+', '', 'g')
        = 'check(((notfiller)or(nullif(btrim(filler_reason),''''::text)isnotnull)))'
  ) THEN
    ALTER TABLE organizations
      DROP CONSTRAINT organizations_filler_reason_required;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'organizations'::regclass
      AND conname = 'organizations_filler_reason_required'
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_filler_reason_required
      CHECK (NOT filler OR nullif(btrim(filler_reason), '') IS NOT NULL);
  END IF;
END
$$;
