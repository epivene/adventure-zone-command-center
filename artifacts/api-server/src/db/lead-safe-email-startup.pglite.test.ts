import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import {
  isCommunicationBlockSchemaReady,
  isCommunicationTemplateVersionSchemaReady,
} from "./lead-intake-startup-migration";
import * as startupMigration from "./lead-intake-startup-migration";

describe("lead safe-email startup readiness", () => {
  it("repairs a partial schema and verifies columns, exact checks, indexes, FKs, trigger, and function", async () => {
    const client = new PGlite();
    const query = (sql: string) => client.query(sql) as Promise<{ rows: Array<Record<string, unknown>> }>;
    const migration = await readFile(
      new URL("../../../../lib/db/migrations/20260826_lead_safe_email.sql", import.meta.url),
      "utf8",
    );
    try {
      await client.exec(`
        create table organizations (id uuid primary key);
        create table contacts (id uuid primary key);
        create table lead_import_rows (
          id uuid primary key,
          territory_status text,
          fit_status text,
          constraint lead_import_rows_territory_status_valid check (true),
          constraint lead_import_rows_fit_status_valid check (true)
        );
        create table communication_templates (id uuid primary key);
        create table communication_blocks (id uuid primary key default gen_random_uuid());
        create table communication_block_events (id uuid primary key default gen_random_uuid());
        insert into lead_import_rows (id, territory_status, fit_status)
        values ('30000000-0000-4000-8000-000000000001', 'unsafe-territory', 'unsafe-fit');
        insert into communication_blocks (id)
        values ('40000000-0000-4000-8000-000000000001');
      `);

      await expect(isCommunicationBlockSchemaReady({ query })).resolves.toBe(false);
      await expect(isCommunicationTemplateVersionSchemaReady({ query })).resolves.toBe(false);
      const reviewStatusReady = (startupMigration as typeof startupMigration & {
        isLeadReviewStatusSchemaReady?: (client: { query: typeof query }) => Promise<boolean>;
      }).isLeadReviewStatusSchemaReady;
      expect(reviewStatusReady).toBeTypeOf("function");
      await client.exec(migration);
      await expect(reviewStatusReady!({ query })).resolves.toBe(true);
      await expect(isCommunicationBlockSchemaReady({ query })).resolves.toBe(true);
      await expect(isCommunicationTemplateVersionSchemaReady({ query })).resolves.toBe(true);
      expect((await client.query("select territory_status, fit_status from lead_import_rows")).rows).toEqual([
        { territory_status: "needs_review", fit_status: "needs_review" },
      ]);
      expect((await client.query(`
        select action, actor_id, reason, created_at
        from communication_block_events
        where block_id = '40000000-0000-4000-8000-000000000001'
      `)).rows).toEqual([{
        action: "created",
        actor_id: "system:startup-repair",
        reason: "Startup repair: retained as fail-closed internal preview block",
        created_at: expect.any(Date),
      }]);
      await client.exec(migration);
      await expect(isCommunicationBlockSchemaReady({ query })).resolves.toBe(true);
      expect((await client.query(`
        select count(*)::int as count
        from communication_block_events
        where block_id = '40000000-0000-4000-8000-000000000001' and action = 'created'
      `)).rows).toEqual([{ count: 1 }]);

      await client.exec(`
        insert into organizations values ('10000000-0000-4000-8000-000000000001');
        insert into communication_blocks (target_type, organization_id, reason, created_by)
        values ('organization', '10000000-0000-4000-8000-000000000001', 'requested', 'owner');
      `);
      expect((await client.query("select count(*)::int as count from communication_block_events where action = 'created'")).rows)
        .toEqual([{ count: 2 }]);
      await expect(client.exec("delete from organizations")).rejects.toThrow();
      await expect(client.exec("update communication_block_events set action = 'changed'")).rejects.toThrow();
      await expect(client.exec(`insert into communication_blocks (target_type, normalized_email, reason, created_by) values ('organization', 'person@example.com', 'wrong target', 'owner')`)).rejects.toThrow();
      await expect(client.exec(`insert into communication_blocks (target_type, reason, created_by) values ('recipient_email', 'missing target', 'owner')`)).rejects.toThrow();
    } finally {
      await client.close();
    }
  }, 15_000);

  it("fails readiness for a corrupt same-name target check", async () => {
    const client = new PGlite();
    const query = (sql: string) => client.query(sql) as Promise<{ rows: Array<Record<string, unknown>> }>;
    try {
      await client.exec(`
        create table organizations (id uuid primary key);
        create table contacts (id uuid primary key);
        create table lead_import_rows (id uuid primary key);
        create table communication_blocks (
          id uuid primary key default gen_random_uuid(), target_type text not null,
          organization_id uuid, contact_id uuid, normalized_email text, row_id uuid,
          reason text not null, active boolean not null default true, created_by text not null,
          created_at timestamptz not null default now(), removed_by text, removed_at timestamptz,
          removal_reason text,
          constraint communication_blocks_exact_target check (true)
        );
        create table communication_block_events (
          id uuid primary key default gen_random_uuid(), block_id uuid not null,
          action text not null, actor_id text not null, reason text not null,
          created_at timestamptz not null default now()
        );
      `);
      await expect(isCommunicationBlockSchemaReady({ query })).resolves.toBe(false);
    } finally {
      await client.close();
    }
  }, 15_000);
});
