import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ActRecoverySourceLinkResolver } from "./source-link-resolver";
import { ActEntityRecovery } from "./entity-recovery";
import type { RecoveryCandidate } from "./recovery-types";

const databaseKey = "entity-recovery";
const existingOrgId = "20000000-0000-4000-8000-000000000001";
let client: PGlite;
let recovery: ActEntityRecovery;

function candidate(input: {
  sourceRecordId: string;
  sourceVersionId: string;
  streamType: "company" | "contact";
  actRecordId: string;
  rawSnapshot: Record<string, unknown>;
}): RecoveryCandidate {
  return {
    itemId: "90000000-0000-4000-8000-000000000001",
    runId: "90000000-0000-4000-8000-000000000002",
    leaseToken: "90000000-0000-4000-8000-000000000003",
    relationshipEvidence: {},
    ...input,
  };
}

async function seedSource(sourceRecordId: string, streamType: string, actRecordId: string) {
  await client.query(
    `INSERT INTO act_source_records (id, source_database_key, stream_type, act_record_id)
     VALUES ($1, $2, $3, $4)`,
    [sourceRecordId, databaseKey, streamType, actRecordId],
  );
}

beforeEach(async () => {
  client = new PGlite();
  const database = drizzle(client);
  recovery = new ActEntityRecovery(database as never, new ActRecoverySourceLinkResolver(database as never));
  await client.exec(`
    CREATE TABLE act_source_records (
      id uuid PRIMARY KEY, source_database_key text NOT NULL,
      stream_type text NOT NULL, act_record_id text, relationship_evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE act_external_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_type text NOT NULL, entity_id uuid NOT NULL,
      source_entity_type text NOT NULL, act_record_id text NOT NULL, source_database_key text,
      source_record_id uuid, is_primary boolean NOT NULL DEFAULT false,
      sync_mode text NOT NULL DEFAULT 'pull_only'
    );
    CREATE TABLE organizations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
      phone text, normalized_phone text, website text, act_industry text,
      address_1 text, address_2 text, city text, region text, postal_code text,
      act_record_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), first_name text NOT NULL, last_name text NOT NULL,
      email text, phone text, normalized_phone text, job_title text,
      address_1 text, address_2 text, city text, region text, postal_code text,
      act_record_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE audit_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_type text NOT NULL, entity_id uuid NOT NULL,
      action text NOT NULL, before jsonb, after jsonb, created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
});

afterEach(async () => {
  await client.close();
});

describe("ActEntityRecovery", () => {
  it("fills a missing linked company field but never replaces a populated local value", async () => {
    const sourceId = "10000000-0000-4000-8000-000000000001";
    await seedSource(sourceId, "company", "act-company-linked");
    await client.query(
      `INSERT INTO organizations (id, name, phone, website) VALUES ($1, '16th Street Fair', NULL, 'https://local.example')`,
      [existingOrgId],
    );
    await client.query(
      `INSERT INTO act_external_links
        (entity_type, entity_id, source_entity_type, act_record_id, source_database_key, source_record_id)
       VALUES ('organization', $1, 'company', 'act-company-linked', $2, $3)`,
      [existingOrgId, databaseKey, sourceId],
    );

    const result = await recovery.recoverEntity(candidate({
      sourceRecordId: sourceId,
      sourceVersionId: "30000000-0000-4000-8000-000000000001",
      streamType: "company",
      actRecordId: "act-company-linked",
      rawSnapshot: { id: "act-company-linked", name: "16th Street Fair", phone: "303-555-1212", website: "https://old-act.example" },
    }));

    expect(result.state).toBe("recovered");
    expect((await client.query(`SELECT phone, website FROM organizations WHERE id = $1`, [existingOrgId])).rows).toEqual([
      { phone: "303-555-1212", website: "https://local.example" },
    ]);
  });

  it("creates a valid missing company with durable ACT provenance", async () => {
    const sourceId = "10000000-0000-4000-8000-000000000002";
    await seedSource(sourceId, "company", "act-company-new");
    const result = await recovery.recoverEntity(candidate({
      sourceRecordId: sourceId,
      sourceVersionId: "30000000-0000-4000-8000-000000000002",
      streamType: "company",
      actRecordId: "act-company-new",
      rawSnapshot: { id: "act-company-new", name: "Recovered Fair", phone: "701-555-0199" },
    }));

    expect(result.state).toBe("recovered");
    const links = (await client.query(`SELECT entity_type, source_record_id FROM act_external_links WHERE source_record_id = $1`, [sourceId])).rows;
    expect(links).toEqual([{ entity_type: "organization", source_record_id: sourceId }]);
    expect((await client.query(`SELECT name, phone FROM organizations WHERE id = $1`, [result.targetSummary.entityId])).rows).toEqual([
      { name: "Recovered Fair", phone: "701-555-0199" },
    ]);
  });

  it("sends an ambiguous exact company match to review instead of picking one", async () => {
    const sourceId = "10000000-0000-4000-8000-000000000003";
    await seedSource(sourceId, "company", "act-company-ambiguous");
    await client.exec(`
      INSERT INTO organizations (name, city, region) VALUES
        ('Same Fair', 'Denver', 'CO'), ('Same Fair', 'Denver', 'CO');
    `);
    const result = await recovery.recoverEntity(candidate({
      sourceRecordId: sourceId,
      sourceVersionId: "30000000-0000-4000-8000-000000000003",
      streamType: "company",
      actRecordId: "act-company-ambiguous",
      rawSnapshot: { id: "act-company-ambiguous", name: "Same Fair", address: { city: "Denver", state: "CO" } },
    }));
    expect(result.state).toBe("needs_review");
    expect(result.targetSummary.reason).toBe("ambiguous_exact_match");
  });

  it("drops a company source with no meaningful required identity", async () => {
    const sourceId = "10000000-0000-4000-8000-000000000004";
    await seedSource(sourceId, "company", "act-company-bad");
    const result = await recovery.recoverEntity(candidate({
      sourceRecordId: sourceId,
      sourceVersionId: "30000000-0000-4000-8000-000000000004",
      streamType: "company",
      actRecordId: "act-company-bad",
      rawSnapshot: { id: "act-company-bad" },
    }));
    expect(result.state).toBe("dropped_unusable");
  });

  it("creates a valid missing contact and preserves its exact source provenance", async () => {
    const sourceId = "10000000-0000-4000-8000-000000000005";
    await seedSource(sourceId, "contact", "act-contact-new");
    const result = await recovery.recoverEntity(candidate({
      sourceRecordId: sourceId,
      sourceVersionId: "30000000-0000-4000-8000-000000000005",
      streamType: "contact",
      actRecordId: "act-contact-new",
      rawSnapshot: { id: "act-contact-new", firstName: "Dana", lastName: "Smith", emailAddress: "dana@example.com" },
    }));
    expect(result.state).toBe("recovered");
    expect((await client.query(`SELECT first_name, last_name, email FROM contacts WHERE id = $1`, [result.targetSummary.entityId])).rows).toEqual([
      { first_name: "Dana", last_name: "Smith", email: "dana@example.com" },
    ]);
  });
});
