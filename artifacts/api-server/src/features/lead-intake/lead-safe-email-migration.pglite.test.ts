import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("lead safe email migration", () => {
  it("adds fail-closed review fields and idempotent block history", async () => {
    const sql = await readFile(new URL("../../../../../lib/db/migrations/20260826_lead_safe_email.sql", import.meta.url), "utf8");
    const db = new PGlite();
    try {
      await db.exec(`
        create table organizations (id uuid primary key);
        create table contacts (id uuid primary key);
        create table lead_import_rows (id uuid primary key);
        insert into lead_import_rows values ('70000000-0000-4000-8000-000000000001');
      `);
      await db.exec(sql);
      expect((await db.query("select territory_status, fit_status from lead_import_rows")).rows).toEqual([{ territory_status: "needs_review", fit_status: "needs_review" }]);
      await db.exec("insert into communication_blocks (target_type, normalized_email, reason, created_by) values ('recipient_email', 'person@example.com', 'requested', 'owner')");
      expect((await db.query("select action from communication_block_events")).rows).toEqual([{ action: "created" }]);
      await expect(db.exec("insert into communication_blocks (target_type, reason, created_by) values ('recipient_email', 'missing target', 'owner')"))
        .rejects.toThrow();
      await db.exec(sql);
      expect((await db.query("select count(*)::int as count from communication_blocks")).rows).toEqual([{ count: 1 }]);
    } finally { await db.close(); }
  }, 15_000);

  it("repairs a legacy null-email block without colliding with an active global block", async () => {
    const sql = await readFile(new URL("../../../../../lib/db/migrations/20260826_lead_safe_email.sql", import.meta.url), "utf8");
    const db = new PGlite();
    try {
      await db.exec(`
        create table organizations (id uuid primary key);
        create table contacts (id uuid primary key);
        create table lead_import_rows (id uuid primary key);
        create table communication_blocks (
          id uuid primary key default gen_random_uuid(), target_type text not null,
          organization_id uuid, contact_id uuid, normalized_email text, row_id uuid,
          reason text not null, active boolean not null default true, created_by text not null,
          created_at timestamptz not null default now(), removed_by text, removed_at timestamptz,
          removal_reason text,
          constraint communication_blocks_exact_target check (
            (target_type = 'recipient_email' and organization_id is null and contact_id is null and row_id is null)
            or (target_type = 'internal_preview' and organization_id is null and contact_id is null and normalized_email is null and row_id is null)
          )
        );
        create unique index communication_blocks_active_target_unique on communication_blocks
          (target_type, coalesce(organization_id::text,''), coalesce(contact_id::text,''), coalesce(normalized_email,''), coalesce(row_id::text,''))
          where active;
        insert into communication_blocks (target_type, normalized_email, reason, created_by)
        values ('recipient_email', null, 'legacy missing email', 'owner');
        insert into communication_blocks (target_type, reason, created_by)
        values ('internal_preview', 'existing global pause', 'owner');
      `);

      await db.exec(sql);
      expect((await db.query(`
        select count(*)::int as count from communication_blocks
        where active and target_type = 'internal_preview'
      `)).rows).toEqual([{ count: 1 }]);
      expect((await db.query(`
        select count(*)::int as count from communication_block_events
        where action = 'created'
      `)).rows).toEqual([{ count: 2 }]);
    } finally {
      await db.close();
    }
  }, 15_000);
});
