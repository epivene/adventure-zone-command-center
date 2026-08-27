DO $$
BEGIN
  ALTER TYPE call_disposition ADD VALUE IF NOT EXISTS 'email_requested';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
