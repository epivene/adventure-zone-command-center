CREATE TABLE IF NOT EXISTS boss_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), login_name text NOT NULL, display_name text NOT NULL,
  role text NOT NULL DEFAULT 'boss', password_hash text NOT NULL, password_salt text NOT NULL,
  studio_office_account_id uuid REFERENCES office_accounts(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true, session_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT boss_accounts_role_valid CHECK (role = 'boss'),
  CONSTRAINT boss_accounts_session_version_positive CHECK (session_version >= 1)
);
ALTER TABLE boss_accounts ADD COLUMN IF NOT EXISTS studio_office_account_id uuid REFERENCES office_accounts(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS boss_accounts_login_name_lower_unique ON boss_accounts (lower(login_name));
CREATE TABLE IF NOT EXISTS boss_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), assignee_kind text NOT NULL, office_account_id uuid REFERENCES office_accounts(id) ON DELETE RESTRICT,
  title text NOT NULL, details text, priority text NOT NULL DEFAULT 'normal', due_at timestamptz,
  status text NOT NULL DEFAULT 'todo', completed_at timestamptz,
  created_by_boss_id uuid NOT NULL REFERENCES boss_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT boss_assignments_assignee_valid CHECK ((assignee_kind = 'owner' AND office_account_id IS NULL) OR (assignee_kind = 'office' AND office_account_id IS NOT NULL)),
  CONSTRAINT boss_assignments_priority_valid CHECK (priority IN ('low','normal','high','urgent')),
  CONSTRAINT boss_assignments_status_valid CHECK (status IN ('todo','in_progress','waiting','done','cancelled'))
);
CREATE INDEX IF NOT EXISTS boss_assignments_office_status_idx ON boss_assignments (office_account_id, status, due_at);
CREATE INDEX IF NOT EXISTS boss_assignments_owner_status_idx ON boss_assignments (assignee_kind, status, due_at);