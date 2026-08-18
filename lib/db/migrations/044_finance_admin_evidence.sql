ALTER TABLE leg_expenses
  ADD COLUMN IF NOT EXISTS assignment_source text,
  ADD COLUMN IF NOT EXISTS assignment_reason text,
  ADD COLUMN IF NOT EXISTS assignment_updated_at timestamptz;

UPDATE leg_expenses
SET assignment_source = CASE
  WHEN booking_id IS NOT NULL OR trip_id IS NOT NULL OR trip_segment_id IS NOT NULL THEN 'legacy'
  ELSE 'unassigned'
END,
assignment_updated_at = COALESCE(updated_at, created_at, now())
WHERE assignment_source IS NULL;

ALTER TABLE leg_expenses
  ALTER COLUMN assignment_source SET DEFAULT 'unassigned',
  ALTER COLUMN assignment_source SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE leg_expenses
    ADD CONSTRAINT leg_expenses_assignment_source_valid
    CHECK (assignment_source IN ('legacy','explicit','automatic','admin','unassigned'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION leg_expenses_set_initial_assignment_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.assignment_source IS NULL OR NEW.assignment_source = 'unassigned' THEN
    IF NEW.booking_id IS NOT NULL OR NEW.trip_id IS NOT NULL OR NEW.trip_segment_id IS NOT NULL THEN
      NEW.assignment_source := 'explicit';
    ELSE
      NEW.assignment_source := 'unassigned';
    END IF;
  END IF;
  NEW.assignment_updated_at := COALESCE(NEW.assignment_updated_at, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leg_expenses_initial_assignment_source ON leg_expenses;
CREATE TRIGGER leg_expenses_initial_assignment_source
BEFORE INSERT ON leg_expenses
FOR EACH ROW
EXECUTE FUNCTION leg_expenses_set_initial_assignment_source();

CREATE TABLE IF NOT EXISTS leg_finance_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type text NOT NULL,
  record_id uuid NOT NULL,
  actor_id text,
  actor_label text NOT NULL DEFAULT 'Authenticated admin',
  change_reason text,
  previous_values jsonb NOT NULL,
  new_values jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leg_finance_audit_record_type_valid CHECK (record_type IN ('expense'))
);

CREATE INDEX IF NOT EXISTS leg_finance_audit_record_idx
  ON leg_finance_audit(record_type, record_id, changed_at DESC);
