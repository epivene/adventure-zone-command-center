-- Additive, repeat-safe. No rollout enablement or historic booking rewrites.
CREATE TABLE IF NOT EXISTS outreach_allocation_mutex (
 id integer PRIMARY KEY CHECK (id=1), generation integer NOT NULL DEFAULT 0
);
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

-- Repair existing schema-created/partial tables independently. Missing factual or
-- required source identity fields on retained rows intentionally fail; never invent promise evidence.
ALTER TABLE outreach_allocation_mutex ADD COLUMN IF NOT EXISTS id integer;
ALTER TABLE outreach_allocation_mutex ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 0;
ALTER TABLE outreach_booking_demand ADD COLUMN IF NOT EXISTS booking_id uuid;
ALTER TABLE outreach_booking_demand ADD COLUMN IF NOT EXISTS quantities jsonb NOT NULL;
ALTER TABLE outreach_booking_demand ADD COLUMN IF NOT EXISTS resource_ids jsonb NOT NULL;
ALTER TABLE outreach_booking_demand ADD COLUMN IF NOT EXISTS facts_fingerprint text NOT NULL;
ALTER TABLE outreach_booking_demand ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE outreach_booking_demand ADD COLUMN IF NOT EXISTS actor text NOT NULL;
ALTER TABLE outreach_booking_demand ADD COLUMN IF NOT EXISTS reason text NOT NULL;
ALTER TABLE outreach_booking_demand ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE outreach_holds ADD COLUMN IF NOT EXISTS id uuid;
ALTER TABLE outreach_holds ADD COLUMN IF NOT EXISTS candidate_id uuid NOT NULL;
ALTER TABLE outreach_holds ADD COLUMN IF NOT EXISTS booking_id uuid NOT NULL;
ALTER TABLE outreach_holds ADD COLUMN IF NOT EXISTS opportunity_id uuid NOT NULL;
ALTER TABLE outreach_holds ADD COLUMN IF NOT EXISTS leg_id uuid NOT NULL;
ALTER TABLE outreach_holds ADD COLUMN IF NOT EXISTS event_starts_on date NOT NULL;
ALTER TABLE outreach_holds ADD COLUMN IF NOT EXISTS event_ends_on date NOT NULL;
ALTER TABLE outreach_holds ADD COLUMN IF NOT EXISTS starts_on date NOT NULL;
ALTER TABLE outreach_holds ADD COLUMN IF NOT EXISTS ends_on date NOT NULL;
ALTER TABLE outreach_holds ADD COLUMN IF NOT EXISTS quantities jsonb NOT NULL;
ALTER TABLE outreach_holds ADD COLUMN IF NOT EXISTS resource_ids jsonb NOT NULL;
ALTER TABLE outreach_holds ADD COLUMN IF NOT EXISTS location jsonb NOT NULL;
ALTER TABLE outreach_holds ADD COLUMN IF NOT EXISTS demand_fingerprint text NOT NULL;
ALTER TABLE outreach_holds ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE outreach_holds ADD COLUMN IF NOT EXISTS state text NOT NULL;
ALTER TABLE outreach_holds ADD COLUMN IF NOT EXISTS owner text NOT NULL;
ALTER TABLE outreach_holds ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL;
ALTER TABLE outreach_holds ADD COLUMN IF NOT EXISTS ended_at timestamptz;
ALTER TABLE outreach_holds ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE outreach_allocation_mutex ALTER COLUMN id SET NOT NULL;
ALTER TABLE outreach_allocation_mutex ALTER COLUMN generation SET NOT NULL;
ALTER TABLE outreach_booking_demand ALTER COLUMN booking_id SET NOT NULL;
ALTER TABLE outreach_booking_demand ALTER COLUMN quantities SET NOT NULL;
ALTER TABLE outreach_booking_demand ALTER COLUMN resource_ids SET NOT NULL;
ALTER TABLE outreach_booking_demand ALTER COLUMN facts_fingerprint SET NOT NULL;
ALTER TABLE outreach_booking_demand ALTER COLUMN revision SET NOT NULL;
ALTER TABLE outreach_booking_demand ALTER COLUMN actor SET NOT NULL;
ALTER TABLE outreach_booking_demand ALTER COLUMN reason SET NOT NULL;
ALTER TABLE outreach_booking_demand ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE outreach_holds ALTER COLUMN id SET NOT NULL;
ALTER TABLE outreach_holds ALTER COLUMN candidate_id SET NOT NULL;
ALTER TABLE outreach_holds ALTER COLUMN booking_id SET NOT NULL;
ALTER TABLE outreach_holds ALTER COLUMN opportunity_id SET NOT NULL;
ALTER TABLE outreach_holds ALTER COLUMN leg_id SET NOT NULL;
ALTER TABLE outreach_holds ALTER COLUMN event_starts_on SET NOT NULL;
ALTER TABLE outreach_holds ALTER COLUMN event_ends_on SET NOT NULL;
ALTER TABLE outreach_holds ALTER COLUMN starts_on SET NOT NULL;
ALTER TABLE outreach_holds ALTER COLUMN ends_on SET NOT NULL;
ALTER TABLE outreach_holds ALTER COLUMN quantities SET NOT NULL;
ALTER TABLE outreach_holds ALTER COLUMN resource_ids SET NOT NULL;
ALTER TABLE outreach_holds ALTER COLUMN location SET NOT NULL;
ALTER TABLE outreach_holds ALTER COLUMN demand_fingerprint SET NOT NULL;
ALTER TABLE outreach_holds ALTER COLUMN revision SET NOT NULL;
ALTER TABLE outreach_holds ALTER COLUMN state SET NOT NULL;
ALTER TABLE outreach_holds ALTER COLUMN owner SET NOT NULL;
ALTER TABLE outreach_holds ALTER COLUMN expires_at SET NOT NULL;
ALTER TABLE outreach_holds ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE outreach_holds ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE outreach_holds ALTER COLUMN state SET DEFAULT 'active';
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='outreach_allocation_mutex'::regclass AND conname='outreach_allocation_mutex_pkey') THEN ALTER TABLE outreach_allocation_mutex ADD CONSTRAINT outreach_allocation_mutex_pkey PRIMARY KEY (id); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='outreach_allocation_mutex'::regclass AND conname='outreach_allocation_mutex_id_check') THEN ALTER TABLE outreach_allocation_mutex ADD CONSTRAINT outreach_allocation_mutex_id_check CHECK(id=1); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='outreach_booking_demand'::regclass AND conname='outreach_booking_demand_pkey') THEN ALTER TABLE outreach_booking_demand ADD CONSTRAINT outreach_booking_demand_pkey PRIMARY KEY (booking_id); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='outreach_booking_demand'::regclass AND conname='outreach_booking_demand_quantities_check') THEN ALTER TABLE outreach_booking_demand ADD CONSTRAINT outreach_booking_demand_quantities_check CHECK(outreach_quantities_valid(quantities)); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='outreach_booking_demand'::regclass AND conname='outreach_booking_demand_resource_ids_check') THEN ALTER TABLE outreach_booking_demand ADD CONSTRAINT outreach_booking_demand_resource_ids_check CHECK(outreach_resource_ids_valid(resource_ids)); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='outreach_booking_demand'::regclass AND conname='outreach_booking_demand_revision_check') THEN ALTER TABLE outreach_booking_demand ADD CONSTRAINT outreach_booking_demand_revision_check CHECK(revision>0); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='outreach_booking_demand'::regclass AND conname='outreach_booking_demand_actor_check') THEN ALTER TABLE outreach_booking_demand ADD CONSTRAINT outreach_booking_demand_actor_check CHECK(trim(actor)<>''); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='outreach_booking_demand'::regclass AND conname='outreach_booking_demand_reason_check') THEN ALTER TABLE outreach_booking_demand ADD CONSTRAINT outreach_booking_demand_reason_check CHECK(trim(reason)<>''); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype='f' AND c.conrelid='outreach_booking_demand'::regclass AND c.confrelid='bookings'::regclass AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='booking_id')] AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]) THEN ALTER TABLE outreach_booking_demand ADD CONSTRAINT outreach_booking_demand_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='outreach_holds'::regclass AND conname='outreach_holds_pkey') THEN ALTER TABLE outreach_holds ADD CONSTRAINT outreach_holds_pkey PRIMARY KEY (id); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='outreach_holds'::regclass AND conname='outreach_holds_quantities_check') THEN ALTER TABLE outreach_holds ADD CONSTRAINT outreach_holds_quantities_check CHECK(outreach_quantities_valid(quantities)); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='outreach_holds'::regclass AND conname='outreach_holds_resource_ids_check') THEN ALTER TABLE outreach_holds ADD CONSTRAINT outreach_holds_resource_ids_check CHECK(outreach_resource_ids_valid(resource_ids)); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='outreach_holds'::regclass AND conname='outreach_holds_revision_check') THEN ALTER TABLE outreach_holds ADD CONSTRAINT outreach_holds_revision_check CHECK(revision>0); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='outreach_holds'::regclass AND conname='outreach_holds_owner_check') THEN ALTER TABLE outreach_holds ADD CONSTRAINT outreach_holds_owner_check CHECK(trim(owner)<>''); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype='f' AND c.conrelid='outreach_holds'::regclass AND c.confrelid='outreach_candidates'::regclass AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='candidate_id')] AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]) THEN ALTER TABLE outreach_holds ADD CONSTRAINT outreach_holds_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES outreach_candidates(id); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype='f' AND c.conrelid='outreach_holds'::regclass AND c.confrelid='bookings'::regclass AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='booking_id')] AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]) THEN ALTER TABLE outreach_holds ADD CONSTRAINT outreach_holds_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype='f' AND c.conrelid='outreach_holds'::regclass AND c.confrelid='booking_opportunities'::regclass AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='opportunity_id')] AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]) THEN ALTER TABLE outreach_holds ADD CONSTRAINT outreach_holds_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES booking_opportunities(id); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype='f' AND c.conrelid='outreach_holds'::regclass AND c.confrelid='travel_legs'::regclass AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='leg_id')] AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]) THEN ALTER TABLE outreach_holds ADD CONSTRAINT outreach_holds_leg_id_fkey FOREIGN KEY (leg_id) REFERENCES travel_legs(id); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='outreach_holds'::regclass AND conname='outreach_holds_location_check') THEN ALTER TABLE outreach_holds ADD CONSTRAINT outreach_holds_location_check CHECK(jsonb_typeof(location)='object'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='outreach_holds'::regclass AND conname='outreach_holds_state_valid') THEN ALTER TABLE outreach_holds ADD CONSTRAINT outreach_holds_state_valid CHECK(state IN ('active','released','expired','converted')); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='outreach_holds'::regclass AND conname='outreach_holds_window_valid') THEN ALTER TABLE outreach_holds ADD CONSTRAINT outreach_holds_window_valid CHECK(starts_on<=event_starts_on AND event_starts_on<=event_ends_on AND event_ends_on<=ends_on); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='outreach_holds'::regclass AND conname='outreach_holds_lifecycle_valid') THEN ALTER TABLE outreach_holds ADD CONSTRAINT outreach_holds_lifecycle_valid CHECK((state='active' AND ended_at IS NULL) OR (state<>'active' AND ended_at IS NOT NULL)); END IF; END $$;
INSERT INTO outreach_allocation_mutex(id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE UNIQUE INDEX IF NOT EXISTS outreach_holds_active_booking_unique ON outreach_holds(booking_id) WHERE state='active';
CREATE INDEX IF NOT EXISTS outreach_holds_live_window ON outreach_holds(starts_on,ends_on,expires_at) WHERE state='active';
