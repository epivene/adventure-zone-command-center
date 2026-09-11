import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

async function runMigration(client: PGlite) {
  const sql = (await readFile(
    new URL("../../../../lib/db/migrations/20260822_google_workspace_foundation.sql", import.meta.url),
    "utf8",
  )).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", "");
  await client.exec(sql);
}

describe("20260822 Google Workspace foundation migration", () => {
  const clients: PGlite[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  it("still creates the legacy single-active guard on a fresh foundation schema", async () => {
    const client = new PGlite();
    clients.push(client);

    await runMigration(client);

    expect((await client.query<{ present: boolean }>(
      "select to_regclass('google_workspace_connections_single_active_unique') is not null as present",
    )).rows[0]?.present).toBe(true);
  });

  it("preserves active connections separated by the later role upgrade", async () => {
    const client = new PGlite();
    clients.push(client);
    await client.exec(`
      create table google_workspace_connections (
        id uuid primary key default gen_random_uuid(),
        account_email text not null,
        status text not null default 'connected',
        encrypted_refresh_token jsonb not null,
        granted_scopes jsonb not null default '[]'::jsonb,
        google_subject text,
        connected_at timestamptz not null default now(),
        last_verified_at timestamptz,
        disconnected_at timestamptz,
        last_error_code text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        role text not null default 'workspace',
        operational_calendar_id text,
        unique (account_email, role)
      );
      create unique index google_workspace_connections_active_role_unique
        on google_workspace_connections(role)
        where status in ('connected', 'reauthorization_required');
      insert into google_workspace_connections
        (account_email, status, encrypted_refresh_token, role)
      values
        ('workspace@example.com', 'connected', '{}'::jsonb, 'workspace'),
        ('calendar@example.com', 'connected', '{}'::jsonb, 'operational_calendar');
    `);

    await runMigration(client);

    expect((await client.query(
      `select account_email, role
       from google_workspace_connections
       where status in ('connected', 'reauthorization_required')
       order by role`,
    )).rows).toEqual([
      { account_email: "calendar@example.com", role: "operational_calendar" },
      { account_email: "workspace@example.com", role: "workspace" },
    ]);
    expect((await client.query<{ present: boolean }>(
      "select to_regclass('google_workspace_connections_single_active_unique') is not null as present",
    )).rows[0]?.present).toBe(false);
  });
});
