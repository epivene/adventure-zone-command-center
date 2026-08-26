import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { ActProfileEvidenceRepository } from "./act-profile-evidence-repository";

const organizationId = "10000000-0000-4000-8000-000000000001";
const assignedSourceId = "20000000-0000-4000-8000-000000000001";
const legacySourceId = "20000000-0000-4000-8000-000000000002";
const supersededSourceId = "20000000-0000-4000-8000-000000000003";

async function setup() {
  const client = new PGlite();
  await client.exec(`
    create table organizations (id uuid primary key, name text not null, city text, region text, phone text, website text, consolidated_into_id uuid);
    create table contacts (id uuid primary key, first_name text not null, last_name text not null, email text, job_title text);
    create table organization_contacts (organization_id uuid not null, contact_id uuid not null, role text, is_primary boolean not null, active boolean not null);
    create table act_source_records (id uuid primary key, source_database_key text not null, stream_type text not null, act_record_id text, archive_completeness text not null);
    create table act_source_record_versions (id uuid primary key, source_record_id uuid not null, raw_snapshot jsonb not null, snapshot_scope text not null, fetched_at timestamptz not null);
    create table act_source_assignments (source_record_id uuid not null, target_entity_type text not null, target_entity_id uuid not null, superseded_at timestamptz);
    create table act_external_links (entity_type text not null, source_entity_type text not null, entity_id uuid not null, act_record_id text not null, source_database_key text, source_record_id uuid);
    insert into organizations values ('${organizationId}', 'Alamosa ARTs Festival (Alamosa) CO', 'Alamosa', 'CO', '(719) 937-2636', 'https://www.societyhall.org/', null);
    insert into contacts values ('30000000-0000-4000-8000-000000000001', 'Old', 'Contact', 'old@example.com', 'Director');
    insert into organization_contacts values ('${organizationId}', '30000000-0000-4000-8000-000000000001', 'Past contact', true, false);
    insert into act_source_records values
      ('${assignedSourceId}', 'db', 'company', 'act-company-1', 'complete'),
      ('${legacySourceId}', 'db', 'company', 'act-company-2', 'complete'),
      ('${supersededSourceId}', 'db', 'company', 'act-company-3', 'complete');
    insert into act_source_assignments values
      ('${assignedSourceId}', 'organization', '${organizationId}', null),
      ('${supersededSourceId}', 'organization', '${organizationId}', '2026-08-01T00:00:00Z');
    insert into act_external_links values ('organization', 'company', '${organizationId}', 'act-company-2', 'db', null);
    insert into act_source_record_versions values
      ('40000000-0000-4000-8000-000000000001', '${assignedSourceId}', '{"Description":"old@example.com"}', 'detail', '2026-01-01T00:00:00Z'),
      ('40000000-0000-4000-8000-000000000002', '${assignedSourceId}', '{"Description":"Society Hall Annual Celebration | Societyhall@gmail.com"}', 'detail', '2026-08-01T00:00:00Z'),
      ('40000000-0000-4000-8000-000000000003', '${assignedSourceId}', '{"Description":"list@example.com"}', 'list', '2026-08-10T00:00:00Z'),
      ('40000000-0000-4000-8000-000000000004', '${legacySourceId}', '{"BusinessCard":"societyhall@gmail.com | office@example.org"}', 'detail', '2026-08-02T00:00:00Z'),
      ('40000000-0000-4000-8000-000000000005', '${supersededSourceId}', '{"Description":"wrong@example.com"}', 'detail', '2026-08-03T00:00:00Z');
  `);
  return { client, repository: new ActProfileEvidenceRepository(drizzle(client, { schema }) as never) };
}

describe("ActProfileEvidenceRepository", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("loads active contacts and newest complete detail evidence from assignment and legacy links", async () => {
    const { client, repository } = await setup(); clients.push(client);
    const result = await repository.load(organizationId);
    expect(result?.organization).toEqual({ id: organizationId, name: "Alamosa ARTs Festival (Alamosa) CO", city: "Alamosa", region: "CO", phone: "(719) 937-2636", website: "https://www.societyhall.org/" });
    expect(result?.contacts).toEqual([]);
    expect(result?.actText.map(({ sourceRecordId, sourceVersionId, originalText }) => ({ sourceRecordId, sourceVersionId, originalText }))).toEqual([
      { sourceRecordId: assignedSourceId, sourceVersionId: "40000000-0000-4000-8000-000000000002", originalText: "Society Hall Annual Celebration | Societyhall@gmail.com" },
      { sourceRecordId: legacySourceId, sourceVersionId: "40000000-0000-4000-8000-000000000004", originalText: "societyhall@gmail.com | office@example.org" },
    ]);
    expect(result?.emailCandidates.map(({ email }) => email)).toEqual(["societyhall@gmail.com", "office@example.org"]);
  });

  it("returns an empty ACT evidence collection when no complete detail is archived", async () => {
    const { client, repository } = await setup(); clients.push(client);
    await client.exec("delete from act_source_record_versions");
    await expect(repository.load(organizationId)).resolves.toMatchObject({ actText: [], emailCandidates: [] });
  });

  it("does not expose a consolidated or missing organization", async () => {
    const { client, repository } = await setup(); clients.push(client);
    await client.exec(`update organizations set consolidated_into_id='10000000-0000-4000-8000-000000000099' where id='${organizationId}'`);
    await expect(repository.load(organizationId)).resolves.toBeNull();
    await expect(repository.load("10000000-0000-4000-8000-000000000098")).resolves.toBeNull();
  });
});
