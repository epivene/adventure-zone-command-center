-- Migration 001: make travel_legs.sort_order unique constraint DEFERRABLE.
--
-- drizzle-kit push creates this constraint as non-deferrable. The drag-reorder
-- feature defers it inside a transaction so that swapping or cyclically
-- reordering all sort positions doesn't trigger a per-row unique violation.
-- Without this, any save that changes position order returns a 409/500.
--
-- If travel_legs does not exist yet (pre-push fresh database), this migration
-- raises MIGRATION_DEFERRED so the runner skips recording it and retries on
-- the next invocation (which runs automatically after drizzle-kit push).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE  table_schema = 'public' AND table_name = 'travel_legs'
  ) THEN
    RAISE EXCEPTION 'MIGRATION_DEFERRED: travel_legs does not exist yet; run drizzle-kit push first';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname       = 'travel_legs_sort_order_unique'
      AND  conrelid      = 'travel_legs'::regclass
      AND  condeferrable = false
  ) THEN
    ALTER TABLE travel_legs DROP CONSTRAINT travel_legs_sort_order_unique;
    ALTER TABLE travel_legs
      ADD CONSTRAINT travel_legs_sort_order_unique
      UNIQUE (sort_order) DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;
