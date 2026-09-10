-- Default off. Runtime enables the guard on every application DB connection.
CREATE TABLE IF NOT EXISTS outreach_write_receipts (
 transaction_id bigint PRIMARY KEY, mode text NOT NULL CHECK(mode IN ('allocation','commitment','reconciliation')),
 source text NOT NULL, validated boolean NOT NULL DEFAULT false, dirty boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS outreach_reconciliation_facts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text NOT NULL, actor text NOT NULL, reason text NOT NULL,
 booking_ids jsonb NOT NULL, facts_fingerprint text NOT NULL, state text NOT NULL DEFAULT 'needs_review' CHECK(state IN ('needs_review','resolved')),
 detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE TABLE IF NOT EXISTS outreach_route_anchors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), leg_id uuid REFERENCES travel_legs(id), resource_id uuid REFERENCES resources(id),
 direction text NOT NULL CHECK(direction IN ('departure','return')), latitude double precision NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180), available_at timestamptz NOT NULL,
 valid_until timestamptz NOT NULL, source text NOT NULL CHECK(trim(source)<>''), reason text NOT NULL CHECK(trim(reason)<>''),
 actor text NOT NULL, identity_fingerprint text NOT NULL, revision integer NOT NULL DEFAULT 1,
 recorded_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 CHECK ((leg_id IS NULL) <> (resource_id IS NULL)), CHECK(valid_until>recorded_at)
);
-- Repair partial/schema-push objects independently; invalid existing data remains fatal.
ALTER TABLE outreach_write_receipts ADD COLUMN IF NOT EXISTS transaction_id bigint;
ALTER TABLE outreach_write_receipts ADD COLUMN IF NOT EXISTS mode text NOT NULL;
ALTER TABLE outreach_write_receipts ADD COLUMN IF NOT EXISTS source text NOT NULL;
ALTER TABLE outreach_write_receipts ADD COLUMN IF NOT EXISTS validated boolean NOT NULL DEFAULT false;
ALTER TABLE outreach_write_receipts ADD COLUMN IF NOT EXISTS dirty boolean NOT NULL DEFAULT false;
ALTER TABLE outreach_write_receipts ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE outreach_reconciliation_facts ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE outreach_reconciliation_facts ADD COLUMN IF NOT EXISTS source text NOT NULL;
ALTER TABLE outreach_reconciliation_facts ADD COLUMN IF NOT EXISTS actor text NOT NULL;
ALTER TABLE outreach_reconciliation_facts ADD COLUMN IF NOT EXISTS reason text NOT NULL;
ALTER TABLE outreach_reconciliation_facts ADD COLUMN IF NOT EXISTS booking_ids jsonb NOT NULL;
ALTER TABLE outreach_reconciliation_facts ADD COLUMN IF NOT EXISTS facts_fingerprint text NOT NULL;
ALTER TABLE outreach_reconciliation_facts ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'needs_review';
ALTER TABLE outreach_reconciliation_facts ADD COLUMN IF NOT EXISTS detail jsonb NOT NULL;
ALTER TABLE outreach_reconciliation_facts ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE outreach_reconciliation_facts ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE outreach_route_anchors ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE outreach_route_anchors ADD COLUMN IF NOT EXISTS leg_id uuid;
ALTER TABLE outreach_route_anchors ADD COLUMN IF NOT EXISTS resource_id uuid;
ALTER TABLE outreach_route_anchors ADD COLUMN IF NOT EXISTS direction text NOT NULL;
ALTER TABLE outreach_route_anchors ADD COLUMN IF NOT EXISTS latitude double precision NOT NULL;
ALTER TABLE outreach_route_anchors ADD COLUMN IF NOT EXISTS longitude double precision NOT NULL;
ALTER TABLE outreach_route_anchors ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL;
ALTER TABLE outreach_route_anchors ADD COLUMN IF NOT EXISTS valid_until timestamptz NOT NULL;
ALTER TABLE outreach_route_anchors ADD COLUMN IF NOT EXISTS source text NOT NULL;
ALTER TABLE outreach_route_anchors ADD COLUMN IF NOT EXISTS reason text NOT NULL;
ALTER TABLE outreach_route_anchors ADD COLUMN IF NOT EXISTS actor text NOT NULL;
ALTER TABLE outreach_route_anchors ADD COLUMN IF NOT EXISTS identity_fingerprint text NOT NULL;
ALTER TABLE outreach_route_anchors ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE outreach_route_anchors ADD COLUMN IF NOT EXISTS recorded_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE outreach_route_anchors ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_write_receipts'::regclass AND contype='p') THEN ALTER TABLE outreach_write_receipts ADD CONSTRAINT outreach_write_receipts_pkey PRIMARY KEY(transaction_id); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_reconciliation_facts'::regclass AND contype='p') THEN ALTER TABLE outreach_reconciliation_facts ADD CONSTRAINT outreach_reconciliation_facts_pkey PRIMARY KEY(id); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_route_anchors'::regclass AND contype='p') THEN ALTER TABLE outreach_route_anchors ADD CONSTRAINT outreach_route_anchors_pkey PRIMARY KEY(id); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_write_receipts'::regclass AND conname='outreach_write_receipts_mode_check') THEN ALTER TABLE outreach_write_receipts ADD CONSTRAINT outreach_write_receipts_mode_check CHECK(mode IN ('allocation','commitment','reconciliation')); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_reconciliation_facts'::regclass AND conname='outreach_reconciliation_facts_state_check') THEN ALTER TABLE outreach_reconciliation_facts ADD CONSTRAINT outreach_reconciliation_facts_state_check CHECK(state IN ('needs_review','resolved')); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_route_anchors'::regclass AND conname='outreach_route_anchors_direction_check') THEN ALTER TABLE outreach_route_anchors ADD CONSTRAINT outreach_route_anchors_direction_check CHECK(direction IN ('departure','return')); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_route_anchors'::regclass AND conname='outreach_route_anchors_latitude_check') THEN ALTER TABLE outreach_route_anchors ADD CONSTRAINT outreach_route_anchors_latitude_check CHECK(latitude BETWEEN -90 AND 90); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_route_anchors'::regclass AND conname='outreach_route_anchors_longitude_check') THEN ALTER TABLE outreach_route_anchors ADD CONSTRAINT outreach_route_anchors_longitude_check CHECK(longitude BETWEEN -180 AND 180); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_route_anchors'::regclass AND conname='outreach_route_anchors_source_check') THEN ALTER TABLE outreach_route_anchors ADD CONSTRAINT outreach_route_anchors_source_check CHECK(trim(source)<>''); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_route_anchors'::regclass AND conname='outreach_route_anchors_reason_check') THEN ALTER TABLE outreach_route_anchors ADD CONSTRAINT outreach_route_anchors_reason_check CHECK(trim(reason)<>''); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_route_anchors'::regclass AND conname='outreach_route_anchors_check') THEN ALTER TABLE outreach_route_anchors ADD CONSTRAINT outreach_route_anchors_check CHECK((leg_id IS NULL) <> (resource_id IS NULL)); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_route_anchors'::regclass AND conname='outreach_route_anchors_check1') THEN ALTER TABLE outreach_route_anchors ADD CONSTRAINT outreach_route_anchors_check1 CHECK(valid_until>recorded_at); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_route_anchors'::regclass AND conname='outreach_route_anchors_leg_id_fkey') THEN ALTER TABLE outreach_route_anchors ADD CONSTRAINT outreach_route_anchors_leg_id_fkey FOREIGN KEY(leg_id) REFERENCES travel_legs(id); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_route_anchors'::regclass AND conname='outreach_route_anchors_resource_id_fkey') THEN ALTER TABLE outreach_route_anchors ADD CONSTRAINT outreach_route_anchors_resource_id_fkey FOREIGN KEY(resource_id) REFERENCES resources(id); END IF;
END $$;
CREATE INDEX IF NOT EXISTS outreach_anchors_identity_live ON outreach_route_anchors(leg_id,resource_id,direction) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS outreach_reconciliation_pending ON outreach_reconciliation_facts(created_at) WHERE state='needs_review';
CREATE OR REPLACE FUNCTION outreach_guard_capacity_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt outreach_write_receipts; old_value jsonb; new_value jsonb;
BEGIN
 IF current_setting('outreach.enforced',true) IS DISTINCT FROM 'true' THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' THEN
   old_value := to_jsonb(OLD); new_value := to_jsonb(NEW);
   IF TG_TABLE_NAME='bookings' THEN
     old_value := jsonb_build_array(OLD.starts_at,OLD.ends_at,OLD.status,OLD.probability,OLD.travel_leg_id,OLD.latitude,OLD.longitude);
     new_value := jsonb_build_array(NEW.starts_at,NEW.ends_at,NEW.status,NEW.probability,NEW.travel_leg_id,NEW.latitude,NEW.longitude);
   ELSE
     old_value := old_value - ARRAY['updated_at','created_at']; new_value := new_value - ARRAY['updated_at','created_at'];
   END IF;
   IF old_value IS NOT DISTINCT FROM new_value THEN RETURN NULL; END IF;
 END IF;
 SELECT * INTO receipt FROM outreach_write_receipts WHERE transaction_id=txid_current();
 IF NOT FOUND THEN RAISE EXCEPTION 'Allocation participation required for %; use the guarded commitment or factual reconciliation workflow.',TG_TABLE_NAME USING ERRCODE='23514'; END IF;
 IF receipt.mode='allocation' AND TG_TABLE_NAME NOT IN ('outreach_holds','outreach_booking_demand','outreach_route_anchors','outreach_reconciliation_facts') THEN
   RAISE EXCEPTION 'Capacity writer requires commitment validation or audited reconciliation.' USING ERRCODE='23514';
 END IF;
 UPDATE outreach_write_receipts SET dirty=true,validated=false WHERE transaction_id=txid_current();
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION outreach_validate_capacity_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('outreach.enforced',true)='true' AND EXISTS (
   SELECT 1 FROM outreach_write_receipts WHERE transaction_id=txid_current() AND dirty AND NOT validated
 ) THEN RAISE EXCEPTION 'Allocation transaction did not complete validation.' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
DO $$ DECLARE target text; BEGIN
 FOREACH target IN ARRAY ARRAY['bookings','booking_operational_windows','booking_package_selections','booking_resource_assignments','booking_resource_package_attributions','package_templates','resources','travel_legs','google_operational_calendar_links','google_workspace_calendar_scopes','google_workspace_connections','outreach_holds','outreach_booking_demand','outreach_route_anchors','outreach_reconciliation_facts'] LOOP
   IF to_regclass(target) IS NOT NULL THEN
     EXECUTE format('DROP TRIGGER IF EXISTS outreach_capacity_guard ON %I',target);
     EXECUTE format('CREATE TRIGGER outreach_capacity_guard AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION outreach_guard_capacity_write()',target);
   END IF;
 END LOOP;
END $$;
DROP TRIGGER IF EXISTS outreach_capacity_validation ON outreach_write_receipts;
CREATE CONSTRAINT TRIGGER outreach_capacity_validation AFTER INSERT OR UPDATE ON outreach_write_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION outreach_validate_capacity_receipt();
