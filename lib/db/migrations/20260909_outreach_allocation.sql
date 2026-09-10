-- Additive, repeat-safe. No rollout enablement or historic booking rewrites.
CREATE TABLE IF NOT EXISTS outreach_allocation_mutex (
 id integer PRIMARY KEY CHECK (id=1), generation integer NOT NULL DEFAULT 0
);
INSERT INTO outreach_allocation_mutex(id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION outreach_quantities_valid(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN jsonb_typeof(value) <> 'object' THEN false ELSE
 value <> '{}'::jsonb AND NOT EXISTS(SELECT 1 FROM jsonb_each(value) e WHERE trim(e.key)='' OR jsonb_typeof(e.value)<>'number' OR e.value::text !~ '^[1-9][0-9]*$' OR (e.value::text)::numeric > 2147483647) END
$$;
CREATE OR REPLACE FUNCTION outreach_resource_ids_valid(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN jsonb_typeof(value) <> 'array' THEN false ELSE
 jsonb_array_length(value)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(value) e WHERE e !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') AND (SELECT count(*)=count(DISTINCT e) FROM jsonb_array_elements_text(value) e) END
$$;
CREATE TABLE IF NOT EXISTS outreach_booking_demand (
 booking_id uuid PRIMARY KEY REFERENCES bookings(id), quantities jsonb NOT NULL CHECK(outreach_quantities_valid(quantities)),
 resource_ids jsonb NOT NULL CHECK(outreach_resource_ids_valid(resource_ids)), facts_fingerprint text NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), actor text NOT NULL CHECK(trim(actor)<>''), reason text NOT NULL CHECK(trim(reason)<>''), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS outreach_holds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), candidate_id uuid NOT NULL REFERENCES outreach_candidates(id),
 booking_id uuid NOT NULL REFERENCES bookings(id), opportunity_id uuid NOT NULL REFERENCES booking_opportunities(id),
 leg_id uuid NOT NULL REFERENCES travel_legs(id), event_starts_on date NOT NULL, event_ends_on date NOT NULL,
 starts_on date NOT NULL, ends_on date NOT NULL, quantities jsonb NOT NULL CHECK(outreach_quantities_valid(quantities)),
 resource_ids jsonb NOT NULL CHECK(outreach_resource_ids_valid(resource_ids)), location jsonb NOT NULL CHECK(jsonb_typeof(location)='object'),
 demand_fingerprint text NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0), state text NOT NULL DEFAULT 'active',
 owner text NOT NULL CHECK(trim(owner)<>''), expires_at timestamptz NOT NULL, ended_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT outreach_holds_state_valid CHECK(state IN ('active','released','expired','converted')),
 CONSTRAINT outreach_holds_window_valid CHECK(starts_on<=event_starts_on AND event_starts_on<=event_ends_on AND event_ends_on<=ends_on),
 CONSTRAINT outreach_holds_lifecycle_valid CHECK((state='active' AND ended_at IS NULL) OR (state<>'active' AND ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS outreach_holds_active_booking_unique ON outreach_holds(booking_id) WHERE state='active';
CREATE INDEX IF NOT EXISTS outreach_holds_live_window ON outreach_holds(starts_on,ends_on,expires_at) WHERE state='active';
