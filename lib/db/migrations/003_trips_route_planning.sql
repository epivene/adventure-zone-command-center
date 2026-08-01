-- Trips, route planning & fuel estimates: trips per travel leg with ordered
-- booking stops, route segments carrying labeled estimates (live/cached/manual)
-- plus manual overrides, per-trip resource assignments, and a routing cache.
-- Idempotent so it is safe on databases where the tables were already applied
-- manually.

CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  travel_leg_id uuid NOT NULL REFERENCES travel_legs(id),
  name text NOT NULL,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  start_label text NOT NULL,
  start_latitude double precision,
  start_longitude double precision,
  end_label text NOT NULL,
  end_latitude double precision,
  end_longitude double precision,
  vehicle_name text,
  mpg double precision,
  fuel_price_per_gallon double precision,
  route_confirmed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trips_date_range_valid CHECK (end_date >= start_date),
  CONSTRAINT trips_fuel_price_nonnegative CHECK (fuel_price_per_gallon IS NULL OR fuel_price_per_gallon >= 0),
  CONSTRAINT trips_mpg_positive CHECK (mpg IS NULL OR mpg > 0),
  CONSTRAINT trips_name_nonblank CHECK (NULLIF(TRIM(BOTH FROM name), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS trips_travel_leg_idx ON trips (travel_leg_id);
CREATE INDEX IF NOT EXISTS trips_date_range_idx ON trips (start_date, end_date);

CREATE TABLE IF NOT EXISTS trip_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_stops_trip_booking_unique UNIQUE (trip_id, booking_id),
  CONSTRAINT trip_stops_sort_order_positive CHECK (sort_order >= 1)
);

CREATE INDEX IF NOT EXISTS trip_stops_trip_idx ON trip_stops (trip_id);

CREATE TABLE IF NOT EXISTS trip_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  from_key text NOT NULL,
  to_key text NOT NULL,
  from_label text NOT NULL,
  to_label text NOT NULL,
  miles double precision,
  minutes double precision,
  source text,
  estimated_at timestamptz,
  override_miles double precision,
  override_minutes double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_segments_trip_sequence_unique UNIQUE (trip_id, sequence),
  CONSTRAINT trip_segments_miles_nonnegative CHECK (miles IS NULL OR miles >= 0),
  CONSTRAINT trip_segments_minutes_nonnegative CHECK (minutes IS NULL OR minutes >= 0),
  CONSTRAINT trip_segments_override_miles_nonnegative CHECK (override_miles IS NULL OR override_miles >= 0),
  CONSTRAINT trip_segments_override_minutes_nonnegative CHECK (override_minutes IS NULL OR override_minutes >= 0),
  CONSTRAINT trip_segments_source_valid CHECK (source IS NULL OR source IN ('live', 'cached', 'manual'))
);

CREATE INDEX IF NOT EXISTS trip_segments_trip_idx ON trip_segments (trip_id);

CREATE TABLE IF NOT EXISTS trip_resource_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_resource_assignments_trip_resource_unique UNIQUE (trip_id, resource_id)
);

CREATE INDEX IF NOT EXISTS trip_resource_assignments_resource_idx
  ON trip_resource_assignments (resource_id);

CREATE TABLE IF NOT EXISTS routing_cache_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text NOT NULL,
  miles double precision NOT NULL,
  minutes double precision NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT routing_cache_entries_cache_key_unique UNIQUE (cache_key),
  CONSTRAINT routing_cache_entries_miles_nonnegative CHECK (miles >= 0),
  CONSTRAINT routing_cache_entries_minutes_nonnegative CHECK (minutes >= 0)
);
