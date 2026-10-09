import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("upgrades legacy stops idempotently without backfilling dates from provider or update times", async () => {
  const client = new PGlite();
  try {
    await client.exec(`CREATE TABLE organizations(id uuid PRIMARY KEY);
      INSERT INTO organizations VALUES('10000000-0000-4000-8000-000000000001');`);
    for (const file of ["20261008_festival_editions.sql", "20261009_festival_crew_stops.sql"]) {
      await client.exec(await readFile(`../../lib/db/migrations/${file}`, "utf8"));
    }
    await client.exec(`INSERT INTO festival_editions(organization_id, year) VALUES ('10000000-0000-4000-8000-000000000001', 2026);
      INSERT INTO festival_crew_stops(edition_id, data) SELECT id,
      '{"name":"Legacy Walmart","rigFit":"yes","hookups":"no","overnight":"unknown","searchedAt":"2026-10-01T12:00:00Z"}'
      FROM festival_editions;`);
    const migration = await readFile("../../lib/db/migrations/20261009z_festival_crew_confirmations.sql", "utf8");
    await client.exec(migration);
    await client.exec(migration);
    const result = await client.query(`SELECT rig_fit_confirmed_on, hookups_confirmed_on, overnight_confirmed_on, data FROM festival_crew_stops`);
    expect(result.rows[0]).toMatchObject({ rig_fit_confirmed_on: null, hookups_confirmed_on: null, overnight_confirmed_on: null, data: { overnight: "unknown", rigFit: "yes" } });
  } finally { await client.close(); }
});
