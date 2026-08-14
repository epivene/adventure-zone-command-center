-- Fix address column names in organization_locations to follow the
-- established address_1 / address_2 convention (consistent with organizations,
-- contacts, and bookings).  Migration 027 mistakenly created address1/address2.
-- This migration is a no-op on fresh databases where 027 has not yet run.

DO $$
BEGIN
  -- Rename address1 → address_1 if the wrong name exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name   = 'organization_locations'
      AND column_name  = 'address1'
  ) THEN
    ALTER TABLE organization_locations RENAME COLUMN address1 TO address_1;
  END IF;

  -- Rename address2 → address_2 if the wrong name exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name   = 'organization_locations'
      AND column_name  = 'address2'
  ) THEN
    ALTER TABLE organization_locations RENAME COLUMN address2 TO address_2;
  END IF;
END;
$$;
