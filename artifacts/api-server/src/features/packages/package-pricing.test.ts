import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PACKAGE_TEMPLATE_SEED_SQL,
  REVIEWED_PACKAGE_DEFAULTS,
} from "./package-defaults";

let client: PGlite | null = null;

afterEach(async () => {
  await client?.close();
  client = null;
});

describe("current package pricing", () => {
  it("quotes Pirate's Rebellion and Warrior's Playground at $8,000", () => {
    expect(REVIEWED_PACKAGE_DEFAULTS.pirates_rebellion.basePriceCents).toBe(800000);
    expect(REVIEWED_PACKAGE_DEFAULTS.weekend_warriors.basePriceCents).toBe(800000);
  });

  it("upgrades both previously reviewed $7,500 package prices", async () => {
    client = new PGlite();
    await client.exec(`
      create table package_templates (
        id uuid primary key default gen_random_uuid(), code text not null unique,
        name text not null, base_price_cents integer, base_attraction_count integer not null,
        normal_capacity integer not null, temporary_unavailable_quantity integer not null,
        minimum_attraction_count integer, maximum_attraction_count integer,
        base_duration_min_days integer, base_duration_max_days integer,
        customer_description text, booking_talking_points text,
        operational_requirements text, setup_notes text, knowledge_review_note text,
        active boolean not null default true,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now()
      );
      insert into package_templates
        (code, name, base_price_cents, base_attraction_count, normal_capacity, temporary_unavailable_quantity)
      values
        ('pirates_rebellion', 'Pirate''s Rebellion', 750000, 3, 3, 0),
        ('weekend_warriors', 'Warrior''s Playground', 750000, 5, 1, 0);
    `);

    await client.exec(DEFAULT_PACKAGE_TEMPLATE_SEED_SQL);

    const result = await client.query<{ code: string; base_price_cents: number }>(`
      select code, base_price_cents
      from package_templates
      where code in ('pirates_rebellion', 'weekend_warriors')
      order by code
    `);
    expect(result.rows).toEqual([
      { code: "pirates_rebellion", base_price_cents: 800000 },
      { code: "weekend_warriors", base_price_cents: 800000 },
    ]);
  });

  it("sets both live package aliases to $8,000 regardless of their stale values", async () => {
    client = new PGlite();
    await client.exec(`
      create table package_templates (
        code text primary key, base_price_cents integer, updated_at timestamptz not null default now()
      );
      insert into package_templates (code, base_price_cents) values
        ('pirates_rebellion', null),
        ('weekend_warriors', 900000);
    `);
    const migration = await readFile(
      new URL("../../../../../lib/db/migrations/20260904_pirates_warriors_price_8000.sql", import.meta.url),
      "utf8",
    );

    await client.exec(migration);

    const result = await client.query<{ code: string; base_price_cents: number }>(`
      select code, base_price_cents from package_templates order by code
    `);
    expect(result.rows).toEqual([
      { code: "pirates_rebellion", base_price_cents: 800000 },
      { code: "weekend_warriors", base_price_cents: 800000 },
    ]);
  });
});
