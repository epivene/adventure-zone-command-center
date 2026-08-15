DO $$
BEGIN
  IF to_regtype('probability') IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_DEFERRED: probability enum does not exist yet';
  END IF;
END $$;

ALTER TYPE probability ADD VALUE IF NOT EXISTS 'definite' BEFORE 'likely';
