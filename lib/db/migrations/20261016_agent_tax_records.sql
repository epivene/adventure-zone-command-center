-- Personal booking-agent records deliberately do not use shared business documents.
CREATE TABLE IF NOT EXISTS agent_tax_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('income','expense','document')),
  amount_cents integer CHECK (amount_cents BETWEEN 0 AND 1000000000),
  record_date date,
  tax_year integer NOT NULL CHECK (tax_year BETWEEN 1900 AND 2200),
  category text NOT NULL CHECK (category IN ('commission','travel','supplies','fees','tax_form','other')),
  payment_method text NOT NULL CHECK (payment_method IN ('venmo','cash','bank','check','card','other')),
  counterparty text,
  notes text,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  storage_key text,
  file_name text,
  file_mime text,
  file_size integer,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (entry_type = 'document' OR (amount_cents IS NOT NULL AND record_date IS NOT NULL)),
  CHECK (record_date IS NULL OR EXTRACT(YEAR FROM record_date) = tax_year),
  CHECK ((storage_key IS NULL AND file_name IS NULL AND file_mime IS NULL AND file_size IS NULL)
    OR (storage_key IS NOT NULL AND file_name IS NOT NULL AND file_mime IS NOT NULL AND file_size > 0))
);
CREATE INDEX IF NOT EXISTS agent_tax_records_year ON agent_tax_records(tax_year, created_at DESC);
-- Durable cleanup queue: detached/deleted attachments remain inaccessible and
-- storage failures are retried rather than leaving untracked private objects.
CREATE TABLE IF NOT EXISTS agent_tax_file_deletions (
  storage_key text PRIMARY KEY,
  queued_at timestamptz NOT NULL DEFAULT now()
);
