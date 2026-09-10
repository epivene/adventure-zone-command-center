import { allocationEnabled } from "@/features/outreach-planner/outreach-allocation";
import { beginRawCapacityReconciliation, finishRawCapacityReconciliation } from "@/features/outreach-planner/outreach-raw-reconciliation";
import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

const advisoryTryLockSql =
  "SELECT pg_try_advisory_lock(hashtext('adventure-zone:booking-probability-schema')) AS locked";
const advisoryUnlockSql =
  "SELECT pg_advisory_unlock(hashtext('adventure-zone:booking-probability-schema'))";

/**
 * Production safety net for probability migrations 034/035.
 *
 * Some Render deployments start the API directly and therefore bypass the
 * standalone custom migration scanner. The API already performs idempotent
 * schema checks at startup for other features, so keep the probability enum
 * and confirmed-booking automation self-healing here as well.
 */
export async function ensureBookingProbabilitySchema(
  pool: Pool = defaultPool,
): Promise<void> {
  const client = await pool.connect();
  let locked = false;
  let repairTimeoutsApplied = false;

  try {
    const readiness = await client.query<{
      ready: boolean;
      hasDefinite: boolean;
      hasTrigger: boolean;
    }>(`
      SELECT
        to_regtype('probability') IS NOT NULL
          AND to_regclass('bookings') IS NOT NULL AS "ready",
        EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typname = 'probability'
            AND e.enumlabel = 'definite'
        ) AS "hasDefinite",
        EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgname = 'bookings_confirmed_probability_trigger'
            AND NOT tgisinternal
        ) AS "hasTrigger"
    `);

    const state = readiness.rows[0];
    if (!state?.ready) return;
    if (state.hasDefinite && state.hasTrigger) return;

    const lock = await client.query<{ locked: boolean }>(advisoryTryLockSql);
    if (lock.rows[0]?.locked !== true) {
      throw new Error("Booking probability schema repair lock unavailable");
    }
    locked = true;

    await client.query("SET lock_timeout = '5s'");
    await client.query("SET statement_timeout = '20s'");
    repairTimeoutsApplied = true;

    // Enum values added by ALTER TYPE cannot safely be consumed until that
    // statement has committed. With no explicit transaction, each query below
    // commits independently before the backfill/trigger query runs.
    if (!state.hasDefinite) {
      await client.query(
        "ALTER TYPE probability ADD VALUE IF NOT EXISTS 'definite' BEFORE 'likely'",
      );
    }

    if(allocationEnabled()) { await client.query("BEGIN");await beginRawCapacityReconciliation(client,"confirmed-probability-backfill"); }
    await client.query(`
      UPDATE bookings
      SET probability = 'definite'::probability,
          updated_at = now()
      WHERE status = 'confirmed'
        AND probability IS DISTINCT FROM 'definite'::probability;

      CREATE OR REPLACE FUNCTION set_confirmed_booking_probability()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.status = 'confirmed'
           AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'confirmed') THEN
          NEW.probability := 'definite'::probability;
        END IF;
        RETURN NEW;
      END;
      $$;

      DROP TRIGGER IF EXISTS bookings_confirmed_probability_trigger ON bookings;
      CREATE TRIGGER bookings_confirmed_probability_trigger
      BEFORE INSERT OR UPDATE OF status ON bookings
      FOR EACH ROW
      EXECUTE FUNCTION set_confirmed_booking_probability();
    `);
    if(allocationEnabled()) { await finishRawCapacityReconciliation(client,"confirmed-probability-backfill");await client.query("COMMIT"); }
  } catch(error) {
    if(allocationEnabled()) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (repairTimeoutsApplied) {
      await client.query("RESET statement_timeout").catch(() => undefined);
      await client.query("RESET lock_timeout").catch(() => undefined);
    }
    if (locked) {
      await client.query(advisoryUnlockSql).catch(() => undefined);
    }
    client.release();
  }
}
