-- Existing income can pay multiple earned periods without creating income again.
CREATE TABLE IF NOT EXISTS agent_pay_income_allocations (
  record_id uuid NOT NULL REFERENCES agent_tax_records(id) ON DELETE CASCADE,
  pay_item_id uuid NOT NULL REFERENCES agent_pay_items(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL CONSTRAINT agent_pay_allocation_amount_check CHECK (amount_cents BETWEEN 1 AND 1000000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (record_id, pay_item_id)
);
CREATE INDEX IF NOT EXISTS agent_pay_income_allocations_item ON agent_pay_income_allocations(pay_item_id);
