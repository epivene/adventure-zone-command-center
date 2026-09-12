import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

let client: PGlite | null = null;

afterEach(async () => {
  await client?.close();
  client = null;
});

describe("recent outreach Gmail-label follow-up backfill", () => {
  it("creates organization reminders from exact active label mappings without duplicating open work", async () => {
    client = new PGlite();
    await client.exec(`
      create table organizations (id uuid primary key, name text not null);
      create table google_workspace_profile_labels (
        id uuid primary key default gen_random_uuid(),
        connection_id uuid not null,
        organization_id uuid not null references organizations(id),
        gmail_label_id text not null,
        gmail_label_name text not null,
        state text not null,
        updated_at timestamptz not null default now()
      );
      create table follow_ups (
        id uuid primary key default gen_random_uuid(),
        organization_id uuid references organizations(id),
        contact_id uuid,
        kind text not null,
        due_at timestamptz not null,
        completed_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      insert into organizations values
        ('10000000-0000-4000-8000-000000000001', 'Logger Days'),
        ('10000000-0000-4000-8000-000000000002', 'Big Horn County Fair'),
        ('10000000-0000-4000-8000-000000000003', 'Wellness Festival');
      insert into google_workspace_profile_labels
        (connection_id, organization_id, gmail_label_id, gmail_label_name, state)
      values
        ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Label_227', 'Logger Days', 'active'),
        ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'Label_219', 'Big Horn County Fair', 'active'),
        ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'Label_685', 'Wellness Festival', 'active');
      insert into follow_ups (organization_id, kind, due_at)
      values
        ('10000000-0000-4000-8000-000000000002', 'awaiting_decision', '2026-10-03T18:00:00Z'),
        ('10000000-0000-4000-8000-000000000003', 'email', '2026-08-01T18:00:00Z');
    `);

    const migration = await readFile(
      new URL("../../../../lib/db/migrations/20260912d_recent_outreach_future_followups.sql", import.meta.url),
      "utf8",
    );
    await client.exec(migration);
    await client.exec(migration);

    const result = await client.query<{ organization_id: string; kind: string; due_at: string }>(`
      select organization_id::text, kind, due_at::text
      from follow_ups
      order by organization_id
    `);

    expect(result.rows).toHaveLength(4);
    expect(result.rows[0]?.kind).toBe("2027_outreach");
    expect(new Date(result.rows[0]!.due_at).toISOString()).toBe("2026-09-19T18:00:00.000Z");
    expect(result.rows[1]?.kind).toBe("awaiting_decision");
    expect(new Date(result.rows[1]!.due_at).toISOString()).toBe("2026-10-03T18:00:00.000Z");

    const wellness = result.rows.filter((row) => row.organization_id === "10000000-0000-4000-8000-000000000003");
    expect(wellness).toHaveLength(2);
    expect(wellness.some((row) => new Date(row.due_at).toISOString() === "2026-09-18T18:00:00.000Z")).toBe(true);
  }, 15_000);
});
