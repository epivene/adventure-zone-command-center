import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ActEntityRecovery } from "./entity-recovery";
import { ActRelationshipRecovery } from "./relationship-recovery";
import { ActRecoverySourceLinkResolver } from "./source-link-resolver";
import type { RecoveryCandidate } from "./recovery-types";

const databaseKey = "relationship-recovery";
const companySource = "10000000-0000-4000-8000-000000000001";
const contactSource = "10000000-0000-4000-8000-000000000002";
const opportunitySource = "10000000-0000-4000-8000-000000000003";
const groupSource = "10000000-0000-4000-8000-000000000004";
const opportunityCompanyRel = "10000000-0000-4000-8000-000000000011";
const opportunityContactRel = "10000000-0000-4000-8000-000000000012";
const companyContactRel = "10000000-0000-4000-8000-000000000013";
const groupContactRel = "10000000-0000-4000-8000-000000000014";
const organizationId = "20000000-0000-4000-8000-000000000001";
const contactId = "20000000-0000-4000-8000-000000000002";

let client: PGlite;
let entityRecovery: ActEntityRecovery;
let relationshipRecovery: ActRelationshipRecovery;

function candidate(sourceRecordId: string, streamType: string, actRecordId: string | null, rawSnapshot: Record<string, unknown> = {}): RecoveryCandidate {
  return {
    itemId: crypto.randomUUID(), runId: crypto.randomUUID(), sourceVersionId: crypto.randomUUID(), leaseToken: crypto.randomUUID(),
    sourceRecordId, streamType, actRecordId, rawSnapshot, relationshipEvidence: {},
  };
}

beforeEach(async () => {
  client = new PGlite();
  const database = drizzle(client);
  const resolver = new ActRecoverySourceLinkResolver(database as never);
  entityRecovery = new ActEntityRecovery(database as never, resolver);
  relationshipRecovery = new ActRelationshipRecovery(database as never, resolver);
  await client.exec(`
    CREATE TABLE act_source_records (
      id uuid PRIMARY KEY, source_database_key text NOT NULL, stream_type text NOT NULL,
      act_record_id text, relationship_evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE act_external_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_type text NOT NULL, entity_id uuid NOT NULL,
      source_entity_type text NOT NULL, act_record_id text NOT NULL, source_database_key text,
      source_record_id uuid, is_primary boolean NOT NULL DEFAULT false, sync_mode text NOT NULL DEFAULT 'pull_only'
    );
    CREATE TABLE organizations (
      id uuid PRIMARY KEY, name text NOT NULL, phone text, normalized_phone text, website text, act_industry text,
      address_1 text, address_2 text, city text, region text, postal_code text, act_record_id text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE contacts (
      id uuid PRIMARY KEY, first_name text NOT NULL, last_name text NOT NULL, email text, phone text, normalized_phone text,
      job_title text, address_1 text, address_2 text, city text, region text, postal_code text, act_record_id text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE bookings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, name text NOT NULL,
      primary_contact_id uuid, city text NOT NULL, region text NOT NULL, starts_at timestamptz, ends_at timestamptz,
      status text NOT NULL DEFAULT 'new_lead', probability text NOT NULL DEFAULT 'possible', notes text, act_record_id text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE calling_lists (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, kind text NOT NULL,
      source_status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE organization_contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, contact_id uuid NOT NULL,
      role text, is_primary boolean NOT NULL DEFAULT false, source text NOT NULL DEFAULT 'local', active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id, contact_id)
    );
    CREATE TABLE booking_contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL, contact_id uuid NOT NULL,
      is_primary boolean NOT NULL DEFAULT false, source text NOT NULL DEFAULT 'local',
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (booking_id, contact_id)
    );
    CREATE TABLE calling_list_memberships (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), calling_list_id uuid NOT NULL, contact_id uuid NOT NULL,
      source text NOT NULL DEFAULT 'local', active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (calling_list_id, contact_id)
    );
    CREATE TABLE audit_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_type text NOT NULL, entity_id uuid NOT NULL,
      action text NOT NULL, before jsonb, after jsonb, created_at timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO organizations (id, name, city, region) VALUES ('${organizationId}', '16th Street Fair', 'Denver', 'CO');
    INSERT INTO contacts (id, first_name, last_name, email) VALUES ('${contactId}', 'Dana', 'Smith', 'dana@example.com');
    INSERT INTO act_source_records (id, source_database_key, stream_type, act_record_id) VALUES
      ('${companySource}', '${databaseKey}', 'company', 'act-company-1'),
      ('${contactSource}', '${databaseKey}', 'contact', 'act-contact-1'),
      ('${opportunitySource}', '${databaseKey}', 'opportunity', 'act-opportunity-1'),
      ('${groupSource}', '${databaseKey}', 'group', 'act-group-1');
    INSERT INTO act_external_links
      (entity_type, entity_id, source_entity_type, act_record_id, source_database_key, source_record_id)
    VALUES
      ('organization', '${organizationId}', 'company', 'act-company-1', '${databaseKey}', '${companySource}'),
      ('contact', '${contactId}', 'contact', 'act-contact-1', '${databaseKey}', '${contactSource}');
    INSERT INTO act_source_records (id, source_database_key, stream_type, relationship_evidence) VALUES
      ('${opportunityCompanyRel}', '${databaseKey}', 'opportunity_company',
        '{"parentKind":"opportunity","parentActRecordId":"act-opportunity-1","targetKind":"company","targetActRecordId":"act-company-1"}'),
      ('${opportunityContactRel}', '${databaseKey}', 'opportunity_contact',
        '{"parentKind":"opportunity","parentActRecordId":"act-opportunity-1","targetKind":"contact","targetActRecordId":"act-contact-1"}'),
      ('${companyContactRel}', '${databaseKey}', 'company_contact',
        '{"parentKind":"contact","parentActRecordId":"act-contact-1","targetKind":"company","targetActRecordId":"act-company-1"}'),
      ('${groupContactRel}', '${databaseKey}', 'group_contact',
        '{"parentKind":"group","parentActRecordId":"act-group-1","targetKind":"contact","targetActRecordId":"act-contact-1"}');
  `);
});

afterEach(async () => client.close());

describe("ACT booking/group recovery", () => {
  it("creates an opportunity booking using the exactly related organization's location", async () => {
    const result = await entityRecovery.recoverEntity(candidate(
      opportunitySource,
      "opportunity",
      "act-opportunity-1",
      { id: "act-opportunity-1", name: "16th Street Fair 2027" },
    ));
    expect(result.state).toBe("recovered");
    expect((await client.query(`SELECT organization_id, name, city, region FROM bookings WHERE id = $1`, [result.targetSummary.entityId])).rows).toEqual([
      { organization_id: organizationId, name: "16th Street Fair 2027", city: "Denver", region: "CO" },
    ]);
  });

  it("does not create an orphan opportunity when its archived company cannot resolve", async () => {
    await client.query(`DELETE FROM act_external_links WHERE source_record_id = $1`, [companySource]);
    const result = await entityRecovery.recoverEntity(candidate(
      opportunitySource,
      "opportunity",
      "act-opportunity-1",
      { id: "act-opportunity-1", name: "16th Street Fair 2027" },
    ));
    expect(result.state).toBe("needs_review");
    expect((await client.query(`SELECT count(*)::int AS count FROM bookings`)).rows).toEqual([{ count: 0 }]);
  });

  it("creates an ACT group as one idempotently linked calling list", async () => {
    const source = candidate(groupSource, "group", "act-group-1", { id: "act-group-1", name: "Colorado Fairs" });
    const first = await entityRecovery.recoverEntity(source);
    const second = await entityRecovery.recoverEntity(source);
    expect(first.state).toBe("recovered");
    expect(second.state).toBe("already_present");
    expect((await client.query(`SELECT count(*)::int AS count FROM calling_lists`)).rows).toEqual([{ count: 1 }]);
  });
});

describe("ACT relationship recovery", () => {
  it("repairs exact CRM relationships and is idempotent", async () => {
    const booking = await entityRecovery.recoverEntity(candidate(
      opportunitySource, "opportunity", "act-opportunity-1", { id: "act-opportunity-1", name: "16th Street Fair 2027" },
    ));
    const group = await entityRecovery.recoverEntity(candidate(
      groupSource, "group", "act-group-1", { id: "act-group-1", name: "Colorado Fairs" },
    ));
    expect(booking.state).toBe("recovered");
    expect(group.state).toBe("recovered");

    for (const [sourceId, stream] of [
      [companyContactRel, "company_contact"],
      [opportunityCompanyRel, "opportunity_company"],
      [opportunityContactRel, "opportunity_contact"],
      [groupContactRel, "group_contact"],
    ] as const) {
      const first = await relationshipRecovery.recoverRelationship(candidate(sourceId, stream, null));
      const second = await relationshipRecovery.recoverRelationship(candidate(sourceId, stream, null));
      expect(["recovered", "already_present"]).toContain(first.state);
      expect(second.state).toBe("already_present");
    }

    expect((await client.query(`SELECT organization_id, contact_id FROM organization_contacts`)).rows).toEqual([
      { organization_id: organizationId, contact_id: contactId },
    ]);
    expect((await client.query(`SELECT booking_id, contact_id FROM booking_contacts`)).rows).toEqual([
      { booking_id: booking.targetSummary.entityId, contact_id: contactId },
    ]);
    expect((await client.query(`SELECT calling_list_id, contact_id FROM calling_list_memberships`)).rows).toEqual([
      { calling_list_id: group.targetSummary.entityId, contact_id: contactId },
    ]);
  });
});
