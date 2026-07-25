import { randomUUID } from "node:crypto";

import nextEnvironment from "@next/env";
import postgres from "postgres";

const { loadEnvConfig } = nextEnvironment;

export type ReleaseBookingFixture = {
  cleanup: () => Promise<void>;
  followUpBookingId: string;
  followUpBookingName: string;
  pendingBookingName: string;
  possibleBookingName: string;
};

export async function arrangeReleaseBookings(): Promise<ReleaseBookingFixture> {
  loadEnvConfig(process.cwd());
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to arrange release E2E fixtures.");
  }

  const sql = postgres(databaseUrl, { max: 1 });
  const runId = randomUUID();
  const followUpBookingId = randomUUID();
  const pendingBookingId = randomUUID();
  const possibleBookingId = randomUUID();
  const followUpBookingName = `E2E Follow-up ${runId}`;
  const pendingBookingName = `E2E Pending Contract ${runId}`;
  const possibleBookingName = `E2E Possible ${runId}`;
  const bookingIds = [
    followUpBookingId,
    pendingBookingId,
    possibleBookingId,
  ];

  try {
    await sql.begin(async (transaction) => {
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
          probability
        )
        values
          (
            ${followUpBookingId},
            ${followUpBookingName},
            'Fargo',
            'ND',
            46.8772,
            -96.7898,
            '2026-08-10T15:00:00.000Z',
            'possible',
            'possible'
          ),
          (
            ${pendingBookingId},
            ${pendingBookingName},
            'Bismarck',
            'ND',
            46.8083,
            -100.7837,
            '2026-08-15T15:00:00.000Z',
            'pending_contract',
            'likely'
          ),
          (
            ${possibleBookingId},
            ${possibleBookingName},
            'Austin',
            'TX',
            30.2672,
            -97.7431,
            '2026-08-20T15:00:00.000Z',
            'possible',
            'possible'
          )
      `;
      await transaction`
        insert into follow_ups (
          id,
          booking_id,
          kind,
          due_at
        )
        values (
          ${randomUUID()},
          ${followUpBookingId},
          'call',
          '2026-08-01T15:00:00.000Z'
        )
      `;
    });
  } catch (error) {
    await sql.end({ timeout: 5 });
    throw error;
  }

  let cleaned = false;

  return {
    followUpBookingId,
    followUpBookingName,
    pendingBookingName,
    possibleBookingName,
    cleanup: async () => {
      if (cleaned) return;
      try {
        await sql`delete from follow_ups where booking_id in ${sql(bookingIds)}`;
        await sql`delete from bookings where id in ${sql(bookingIds)}`;
      } finally {
        cleaned = true;
        await sql.end({ timeout: 5 });
      }
    },
  };
}
