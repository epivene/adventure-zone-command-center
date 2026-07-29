import { randomUUID } from "node:crypto";

import nextEnvironment from "@next/env";
import postgres from "postgres";

const { loadEnvConfig } = nextEnvironment;

export async function arrangeBookingPackagesResources() {
  loadEnvConfig(process.cwd());
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required to arrange package/resource E2E fixtures.",
    );
  }
  const sql = postgres(databaseUrl, { max: 1 });
  const runId = randomUUID();
  const bookingId = randomUUID();
  const adventureId = randomUUID();
  const warriorsId = randomUUID();
  const resourceId = randomUUID();
  const assignmentId = randomUUID();
  const suffix = runId.replaceAll("-", "");
  const bookingName = `E2E Package Fair ${runId}`;

  try {
    await sql.begin(async (transaction) => {
      await transaction`
        insert into bookings (
          id, name, city, region, starts_at, ends_at,
          physical_attraction_total, probability
        ) values (
          ${bookingId}, ${bookingName}, 'Shelby', 'MT',
          '2026-08-10T17:00:00.000Z', '2026-08-10T17:00:00.000Z',
          11, 'likely'
        )
      `;
      await transaction`
        insert into package_templates (
          id, code, name, base_attraction_count, active
        ) values
          (${adventureId}, ${`e2e_adventure_${suffix}`}, 'Adventure Zone', 10, true),
          (${warriorsId}, ${`e2e_warriors_${suffix}`}, 'Weekend Warriors', 5, true)
      `;
      await transaction`
        insert into booking_package_selections (booking_id, package_template_id)
        values
          (${bookingId}, ${adventureId}),
          (${bookingId}, ${warriorsId})
      `;
      await transaction`
        insert into resources (
          id, code, name, category, counts_as_attraction, status
        ) values (
          ${resourceId}, ${`e2e_resource_${suffix}`},
          'Paintball', 'attraction', true, 'unavailable'
        )
      `;
      await transaction`
        insert into resource_package_tags (resource_id, package_template_id)
        values
          (${resourceId}, ${adventureId}),
          (${resourceId}, ${warriorsId})
      `;
      await transaction`
        insert into booking_resource_assignments (
          id, booking_id, resource_id, attribution_source
        ) values (${assignmentId}, ${bookingId}, ${resourceId}, 'inferred')
      `;
    });
  } catch (error) {
    await sql.end({ timeout: 5 });
    throw error;
  }

  let cleaned = false;
  return {
    bookingId,
    bookingName,
    cleanup: async () => {
      if (cleaned) return;
      try {
        const requestIds = await sql<{ id: string }[]>`
          select id from booking_special_requests where booking_id = ${bookingId}
        `;
        const auditIds = [bookingId, assignmentId, ...requestIds.map(({ id }) => id)];
        await sql`delete from audit_entries where entity_id in ${sql(auditIds)}`;
        await sql`delete from bookings where id = ${bookingId}`;
        await sql`delete from resources where id = ${resourceId}`;
        await sql`
          delete from package_templates
          where id in (${adventureId}, ${warriorsId})
        `;
      } finally {
        cleaned = true;
        await sql.end({ timeout: 5 });
      }
    },
  };
}
