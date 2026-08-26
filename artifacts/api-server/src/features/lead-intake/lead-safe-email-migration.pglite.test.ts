import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("lead safe email migration", () => {
  it("adds fail-closed review fields and idempotent block history", async () => {
    const sql = await readFile(new URL("../../../../../lib/db/migrations/20260826_lead_safe_email.sql", import.meta.url), "utf8");
    const db = new PGlite();
    try {
      await db.exec("create table lead_import_rows (id uuid primary key); insert into lead_import_rows values ('70000000-0000-4000-8000-000000000001')");
      await db.exec(sql);
      expect((await db.query("select territory_status, fit_status from lead_import_rows")).rows).toEqual([{ territory_status: "needs_review", fit_status: "needs_review" }]);
      await db.exec("insert into communication_blocks (target_type, normalized_email, reason, created_by) values ('recipient_email', 'person@example.com', 'requested', 'owner')");
      expect((await db.query("select action from communication_block_events")).rows).toEqual([{ action: "created" }]);
      await db.exec(sql);
      expect((await db.query("select count(*)::int as count from communication_blocks")).rows).toEqual([{ count: 1 }]);
    } finally { await db.close(); }
  }, 15_000);
});
