-- Create the organization_locations table.
-- A location belongs to exactly one organization and carries its own address,
-- contact details, status, coordinates, and Act! provenance.
CREATE TABLE IF NOT EXISTS organization_locations (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  label             text        NOT NULL,
  venue_name        text,
  address_1         text,
  address_2         text,
  city              text,
  region            text,
  postal_code       text,
  website           text,
  phone             text,
  normalized_phone  text,
  email             text,
  local_status      text,
  lat               double precision,
  lng               double precision,
  act_record_id     text        UNIQUE,
  act_source_label  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organization_locations_organization_id_idx
  ON organization_locations(organization_id);

CREATE INDEX IF NOT EXISTS organization_locations_normalized_phone_idx
  ON organization_locations(normalized_phone);

-- Add nullable organization_location_id FK to the five downstream tables.
-- All new columns start NULL so existing rows are unaffected.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS organization_location_id uuid
    REFERENCES organization_locations(id) ON DELETE SET NULL;

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS organization_location_id uuid
    REFERENCES organization_locations(id) ON DELETE SET NULL;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS organization_location_id uuid
    REFERENCES organization_locations(id) ON DELETE SET NULL;

ALTER TABLE follow_ups
  ADD COLUMN IF NOT EXISTS organization_location_id uuid
    REFERENCES organization_locations(id) ON DELETE SET NULL;

ALTER TABLE call_sessions
  ADD COLUMN IF NOT EXISTS organization_location_id uuid
    REFERENCES organization_locations(id) ON DELETE SET NULL;

-- Trigger function: when a record is pinned to a location and also linked to
-- an organization, the location must belong to that same organization.
CREATE OR REPLACE FUNCTION check_organization_location_org_match()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_location_id IS NOT NULL AND NEW.organization_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM organization_locations
       WHERE id              = NEW.organization_location_id
         AND organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION
        'organization_location_id % does not belong to organization_id %',
        NEW.organization_location_id, NEW.organization_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_location_org_match ON contacts;
CREATE TRIGGER contacts_location_org_match
  BEFORE INSERT OR UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION check_organization_location_org_match();

DROP TRIGGER IF EXISTS activities_location_org_match ON activities;
CREATE TRIGGER activities_location_org_match
  BEFORE INSERT OR UPDATE ON activities
  FOR EACH ROW EXECUTE FUNCTION check_organization_location_org_match();

DROP TRIGGER IF EXISTS bookings_location_org_match ON bookings;
CREATE TRIGGER bookings_location_org_match
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION check_organization_location_org_match();

DROP TRIGGER IF EXISTS follow_ups_location_org_match ON follow_ups;
CREATE TRIGGER follow_ups_location_org_match
  BEFORE INSERT OR UPDATE ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION check_organization_location_org_match();

DROP TRIGGER IF EXISTS call_sessions_location_org_match ON call_sessions;
CREATE TRIGGER call_sessions_location_org_match
  BEFORE INSERT OR UPDATE ON call_sessions
  FOR EACH ROW EXECUTE FUNCTION check_organization_location_org_match();
