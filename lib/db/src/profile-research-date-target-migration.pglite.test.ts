import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { loadActReviewMigrations } from "./migrations";

describe("profile research event date target migration", () => {
  it("repairs an existing suggestions table without losing earlier suggestions", async () => {
    const client = new PGlite();
    try {
      await client.exec(`
        CREATE TABLE profile_research_suggestions (
          id integer PRIMARY KEY,
          target_kind text NOT NULL CHECK (target_kind IN ('organization', 'contact', 'booking'))
        );
        INSERT INTO profile_research_suggestions (id, target_kind) VALUES (1, 'organization');
      `);
      const migration = (await loadActReviewMigrations()).find(({ name }) =>
        name === "20260929_profile_research_event_date_target.sql"
      );
      expect(migration).toBeDefined();
      expect((await client.query<{ ready: boolean }>(migration!.markerSql)).rows[0]?.ready).toBe(false);

      await client.exec(migration!.sql);

      expect((await client.query<{ ready: boolean }>(migration!.markerSql)).rows[0]?.ready).toBe(true);
      await client.exec("INSERT INTO profile_research_suggestions (id, target_kind) VALUES (2, 'event_date_fact')");
      expect((await client.query("SELECT id, target_kind FROM profile_research_suggestions ORDER BY id")).rows).toEqual([
        { id: 1, target_kind: "organization" },
        { id: 2, target_kind: "event_date_fact" },
      ]);
      await expect(client.exec("INSERT INTO profile_research_suggestions (id, target_kind) VALUES (3, 'unsupported')"))
        .rejects.toThrow();
    } finally {
      await client.close();
    }
  });
});
