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
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_accounts_singleton_valid CHECK (singleton_key = 'primary'),
  CONSTRAINT owner_accounts_role_valid CHECK (role = 'owner'),
  CONSTRAINT owner_accounts_session_version_positive CHECK (session_version >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS owner_accounts_singleton_unique
  ON owner_accounts (singleton_key);
CREATE UNIQUE INDEX IF NOT EXISTS owner_accounts_login_name_lower_unique
  ON owner_accounts (lower(login_name));
