-- Additive reminder metadata; canonical bookings, invoices and follow-ups remain intact.
CREATE TABLE IF NOT EXISTS profile_deadlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('event','vendor','balance_due','next_action')),
  label text NOT NULL,
  due_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profile_deadlines_profile ON profile_deadlines(organization_id);
CREATE TABLE IF NOT EXISTS deadline_preferences (
  source_key text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  reminder_offsets integer[],
  completed_for_date date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reminder_offsets IS NULL OR (cardinality(reminder_offsets) <= 10 AND 0 <= ALL(reminder_offsets) AND 3650 >= ALL(reminder_offsets)))
);
CREATE TABLE IF NOT EXISTS deadline_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_key text UNIQUE,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  trigger jsonb NOT NULL,
  actions jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO deadline_rules(seed_key,name,trigger,actions) VALUES
 ('deadline_before','Upcoming deadlines — 14 and 7 days','{"type":"deadline_before","days":[14,7],"useItemOffsets":true}','["notify","badge"]'),
 ('deadline_passed','Overdue deadlines','{"type":"deadline_passed"}','["notify","badge"]'),
 ('prospect_inactive','Prospects with no activity for 21 days','{"type":"inactive","days":21}','["notify","badge"]')
ON CONFLICT (seed_key) DO NOTHING;
CREATE TABLE IF NOT EXISTS deadline_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  old_status text NOT NULL,
  new_status text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deadline_status_events_time ON deadline_status_events(occurred_at);
CREATE OR REPLACE FUNCTION record_deadline_status_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO deadline_status_events(organization_id,booking_id,old_status,new_status)
    VALUES(NEW.organization_id,NEW.id,OLD.status::text,NEW.status::text);
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='deadline_booking_status_event' AND tgrelid='bookings'::regclass) THEN
    CREATE TRIGGER deadline_booking_status_event AFTER UPDATE OF status ON bookings
    FOR EACH ROW EXECUTE FUNCTION record_deadline_status_event();
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS deadline_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES deadline_rules(id) ON DELETE RESTRICT,
  occurrence_key text NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  title text NOT NULL,
  due_on date,
  active boolean NOT NULL DEFAULT true,
  dismissed_at timestamptz,
  follow_up_id uuid REFERENCES follow_ups(id) ON DELETE RESTRICT,
  email_state text NOT NULL DEFAULT 'disabled',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rule_id,occurrence_key)
);
CREATE INDEX IF NOT EXISTS deadline_notifications_active ON deadline_notifications(active,created_at);
CREATE TABLE IF NOT EXISTS deadline_evaluation_state (
  id integer PRIMARY KEY CHECK(id=1),
  last_evaluated_at timestamptz
);
INSERT INTO deadline_evaluation_state(id) VALUES(1) ON CONFLICT DO NOTHING;
