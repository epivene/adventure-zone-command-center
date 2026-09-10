-- Additive workspace state; safe to rerun after partial application.
ALTER TABLE outreach_candidates ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;
ALTER TABLE outreach_candidates ADD COLUMN IF NOT EXISTS cadence_override jsonb;
ALTER TABLE outreach_research_tasks ADD COLUMN IF NOT EXISTS qualification_criteria jsonb;
ALTER TABLE outreach_research_tasks ADD COLUMN IF NOT EXISTS target_count integer NOT NULL DEFAULT 3;
CREATE OR REPLACE FUNCTION outreach_valid_cadence(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE gap integer; a integer; b integer; c integer;
BEGIN
  IF value IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(value)<>'object' OR jsonb_typeof(value->'days')<>'array' OR jsonb_array_length(value->'days')<>3 OR nullif(trim(value->>'reason'),'') IS NULL THEN RETURN false; END IF;
  IF NOT coalesce((value->>'minimumGapDays') ~ '^[1-9][0-9]*$',false) OR NOT coalesce((value->'days'->>0) ~ '^[1-9][0-9]*$',false) OR NOT coalesce((value->'days'->>1) ~ '^[1-9][0-9]*$',false) OR NOT coalesce((value->'days'->>2) ~ '^[1-9][0-9]*$',false) THEN RETURN false; END IF;
  gap=(value->>'minimumGapDays')::integer;a=(value->'days'->>0)::integer;b=(value->'days'->>1)::integer;c=(value->'days'->>2)::integer;
  RETURN gap<=3650 AND c<=3650 AND a>=gap AND b-a>=gap AND c-b>=gap;
EXCEPTION WHEN numeric_value_out_of_range THEN RETURN false;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='outreach_candidates_cadence_valid' AND conrelid='outreach_candidates'::regclass) THEN ALTER TABLE outreach_candidates ADD CONSTRAINT outreach_candidates_cadence_valid CHECK(outreach_valid_cadence(cadence_override)); END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='outreach_research_target_valid' AND conrelid='outreach_research_tasks'::regclass) THEN ALTER TABLE outreach_research_tasks ADD CONSTRAINT outreach_research_target_valid CHECK(target_count BETWEEN 1 AND 100); END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='outreach_research_qualification_valid' AND conrelid='outreach_research_tasks'::regclass) THEN ALTER TABLE outreach_research_tasks ADD CONSTRAINT outreach_research_qualification_valid CHECK(qualification_criteria IS NULL OR jsonb_typeof(qualification_criteria)='object'); END IF;
END $$;
CREATE INDEX IF NOT EXISTS outreach_candidates_snoozed_idx ON outreach_candidates(snoozed_until) WHERE snoozed_until IS NOT NULL;
-- Legacy free-text research contains no qualification proof. Preserve every
-- result, but do not keep a completed-gap claim based only on row count.
UPDATE outreach_research_tasks task SET status=CASE WHEN opening.status='open' THEN 'pending' ELSE 'paused' END
FROM outreach_openings opening WHERE opening.id=task.opening_id AND task.qualification_criteria IS NULL AND task.status='completed';
