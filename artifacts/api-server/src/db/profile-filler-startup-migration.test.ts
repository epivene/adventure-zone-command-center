import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

import {
  ensureProfileFillerSchema, isProfileFillerSchemaReady,
} from "./profile-filler-startup-migration";

function fakeClient(readiness: boolean | (() => boolean)) {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("as ready")) {
        const ready = typeof readiness === "function" ? readiness() : readiness;
        return { rows: [{ ready }] };
      }
      return { rows: [] };
    },
  };
  return { client, queries };
}

describe("ensureProfileFillerSchema", () => {
  it("checks actual catalog metadata and repairs missing columns without touching unrelated constraints", async () => {
    const db = new PGlite();
    try {
      await db.exec("create table organizations (id uuid primary key, name text not null)");
      const migrationSql = await readFile(
        new URL("../../../../lib/db/migrations/20260829_profile_filler.sql", import.meta.url),
        "utf8",
      );
      const client = {
        async query(sql: string) {
          if (sql.includes("as ready")) return db.query<Record<string, unknown>>(sql);
          await db.exec(sql);
          return { rows: [] };
        },
      };
      expect(await isProfileFillerSchemaReady(client)).toBe(false);
      await expect(ensureProfileFillerSchema(client, { loadSql: async () => migrationSql }))
        .resolves.toBe(true);
      expect(await isProfileFillerSchemaReady(client)).toBe(true);
      const loadSql = vi.fn(async () => migrationSql);
      await expect(ensureProfileFillerSchema(client, { loadSql })).resolves.toBe(false);
      expect(loadSql).not.toHaveBeenCalled();
      await db.exec("alter table organizations alter column filler set default true");
      expect(await isProfileFillerSchemaReady(client)).toBe(false);
      await db.exec("alter table organizations alter column filler set default false");
      await db.exec("alter table organizations alter column filler_reason set not null");
      expect(await isProfileFillerSchemaReady(client)).toBe(false);
    } finally {
      await db.close();
    }
  }, 15_000);

  it("applies the repository migration twice without replacing the valid constraint", async () => {
    const client = new PGlite();
    try {
      await client.exec(`
        create table organizations (
          id uuid primary key,
          name text not null
        );
      `);
      const migrationSql = await readFile(
        new URL("../../../../lib/db/migrations/20260829_profile_filler.sql", import.meta.url),
        "utf8",
      );

      await client.exec(migrationSql);
      const firstConstraint = await client.query<{ oid: number }>(`
        select oid
        from pg_constraint
        where conrelid = 'organizations'::regclass
          and conname = 'organizations_filler_reason_required'
      `);
      await client.exec(migrationSql);
      const secondConstraint = await client.query<{ oid: number }>(`
        select oid
        from pg_constraint
        where conrelid = 'organizations'::regclass
          and conname = 'organizations_filler_reason_required'
      `);

      expect(firstConstraint.rows).toHaveLength(1);
      expect(secondConstraint.rows).toEqual(firstConstraint.rows);
      await expect(
        client.exec(`
          insert into organizations (id, name, filler)
          values ('00000000-0000-4000-8000-000000000001', 'Missing reason', true)
        `),
      ).rejects.toThrow();
    } finally {
      await client.close();
    }
  });

  it("replaces a malformed same-named constraint with the required filler-reason check", async () => {
    const client = new PGlite();
    try {
      await client.exec(`
        create table organizations (
          id uuid primary key,
          name text not null,
          filler boolean not null default false,
          filler_reason text,
          filler_changed_at timestamptz,
          constraint organizations_filler_reason_required check (true)
        );
      `);
      const migrationSql = await readFile(
        new URL("../../../../lib/db/migrations/20260829_profile_filler.sql", import.meta.url),
        "utf8",
      );

      await client.exec(migrationSql);

      const result = await client.query<{ definition: string }>(`
        select regexp_replace(lower(pg_get_constraintdef(oid)), '\\s+', '', 'g') as definition
        from pg_constraint
        where conrelid = 'organizations'::regclass
          and conname = 'organizations_filler_reason_required'
      `);
      expect(result.rows).toEqual([
        {
          definition:
            "check(((notfiller)or(nullif(btrim(filler_reason),''::text)isnotnull)))",
        },
      ]);
      await expect(
        client.exec(`
          insert into organizations (id, name, filler)
          values ('00000000-0000-4000-8000-000000000002', 'Missing reason', true)
        `),
      ).rejects.toThrow();
    } finally {
      await client.close();
    }
  });

  it("does not rerun the migration when all required columns and the constraint exist", async () => {
    const h = fakeClient(true);
    const loadSql = vi.fn(async () => "alter table organizations should_not_run;");

    await expect(ensureProfileFillerSchema(h.client, { loadSql })).resolves.toBe(false);

    expect(loadSql).not.toHaveBeenCalled();
    expect(h.queries).toHaveLength(1);
    expect(h.queries[0]).toContain("filler_changed_at");
    expect(h.queries[0]).toContain("organizations_filler_reason_required");
  });

  it("repairs a database missing profile-filler columns before committing startup", async () => {
    let repaired = false;
    const h = fakeClient(() => repaired);
    const migrationSql = "alter table organizations add column filler boolean;";
    const loadSql = vi.fn(async () => {
      repaired = true;
      return migrationSql;
    });

    await expect(ensureProfileFillerSchema(h.client, { loadSql })).resolves.toBe(true);

    expect(loadSql).toHaveBeenCalledOnce();
    expect(h.queries).toContain("BEGIN");
    expect(h.queries).toContain(migrationSql);
    expect(h.queries).toContain("COMMIT");
    expect(h.queries.indexOf("BEGIN")).toBeLessThan(h.queries.indexOf(migrationSql));
    expect(h.queries.indexOf(migrationSql)).toBeLessThan(h.queries.indexOf("COMMIT"));
  });

  it("rolls back and rejects startup when the migration does not satisfy the schema contract", async () => {
    const h = fakeClient(false);

    await expect(
      ensureProfileFillerSchema(h.client, {
        loadSql: async () => "select 1;",
      }),
    ).rejects.toThrow("PROFILE_FILLER_SCHEMA_INCOMPLETE");

    expect(h.queries).toContain("ROLLBACK");
    expect(h.queries).not.toContain("COMMIT");
  });

  it("leaves transaction ownership to the required startup wrapper", async () => {
    let repaired = false;
    const h = fakeClient(() => repaired);
    await expect(ensureProfileFillerSchema(h.client, {
      inTransaction: true,
      loadSql: async () => { repaired = true; return "select 1;"; },
    })).resolves.toBe(true);
    expect(h.queries).not.toContain("BEGIN");
    expect(h.queries).not.toContain("COMMIT");
    expect(h.queries).not.toContain("ROLLBACK");
  });
});