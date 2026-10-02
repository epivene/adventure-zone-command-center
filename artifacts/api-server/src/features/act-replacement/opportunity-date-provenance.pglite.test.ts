import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { DrizzleApplyRepository } from "./drizzle-apply-repository";
const source = "00000000-0000-4000-8000-000000000001", version = "00000000-0000-4000-8000-000000000002", batch = "00000000-0000-4000-8000-000000000003";
it("stores ACT sales evidence once and replay preserves verified dates and commercial status", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`create table bookings(id uuid primary key default gen_random_uuid(),name text,city text,region text,act_record_id text unique,venue_name text,address_1 text,postal_code text,starts_at timestamptz,ends_at timestamptz,status text,probability text,notes text);
      create table act_source_records(id uuid primary key,source_database_key text,stream_type text,act_record_id text);
      create table act_external_links(entity_type text,entity_id uuid,source_record_id uuid,source_database_key text,source_entity_type text,act_record_id text);
      create table act_replacement_apply_batches(id uuid primary key,attempt_token uuid,state text,lease_expires_at timestamptz,updated_at timestamptz);
      insert into act_source_records values ('${source}','act-db','opportunity','ACT-FAIR');
      insert into act_replacement_apply_batches values ('${batch}','${batch}','applying',now()+interval '1 hour',now());`);
    await pg.exec(await readFile(new URL("../../../../../lib/db/migrations/20261002_booking_date_provenance.sql",import.meta.url),"utf8"));
    const repository = new DrizzleApplyRepository(drizzle(pg) as never);
    const values = {name:"Fair",city:"Denver",region:"CO",localStatus:"new_lead",startsAt:"2026-04-01T12:00:00Z",endsAt:"9999-12-31T00:00:00Z",salesMilestones:{estimatedCloseDate:"2026-04-01T12:00:00Z",actualCloseDate:"9999-12-31T00:00:00Z"}};
    const attempt = {batchId:batch,attemptToken:batch};
    const first = await repository.createTarget("booking",values,source,version,attempt);
    const rows = await pg.query<{id:string,starts_at:unknown,ends_at:unknown}>("select id,starts_at,ends_at from bookings");
    expect(rows.rows[0].starts_at).toBeNull(); expect(rows.rows[0].ends_at).toBeNull();
    const evidence = await pg.query<{value:string}>("select value from booking_date_evidence order by field");
    expect(evidence.rows.map(x=>x.value).sort()).toEqual(["2026-04-01T12:00:00Z","9999-12-31T00:00:00Z"]);
    await pg.query("update bookings set starts_at='2027-04-03',ends_at='2027-04-04',status='confirmed' where id=$1",[first.target.id]);
    const replay = await repository.createTarget("booking",values,source,version,attempt);
    expect(replay.alreadyPresent).toBe(true);
    expect((await pg.query("select count(*)::int as count from booking_date_evidence")).rows).toEqual([{count:2}]);
    expect((await pg.query("select status,extract(year from starts_at)::int as year from bookings")).rows).toEqual([{status:"confirmed",year:2027}]);
  } finally { await pg.close(); }
});
