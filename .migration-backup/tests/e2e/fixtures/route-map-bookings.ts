import { randomUUID } from "node:crypto";

import nextEnvironment from "@next/env";
import postgres from "postgres";

const { loadEnvConfig } = nextEnvironment;
const pendingFixtureKey = "codex-e2e-routes-map-pending-v1";
const declinedFixtureKey = "codex-e2e-routes-map-declined-v1";

type FixtureDatabase = ReturnType<typeof postgres>;

async function removeFixtureBookings(sql: FixtureDatabase) {
  await sql`
    delete from follow_ups
    where booking_id in (
      select id from bookings
      where act_record_id in (${pendingFixtureKey}, ${declinedFixtureKey})
    )
  `;
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
  const pendingBookingId = randomUUID();
  const pendingName = `E2E Pending Contract ${runId}`;
  const declinedName = `E2E Declined ${runId}`;
  let originalTravelLegs: {
    id: string;
    name: string;
    color: string;
  }[] = [];

  try {
    originalTravelLegs = await sql<{
      id: string;
      name: string;
      color: string;
    }[]>`
      select id, name, color
      from travel_legs
      order by sort_order
    `;
    await sql.begin(async (transaction) => {
      await transaction`
        delete from follow_ups
        where booking_id in (
          select id from bookings
          where act_record_id in (${pendingFixtureKey}, ${declinedFixtureKey})
        )
      `;
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
          ${pendingBookingId},
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
        insert into follow_ups (id, booking_id, kind, due_at)
        values (
          ${randomUUID()},
          ${pendingBookingId},
          'call',
          '2035-08-10T17:00:00.000Z'
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
    pendingBookingId,
    declinedName,
    originalTravelLegs,
    cleanup: async () => {
      if (cleaned) return;
      try {
        await removeFixtureBookings(sql);
        for (const leg of originalTravelLegs) {
          await sql`
            update travel_legs
            set name = ${leg.name}, color = ${leg.color}, updated_at = now()
            where id = ${leg.id}
          `;
        }
      } finally {
        cleaned = true;
        await sql.end({ timeout: 5 });
      }
    },
  };
}
