import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { ensureEarlyBirdPromoOffer } from "./early-bird-promo-offer-seed";

describe("approved Early Bird Promo offer seed", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("creates one active campaign rule without changing the proposed source rule", async () => {
    const client = new PGlite();
    clients.push(client);
    await client.exec(`
      create table business_source_documents (id uuid primary key);
      create table commercial_offer_rules (
        id uuid primary key default gen_random_uuid(), code text not null unique,
        name text not null, kind text not null, state text not null,
        audience text not null, source_document_id uuid,
        calculation_type text not null, amount_cents integer,
        amount_basis_points integer, calculation_scope text,
        stack_policy text not null, applies_to_package_codes text[] not null default '{}',
        new_customer_only boolean not null default false,
        repeat_customer_only boolean not null default false,
        requires_owner_confirmation boolean not null default true,
        deadline_mode text not null, deadline_days integer, fixed_deadline date,
        customer_summary text, internal_conditions text not null,
        source_conflict_note text, reviewed_by text, reviewed_at timestamptz,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now()
      );
      insert into commercial_offer_rules (
        code, name, kind, state, audience, calculation_type,
        amount_basis_points, stack_policy, requires_owner_confirmation,
        deadline_mode, internal_conditions
      ) values (
        'early_bird_10_percent', '10% early-bird discount', 'discount',
        'proposed', 'customer_safe', 'percent_basis_points', 1000,
        'manual', true, 'manual', 'Historical source note.'
      );
    `);
    const db = drizzle(client, { schema });

    await ensureEarlyBirdPromoOffer(db as never);
    await ensureEarlyBirdPromoOffer(db as never);

    const rows = (await client.query(`
      select code, state, amount_basis_points, requires_owner_confirmation,
             deadline_mode, deadline_days, source_document_id, reviewed_by
      from commercial_offer_rules order by code
    `)).rows;
    expect(rows).toEqual([
      {
        code: "early_bird_10_percent",
        state: "proposed",
        amount_basis_points: 1000,
        requires_owner_confirmation: true,
        deadline_mode: "manual",
        deadline_days: null,
        source_document_id: null,
        reviewed_by: null,
      },
      {
        code: "early_bird_promo_2026_2027",
        state: "active",
        amount_basis_points: 1000,
        requires_owner_confirmation: false,
        deadline_mode: "days_after_trigger",
        deadline_days: 30,
        source_document_id: null,
        reviewed_by: "conversation:2026-09-09",
      },
    ]);
  }, 20_000);
});
