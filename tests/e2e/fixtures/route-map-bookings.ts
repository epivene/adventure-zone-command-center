import { randomUUID } from "node:crypto";

import nextEnvironment from "@next/env";
import postgres from "postgres";

const { loadEnvConfig } = nextEnvironment;
const pendingFixtureKey = "codex-e2e-routes-map-pending-v1";
const declinedFixtureKey = "codex-e2e-routes-map-declined-v1";

type FixtureDatabase = ReturnType<typeof postgres>;

async function removeFixtureBookings(sql: FixtureDatabase) {
  await sql`
    delete from bookings
    where act_record_id in (${pendingFixtureKey}, ${declinedFixtureKey})
  `;
}

export async function arrangeRouteMapBookings() {
  loadEnvConfig(process.cwd());
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to arrange route-map E2E fixtures.");
  }

  const sql = postgres(databaseUrl, { max: 1 });
  const runId = randomUUID();
  const pendingName = `E2E Pending Contract ${runId}`;
  const declinedName = `E2E Declined ${runId}`;

  try {
    await sql.begin(async (transaction) => {
      await transaction`
        delete from bookings
        where act_record_id in (${pendingFixtureKey}, ${declinedFixtureKey})
      `;
      await transaction`
        insert into bookings (
          id,
          name,
          city,
          region,
          latitude,
          longitude,
          starts_at,
          ends_at,
          status,
          probability,
          act_record_id
        )
        values (
          ${randomUUID()},
          ${pendingName},
          'Fargo',
          'ND',
          46.8772,
          -96.7898,
          '2026-08-10T15:00:00.000Z',
          '2026-08-12T22:00:00.000Z',
          'pending_contract',
          'likely',
          ${pendingFixtureKey}
        )
      `;
      await transaction`
        insert into bookings (
          id,
          name,
          city,
          region,
          latitude,
          longitude,
          starts_at,
          status,
          probability,
          act_record_id
        )
        values (
          ${randomUUID()},
          ${declinedName},
          'Austin',
          'TX',
          30.2672,
          -97.7431,
          '2026-08-20T15:00:00.000Z',
          'declined',
          'unlikely',
          ${declinedFixtureKey}
        )
      `;
    });
  } catch (error) {
    await sql.end({ timeout: 5 });
    throw error;
  }

  let cleaned = false;

  return {
    pendingName,
    declinedName,
    cleanup: async () => {
      if (cleaned) return;
      try {
        await removeFixtureBookings(sql);
      } finally {
        cleaned = true;
        await sql.end({ timeout: 5 });
      }
    },
  };
}
