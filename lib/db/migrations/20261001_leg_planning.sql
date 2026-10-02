-- The same coordination objects are used even when the outreach UI is disabled.
CREATE TABLE IF NOT EXISTS outreach_allocation_mutex (id integer PRIMARY KEY CHECK(id=1),generation integer NOT NULL DEFAULT 0);
INSERT INTO outreach_allocation_mutex(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS outreach_write_receipts (
 transaction_id bigint PRIMARY KEY,mode text NOT NULL CHECK(mode IN ('allocation','commitment','reconciliation')),
 source text NOT NULL,validated boolean NOT NULL DEFAULT false,dirty boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS leg_season_plans (
  leg_id uuid NOT NULL REFERENCES travel_legs(id), season_year integer NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0), payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leg_season_plans_identity PRIMARY KEY(leg_id,season_year)
);
CREATE TABLE IF NOT EXISTS crew_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), worker_id uuid NOT NULL REFERENCES crew_workers(id),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  state text NOT NULL CHECK(state IN ('confirmed','unavailable','unverified')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0), payload jsonb NOT NULL,
  CONSTRAINT crew_availability_window CHECK(ends_at>starts_at)
);
CREATE INDEX IF NOT EXISTS crew_availability_worker_window ON crew_availability(worker_id,starts_at,ends_at);
CREATE TABLE IF NOT EXISTS package_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), package_id uuid NOT NULL REFERENCES package_templates(id),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0), payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS package_set_members (
  set_id uuid NOT NULL REFERENCES package_sets(id) ON DELETE CASCADE, resource_id uuid NOT NULL REFERENCES resources(id),
  CONSTRAINT package_set_members_identity PRIMARY KEY(set_id,resource_id)
);
CREATE INDEX IF NOT EXISTS package_set_members_resource ON package_set_members(resource_id);
CREATE TABLE IF NOT EXISTS leg_event_plans (
  booking_id uuid PRIMARY KEY REFERENCES bookings(id), leg_id uuid NOT NULL REFERENCES travel_legs(id),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0), draft jsonb NOT NULL, committed jsonb,
  invalidation_reasons jsonb NOT NULL DEFAULT '[]', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leg_event_plans_leg ON leg_event_plans(leg_id);
CREATE TABLE IF NOT EXISTS leg_plan_crew_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL REFERENCES bookings(id),
  worker_id uuid NOT NULL REFERENCES crew_workers(id), leg_id uuid NOT NULL REFERENCES travel_legs(id),
  role text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  CONSTRAINT leg_plan_crew_window CHECK(ends_at>starts_at),
  CONSTRAINT leg_plan_crew_identity UNIQUE(booking_id,worker_id)
);
CREATE INDEX IF NOT EXISTS leg_plan_crew_worker_window ON leg_plan_crew_commitments(worker_id,starts_at,ends_at);
CREATE TABLE IF NOT EXISTS leg_plan_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_leg_id uuid NOT NULL REFERENCES travel_legs(id),
  booking_a_id uuid NOT NULL REFERENCES bookings(id), booking_b_id uuid NOT NULL REFERENCES bookings(id),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  CONSTRAINT leg_plan_split_distinct CHECK(booking_a_id<>booking_b_id)
);
CREATE INDEX IF NOT EXISTS leg_plan_splits_bookings ON leg_plan_splits(booking_a_id,booking_b_id);
CREATE TABLE IF NOT EXISTS leg_plan_authorities (
  singleton integer PRIMARY KEY DEFAULT 1 CHECK(singleton=1), account_id uuid REFERENCES boss_accounts(id),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0)
);
CREATE TABLE IF NOT EXISTS leg_plan_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_leg_id uuid NOT NULL REFERENCES travel_legs(id),
  type text NOT NULL CHECK(type IN ('split','extra_adventure_zone','extra_pirates')),
  booking_ids jsonb NOT NULL, plan_fingerprint text NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','decided')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leg_plan_requests_bookings ON leg_plan_approval_requests USING gin(booking_ids);
CREATE TABLE IF NOT EXISTS leg_plan_approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES leg_plan_approval_requests(id),
  decision text NOT NULL CHECK(decision IN ('approved','declined','revoked')), actor jsonb NOT NULL,
  authority_revision integer NOT NULL, plan_fingerprint text NOT NULL, reason text NOT NULL CHECK(length(trim(reason))>0),
  strategic_acknowledgement boolean NOT NULL DEFAULT false, decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leg_plan_decisions_request ON leg_plan_approval_decisions(request_id,decided_at);
CREATE TABLE IF NOT EXISTS leg_plan_mutation_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_key text NOT NULL, request_key text NOT NULL,
  body_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leg_plan_receipt_identity UNIQUE(actor_key,request_key)
);
CREATE OR REPLACE FUNCTION leg_plan_decision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Leg approval decisions are append-only'; END $$;
DROP TRIGGER IF EXISTS leg_plan_decision_immutable ON leg_plan_approval_decisions;
CREATE TRIGGER leg_plan_decision_immutable BEFORE UPDATE OR DELETE ON leg_plan_approval_decisions
FOR EACH ROW EXECUTE FUNCTION leg_plan_decision_immutable();

CREATE OR REPLACE FUNCTION leg_planning_guard_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt outreach_write_receipts; old_value jsonb; new_value jsonb;
BEGIN
 IF current_setting('outreach.enforced',true) IS DISTINCT FROM 'true' THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' THEN
   old_value := to_jsonb(OLD) - ARRAY['updated_at','created_at']; new_value := to_jsonb(NEW) - ARRAY['updated_at','created_at'];
   IF TG_TABLE_NAME='bookings' THEN
     old_value := jsonb_build_array(old_value->'starts_at',old_value->'ends_at',old_value->'status',old_value->'probability',old_value->'travel_leg_id',old_value->'latitude',old_value->'longitude');
     new_value := jsonb_build_array(new_value->'starts_at',new_value->'ends_at',new_value->'status',new_value->'probability',new_value->'travel_leg_id',new_value->'latitude',new_value->'longitude');
   END IF;
   IF old_value IS NOT DISTINCT FROM new_value THEN RETURN NULL; END IF;
 END IF;
 SELECT * INTO receipt FROM outreach_write_receipts WHERE transaction_id=txid_current();
 IF NOT FOUND THEN RAISE EXCEPTION 'Planning allocation participation required for %',TG_TABLE_NAME USING ERRCODE='23514'; END IF;
 IF receipt.mode='allocation' AND TG_TABLE_NAME NOT IN ('outreach_holds','outreach_booking_demand','outreach_route_anchors','outreach_reconciliation_facts') THEN
   RAISE EXCEPTION 'Planning writer requires commitment or reconciliation validation' USING ERRCODE='23514';
 END IF;
 UPDATE outreach_write_receipts SET dirty=true,validated=false WHERE transaction_id=txid_current();
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION leg_planning_validate_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('outreach.enforced',true)='true' AND EXISTS(SELECT 1 FROM outreach_write_receipts WHERE transaction_id=txid_current() AND dirty AND NOT validated) THEN
   RAISE EXCEPTION 'Planning allocation validation incomplete' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
DO $$ DECLARE target text; BEGIN
 FOREACH target IN ARRAY ARRAY['leg_season_plans','crew_availability','package_sets','package_set_members','leg_event_plans','leg_plan_crew_commitments','leg_plan_splits','leg_plan_authorities','leg_plan_approval_requests','leg_plan_approval_decisions','trips','trip_stops','trip_resource_assignments','bookings','booking_operational_windows','booking_resource_assignments','booking_package_selections','package_templates','resources','travel_legs','crew_workers','crew_worker_leg_memberships'] LOOP
   IF to_regclass(target) IS NOT NULL THEN
     EXECUTE format('DROP TRIGGER IF EXISTS leg_planning_write_guard ON %I',target);
     EXECUTE format('CREATE TRIGGER leg_planning_write_guard AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION leg_planning_guard_write()',target);
   END IF;
 END LOOP;
END $$;
DROP TRIGGER IF EXISTS leg_planning_receipt_validation ON outreach_write_receipts;
CREATE CONSTRAINT TRIGGER leg_planning_receipt_validation AFTER INSERT OR UPDATE ON outreach_write_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION leg_planning_validate_receipt();
