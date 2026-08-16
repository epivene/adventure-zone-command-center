import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ActRecoverySourceLinkResolver } from "./source-link-resolver";

const databaseKey = "archive-links";
const companySource = "10000000-0000-4000-8000-000000000001";
const contactSource = "10000000-0000-4000-8000-000000000002";
const historySource = "10000000-0000-4000-8000-000000000003";
const historyCompanyRel = "10000000-0000-4000-8000-000000000004";
const malformedRel = "10000000-0000-4000-8000-000000000005";
const organizationId = "20000000-0000-4000-8000-000000000001";
const contactId = "20000000-0000-4000-8000-000000000002";

let client: PGlite;
let resolver: ActRecoverySourceLinkResolver;

beforeEach(async () => {
  client = new PGlite();
  const database = drizzle(client);
  resolver = new ActRecoverySourceLinkResolver(database as never);
  await client.exec(`
    CREATE TABLE act_source_records (
      id uuid PRIMARY KEY,
      source_database_key text NOT NULL,
      stream_type text NOT NULL,
      act_record_id text,
      relationship_evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE act_external_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type text NOT NULL,
      entity_id uuid NOT NULL,
      source_entity_type text NOT NULL,
      act_record_id text NOT NULL,
      source_database_key text,
      source_record_id uuid
    );
    CREATE TABLE organizations (id uuid PRIMARY KEY, act_record_id text);
    CREATE TABLE contacts (id uuid PRIMARY KEY, act_record_id text);
    CREATE TABLE bookings (id uuid PRIMARY KEY, act_record_id text);
    CREATE TABLE calling_lists (id uuid PRIMARY KEY, act_record_id text);

    INSERT INTO act_source_records (id, source_database_key, stream_type, act_record_id) VALUES
      ('${companySource}', '${databaseKey}', 'company', 'act-company-1'),
      ('${contactSource}', '${databaseKey}', 'contact', 'act-contact-1'),
      ('${historySource}', '${databaseKey}', 'history', 'act-history-1');
    INSERT INTO act_source_records (id, source_database_key, stream_type, relationship_evidence) VALUES
      ('${historyCompanyRel}', '${databaseKey}', 'history_company',
       '{"parentKind":"history","parentActRecordId":"act-history-1","targetKind":"company","targetActRecordId":"act-company-1"}'),
      ('${malformedRel}', '${databaseKey}', 'history_company', '{"parentKind":"history"}');

    INSERT INTO act_external_links
      (entity_type, entity_id, source_entity_type, act_record_id, source_database_key, source_record_id)
    VALUES
      ('organization', '${organizationId}', 'company', 'act-company-1', '${databaseKey}', '${companySource}'),
      ('contact', '${contactId}', 'contact', 'act-contact-1', '${databaseKey}', '${contactSource}');
  `);
});

afterEach(async () => {
  await client.close();
});

describe("ActRecoverySourceLinkResolver", () => {
  it("resolves company and contact sources only from durable ACT provenance", async () => {
    expect(await resolver.resolveLocalSource(companySource)).toEqual({
      kind: "resolved",
      entityType: "organization",
      entityId: organizationId,
    });
    expect(await resolver.resolveLocalSource(contactSource)).toEqual({
      kind: "resolved",
      entityType: "contact",
      entityId: contactId,
    });
  });

  it("resolves archived history relationship evidence to its exact parent and local target", async () => {
    expect(await resolver.resolveRelationship(historyCompanyRel)).toEqual({
      kind: "resolved",
      relationship: {
        parentSourceRecordId: historySource,
        parentActRecordId: "act-history-1",
        targetSourceRecordId: companySource,
        targetKind: "company",
        targetActRecordId: "act-company-1",
      },
      target: {
        kind: "resolved",
        entityType: "organization",
        entityId: organizationId,
      },
    });
  });

  it("fails closed when relationship evidence is malformed", async () => {
    expect(await resolver.resolveRelationship(malformedRel)).toEqual({
      kind: "invalid",
      reason: "invalid_relationship_evidence",
    });
  });

  it("returns ambiguity instead of choosing the first local source link", async () => {
    const otherOrgId = "20000000-0000-4000-8000-000000000099";
    await client.query(
      `INSERT INTO act_external_links
        (entity_type, entity_id, source_entity_type, act_record_id, source_database_key, source_record_id)
       VALUES ('organization', $1, 'company', 'act-company-1', $2, $3)`,
      [otherOrgId, databaseKey, companySource],
    );
    const result = await resolver.resolveLocalSource(companySource);
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates.map(({ entityId }) => entityId).sort()).toEqual([organizationId, otherOrgId].sort());
    }
  });
});
