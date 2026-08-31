import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { duplicateOrganizationGroupsQuery } from "./organization-repository";

let client: PGlite;
let database: ReturnType<typeof drizzle>;

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client);
  await client.exec(`
    CREATE TABLE organizations (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      city text,
      region text,
      consolidated_into_id uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO organizations (id, name, city, region, created_at) VALUES
      ('00000000-0000-4000-8000-000000000001', 'Twin Falls Western Days (Twin Falls)  ID', 'Twin Falls', 'ID', '2026-01-01T00:00:00Z'),
      ('00000000-0000-4000-8000-000000000002', 'Twin Falls Western Days (Twin Falls) ID', NULL, NULL, '2026-01-02T00:00:00Z'),
      ('00000000-0000-4000-8000-000000000003', 'Parktacular HOPEfest (Twin Falls) ID', 'Twin Falls', 'ID', '2026-01-03T00:00:00Z');
  `);
});

afterAll(async () => {
  await client.close();
});

describe("duplicateOrganizationGroupsQuery", () => {
  it("groups names that differ only by repeated internal whitespace", async () => {
    const result = await database.execute<{
      normalized_name: string;
      normalized_city: string;
      normalized_region: string;
      ids: string[];
    }>(duplicateOrganizationGroupsQuery());

    expect(result.rows).toEqual([
      {
        normalized_name: "twin falls western days (twin falls) id",
        normalized_city: "",
        normalized_region: "",
        ids: [
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000002",
        ],
      },
    ]);
  });
});
