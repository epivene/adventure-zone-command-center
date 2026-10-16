CREATE TABLE IF NOT EXISTS agent_pay_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('weekly','manual')),
  earned_date date NOT NULL,
  due_date date,
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 1000000000),
  notes text,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_pay_week_unique
  ON agent_pay_items(earned_date) WHERE kind='weekly';
ALTER TABLE agent_tax_records ADD COLUMN IF NOT EXISTS pay_item_id uuid
  REFERENCES agent_pay_items(id) ON DELETE RESTRICT;
ALTER TABLE agent_tax_records ADD COLUMN IF NOT EXISTS payment_request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS agent_tax_payment_request_unique
  ON agent_tax_records(payment_request_id) WHERE payment_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_tax_pay_item ON agent_tax_records(pay_item_id);
CREATE TABLE IF NOT EXISTS agent_tax_estimate_settings (
  tax_year integer PRIMARY KEY CHECK (tax_year IN (2025,2026)),
  settings jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
