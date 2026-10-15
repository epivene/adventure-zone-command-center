-- Owner reminder data. Existing booking, opportunity and invoice dates remain the source of truth.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS event_date date,
  ADD COLUMN IF NOT EXISTS vendor_deadline date,
  ADD COLUMN IF NOT EXISTS balance_due_date date,
  ADD COLUMN IF NOT EXISTS next_action_date date,
  ADD COLUMN IF NOT EXISTS reminder_offsets jsonb;

CREATE TABLE IF NOT EXISTS reminder_rules (
  id text PRIMARY KEY,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  trigger jsonb NOT NULL,
  actions jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reminder_notifications (
  key text PRIMARY KEY,
  rule_id text NOT NULL REFERENCES reminder_rules(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  due_date date,
  title text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reminder_notifications_active_due_idx
  ON reminder_notifications (active, due_date, organization_id);
CREATE TABLE IF NOT EXISTS reminder_profile_status (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  status text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO reminder_rules (id, name, trigger, actions) VALUES
  ('deadline_approaching', 'Deadline approaching', '{"type":"deadline_days_away","days":[14,7]}'::jsonb, '["notification","badge"]'::jsonb),
  ('deadline_passed', 'Deadline passed', '{"type":"deadline_passed"}'::jsonb, '["notification","badge"]'::jsonb),
  ('prospect_inactive', 'Prospect inactive for 21 days', '{"type":"no_activity","days":21}'::jsonb, '["notification","badge"]'::jsonb)
ON CONFLICT (id) DO NOTHING;
