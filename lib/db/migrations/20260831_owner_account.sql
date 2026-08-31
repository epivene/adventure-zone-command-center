CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS owner_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton_key text NOT NULL DEFAULT 'primary',
  login_name text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'owner',
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  session_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE owner_accounts
  ADD COLUMN IF NOT EXISTS id uuid,
  ADD COLUMN IF NOT EXISTS singleton_key text,
  ADD COLUMN IF NOT EXISTS login_name text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS role text,
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS password_salt text,
  ADD COLUMN IF NOT EXISTS enabled boolean,
  ADD COLUMN IF NOT EXISTS session_version bigint,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE owner_accounts
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN singleton_key SET DEFAULT 'primary',
  ALTER COLUMN role SET DEFAULT 'owner',
  ALTER COLUMN enabled SET DEFAULT true,
  ALTER COLUMN session_version SET DEFAULT 1,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN singleton_key SET NOT NULL,
  ALTER COLUMN login_name SET NOT NULL,
  ALTER COLUMN display_name SET NOT NULL,
  ALTER COLUMN role SET NOT NULL,
  ALTER COLUMN password_hash SET NOT NULL,
  ALTER COLUMN password_salt SET NOT NULL,
  ALTER COLUMN enabled SET NOT NULL,
  ALTER COLUMN session_version SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

DO $owner_account_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'owner_accounts'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE owner_accounts
      ADD CONSTRAINT owner_accounts_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'owner_accounts'::regclass
      AND conname = 'owner_accounts_singleton_valid'
  ) THEN
    ALTER TABLE owner_accounts
      ADD CONSTRAINT owner_accounts_singleton_valid
      CHECK (singleton_key = 'primary');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'owner_accounts'::regclass
      AND conname = 'owner_accounts_role_valid'
  ) THEN
    ALTER TABLE owner_accounts
      ADD CONSTRAINT owner_accounts_role_valid
      CHECK (role = 'owner');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'owner_accounts'::regclass
      AND conname = 'owner_accounts_session_version_positive'
  ) THEN
    ALTER TABLE owner_accounts
      ADD CONSTRAINT owner_accounts_session_version_positive
      CHECK (session_version >= 1);
  END IF;
END
$owner_account_constraints$;

CREATE UNIQUE INDEX IF NOT EXISTS owner_accounts_singleton_unique
  ON owner_accounts (singleton_key);
CREATE UNIQUE INDEX IF NOT EXISTS owner_accounts_login_name_lower_unique
  ON owner_accounts (lower(login_name));
