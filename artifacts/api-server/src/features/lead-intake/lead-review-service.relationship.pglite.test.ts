import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { LeadReviewService } from "./lead-review-service";

const rowId = "30000000-0000-4000-8000-000000000001";
const organizationId = "10000000-0000-4000-8000-000000000001";
const recipientEmail = "director@example.org";
const anchor = new Date("2026-08-25T18:00:00Z");

async function setup(state = "verified") {
  const client = new PGlite();
  await client.exec(`
    create table organizations (id uuid primary key, consolidated_into_id uuid);
    create table contacts (id uuid primary key, email text);
    create table organization_contacts (organization_id uuid, contact_id uuid, active boolean not null);
    create table lead_import_rows (
      id uuid primary key, review_version integer not null, state text not null,
      selected_organization_id uuid, selected_contact_id uuid, contact_mode text,
      confirmed_event_name text, confirmed_start_date date, confirmed_end_date date,
      confirmed_contact_name text, confirmed_contact_role text, confirmed_recipient_email text,
      recipient_confirmed boolean not null, introduction_suitable boolean not null,
      confirmed_by text, confirmed_at timestamptz,
      relationship_outcome text, relationship_anchor_at timestamptz,
      relationship_cutoff_date date, relationship_evidence_ids jsonb not null default '[]',
      latest_outbound_at timestamptz, latest_verified_response_at timestamptz,
      relationship_review_required boolean not null default false,
      relationship_classified_at timestamptz, relationship_classified_by text,
      updated_at timestamptz not null
    );
    create table lead_import_evidence (
      id uuid primary key default gen_random_uuid(), row_id uuid not null, field text not null,
      candidate_value text not null, source_kind text not null, source_reference text not null,
      selected boolean not null, created_by text not null, created_at timestamptz not null
    );
    insert into organizations(id) values ('${organizationId}');
    insert into lead_import_rows(
      id, review_version, state, selected_organization_id, confirmed_recipient_email,
      recipient_confirmed, introduction_suitable, updated_at
    ) values (
      '${rowId}', 1, '${state}', '${organizationId}', '${recipientEmail}',
      ${state === "verified"}, ${state === "verified"}, now()
    );
  `);
  const evidenceSource = {
    async list() {
      return [{
        evidenceId: "gmail:message-1",
        sourceType: "gmail" as const,
        sourceId: "message-1",
        occurredAt: new Date("2025-05-14T12:00:00Z"),
        direction: "inbound" as const,
        responseProven: true,
        organizationId,
        contactId: null,
        recipientEmail,
        excerpt: "Thanks",
        conflicting: false,
      }];
    },
  };
  return { client, service: new LeadReviewService(drizzle(client, { schema }) as never, evidenceSource) };
}

describe("LeadReviewService relationship classification", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("persists the deterministic classification and increments the review version", async () => {
    const { client, service } = await setup(); clients.push(client);
    await expect(service.classifyRelationship({
      rowId, expectedVersion: 1, reviewedBy: "Desiree", now: anchor,
    })).resolves.toMatchObject({
      rowId,
      reviewVersion: 2,
      outcome: "returning_contact",
      cutoffDate: "2023-08-25",
      evidenceIds: ["gmail:message-1"],
      reviewRequired: false,
    });

    expect((await client.query(`
      select relationship_outcome, relationship_cutoff_date::text,
             relationship_evidence_ids, relationship_classified_by, review_version
        from lead_import_rows where id = '${rowId}'
    `)).rows).toEqual([{
      relationship_outcome: "returning_contact",
      relationship_cutoff_date: "2023-08-25",
      relationship_evidence_ids: ["gmail:message-1"],
      relationship_classified_by: "Desiree",
      review_version: 2,
    }]);
  }, 15_000);

  it("is idempotent for the same row inputs, anchor, and evidence", async () => {
    const { client, service } = await setup(); clients.push(client);
    await service.classifyRelationship({ rowId, expectedVersion: 1, reviewedBy: "Desiree", now: anchor });
    await expect(service.classifyRelationship({ rowId, expectedVersion: 2, reviewedBy: "Desiree", now: anchor }))
      .resolves.toMatchObject({ reviewVersion: 2, outcome: "returning_contact" });
  }, 15_000);

  it("rejects stale versions and rows without completed recipient verification", async () => {
    const first = await setup(); clients.push(first.client);
    await expect(first.service.classifyRelationship({ rowId, expectedVersion: 0, reviewedBy: "Desiree", now: anchor }))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT" });

    const second = await setup("needs_review"); clients.push(second.client);
    await expect(second.service.classifyRelationship({ rowId, expectedVersion: 1, reviewedBy: "Desiree", now: anchor }))
      .rejects.toMatchObject({ code: "RELATIONSHIP_NOT_READY" });
  }, 20_000);

  it("loads external relationship evidence before opening the row-lock transaction", async () => {
    const { client } = await setup(); clients.push(client);
    const base = drizzle(client, { schema }) as never as Record<PropertyKey, unknown>;
    let transactionStarted = false;
    const database = new Proxy(base, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property === "transaction" && typeof value === "function") {
          return async (...args: unknown[]) => {
            transactionStarted = true;
            return value.apply(target, args);
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const service = new LeadReviewService(database as never, {
      async list() {
        expect(transactionStarted).toBe(false);
        return [];
      },
    });

    await expect(service.classifyRelationship({
      rowId, expectedVersion: 1, reviewedBy: "Desiree", now: anchor,
    })).resolves.toMatchObject({ outcome: "new_introduction", reviewVersion: 2 });
    expect(transactionStarted).toBe(true);
  }, 15_000);

  it("returns bounded display details only for evidence persisted on the classification", async () => {
    const { client, service } = await setup(); clients.push(client);
    await service.classifyRelationship({ rowId, expectedVersion: 1, reviewedBy: "Desiree", now: anchor });

    await expect(service.listRelationshipEvidence({ rowId })).resolves.toEqual([{
      evidenceId: "gmail:message-1",
      sourceType: "gmail",
      occurredAt: new Date("2025-05-14T12:00:00Z"),
      direction: "inbound",
      responseProven: true,
      excerpt: "Thanks",
      conflicting: false,
    }]);
  }, 15_000);
});
