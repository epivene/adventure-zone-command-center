import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { LeadRelationshipEvidenceRepository } from "./lead-relationship-evidence-repository";

const organizationId = "10000000-0000-4000-8000-000000000001";
const recipientEmail = "director@example.org";

async function setup() {
  const client = new PGlite();
  await client.exec(`
    create table activities (
      id uuid primary key, organization_id uuid, contact_id uuid, subject text,
      body text not null, occurred_at timestamptz, timeline_sort_at timestamptz not null,
      act_record_id text, source_record_id uuid, source_version_id uuid,
      source_type text, deleted_at timestamptz
    );
    create table act_source_records (
      id uuid primary key, stream_type text not null, latest_version_id uuid
    );
    create table act_source_record_versions (
      id uuid primary key, source_record_id uuid not null, raw_snapshot jsonb not null,
      source_created_at timestamptz, source_edited_at timestamptz, fetched_at timestamptz not null
    );
    create table act_source_assignments (
      id uuid primary key, source_record_id uuid not null, target_entity_type text not null,
      target_entity_id uuid not null, superseded_at timestamptz
    );
    create table google_workspace_connections (
      id uuid primary key, status text not null, updated_at timestamptz not null
    );
    create table google_workspace_validation_state (
      connection_id uuid primary key, validation_status text not null
    );
    create table google_workspace_validation_mappings (
      connection_id uuid not null, message_id text not null, thread_id text not null,
      organization_id uuid not null, contact_id uuid, evidence_codes jsonb not null,
      updated_at timestamptz not null
    );
    insert into google_workspace_connections(id, status, updated_at)
      values ('50000000-0000-4000-8000-000000000001', 'connected', now());
  `);
  return client;
}

function googleClient(messages: Record<string, {
  from: string;
  to: string;
  cc?: string;
  at: string;
  snippet?: string;
}>) {
  return {
    async accountIdentity() {
      return { subject: "mailbox", email: "sales@adventurezone.example" };
    },
    async getMessageMetadata(id: string) {
      const message = messages[id];
      if (!message) throw new Error("missing fixture");
      return {
        id,
        threadId: `thread-${id}`,
        labelIds: [],
        internalDateMs: new Date(message.at).valueOf(),
        snippet: message.snippet ?? "Thanks for reaching out",
        headers: {
          from: message.from,
          to: message.to,
          cc: message.cc ?? "",
          subject: "Festival",
          date: message.at,
        },
        hasAttachments: false,
      };
    },
  } as never;
}

async function seedAct(client: PGlite, input: {
  suffix: string;
  raw: Record<string, unknown>;
  body: string;
  occurredAt: string;
}) {
  const sourceId = `20000000-0000-4000-8000-${input.suffix.padStart(12, "0")}`;
  const versionId = `30000000-0000-4000-8000-${input.suffix.padStart(12, "0")}`;
  const assignmentId = `40000000-0000-4000-8000-${input.suffix.padStart(12, "0")}`;
  await client.query(
    `insert into act_source_records(id, stream_type, latest_version_id) values ($1, 'history', $2)`,
    [sourceId, versionId],
  );
  await client.query(
    `insert into act_source_record_versions(id, source_record_id, raw_snapshot, fetched_at)
       values ($1, $2, $3, $4)`,
    [versionId, sourceId, input.raw, input.occurredAt],
  );
  await client.query(
    `insert into act_source_assignments(id, source_record_id, target_entity_type, target_entity_id)
       values ($1, $2, 'organization', $3)`,
    [assignmentId, sourceId, organizationId],
  );
}

describe("LeadRelationshipEvidenceRepository", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("proves only structured ACT inbound history, never free-text notes", async () => {
    const client = await setup(); clients.push(client);
    await seedAct(client, {
      suffix: "1",
      raw: { Direction: "Inbound", From: recipientEmail, Details: "They replied" },
      body: "They replied",
      occurredAt: "2025-05-14T12:00:00Z",
    });
    await seedAct(client, {
      suffix: "2",
      raw: { Details: "talked to them" },
      body: "talked to them",
      occurredAt: "2025-05-15T12:00:00Z",
    });

    const evidence = await new LeadRelationshipEvidenceRepository(drizzle(client) as never)
      .list({ organizationId, recipientEmail });

    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: "act", direction: "inbound", responseProven: true, conflicting: false }),
      expect.objectContaining({ sourceType: "act", direction: "unknown", responseProven: false }),
    ]));
  }, 15_000);

  it("derives Gmail direction from mailbox identity and verified participants", async () => {
    const client = await setup(); clients.push(client);
    await client.exec(`
      insert into google_workspace_validation_state(connection_id, validation_status)
        values ('50000000-0000-4000-8000-000000000001', 'approved');
      insert into google_workspace_validation_mappings
        (connection_id, message_id, thread_id, organization_id, contact_id, evidence_codes, updated_at)
        values
        ('50000000-0000-4000-8000-000000000001', 'gmail-in', 'thread-in', '${organizationId}', null, '[]', now()),
        ('50000000-0000-4000-8000-000000000001', 'gmail-out', 'thread-out', '${organizationId}', null, '[]', now()),
        ('50000000-0000-4000-8000-000000000001', 'gmail-wrong', 'thread-wrong', '${organizationId}', null, '[]', now());
    `);
    const repository = new LeadRelationshipEvidenceRepository(drizzle(client) as never, googleClient({
      "gmail-in": { from: `Festival Director <${recipientEmail}>`, to: "Adventure Zone <sales@adventurezone.example>", at: "2025-05-14T12:00:00Z" },
      "gmail-out": { from: "Adventure Zone <sales@adventurezone.example>", to: recipientEmail, at: "2025-05-13T12:00:00Z" },
      "gmail-wrong": { from: "someone-else@example.org", to: "sales@adventurezone.example", at: "2025-05-12T12:00:00Z" },
    }));

    const evidence = await repository.list({ organizationId, recipientEmail });
    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: "gmail-in", direction: "inbound", responseProven: true, conflicting: false }),
      expect.objectContaining({ sourceId: "gmail-out", direction: "outbound", responseProven: false, conflicting: false }),
      expect.objectContaining({ sourceId: "gmail-wrong", direction: "unknown", responseProven: false, conflicting: true }),
    ]));
  });

  it("excludes mappings until the Google validation sample is approved", async () => {
    const client = await setup(); clients.push(client);
    await client.exec(`
      insert into google_workspace_validation_state(connection_id, validation_status)
        values ('50000000-0000-4000-8000-000000000001', 'ready_for_review');
      insert into google_workspace_validation_mappings
        (connection_id, message_id, thread_id, organization_id, contact_id, evidence_codes, updated_at)
        values ('50000000-0000-4000-8000-000000000001', 'pending', 'thread-pending', '${organizationId}', null, '[]', now());
    `);
    const repository = new LeadRelationshipEvidenceRepository(drizzle(client) as never, googleClient({
      pending: { from: recipientEmail, to: "sales@adventurezone.example", at: "2025-05-14T12:00:00Z" },
    }));
    await expect(repository.list({ organizationId, recipientEmail })).resolves.toEqual([]);
  });

  it("keeps CRM activity with a stable ACT source id as context, not proof of a reply", async () => {
    const client = await setup(); clients.push(client);
    await client.exec(`
      insert into activities
        (id, organization_id, body, occurred_at, timeline_sort_at, act_record_id, source_type)
      values
        ('60000000-0000-4000-8000-000000000001', '${organizationId}',
         E'talked to them\\nplease follow up', '2025-05-10T12:00:00Z',
         '2025-05-10T12:00:00Z', 'act-history-42', 'history');
    `);

    const evidence = await new LeadRelationshipEvidenceRepository(drizzle(client) as never)
      .list({ organizationId, recipientEmail });

    expect(evidence).toEqual([
      expect.objectContaining({
        sourceType: "crm",
        sourceId: "act-history-42",
        direction: "unknown",
        responseProven: false,
        excerpt: "talked to them please follow up",
      }),
    ]);
  });

  it("collapses ACT and Gmail observations carrying the same Gmail message id", async () => {
    const client = await setup(); clients.push(client);
    await seedAct(client, {
      suffix: "3",
      raw: { Direction: "Inbound", From: recipientEmail, GmailMessageId: "gmail-shared", Details: "Thanks" },
      body: "Thanks",
      occurredAt: "2025-05-14T12:00:00Z",
    });
    await client.exec(`
      insert into google_workspace_validation_state(connection_id, validation_status)
        values ('50000000-0000-4000-8000-000000000001', 'approved');
      insert into google_workspace_validation_mappings
        (connection_id, message_id, thread_id, organization_id, contact_id, evidence_codes, updated_at)
        values ('50000000-0000-4000-8000-000000000001', 'gmail-shared', 'thread-shared', '${organizationId}', null, '[]', now());
    `);
    const repository = new LeadRelationshipEvidenceRepository(drizzle(client) as never, googleClient({
      "gmail-shared": { from: recipientEmail, to: "sales@adventurezone.example", at: "2025-05-14T12:00:00Z" },
    }));

    const evidence = await repository.list({ organizationId, recipientEmail });
    expect(evidence.filter((item) => item.sourceType === "gmail" && item.sourceId === "gmail-shared"))
      .toHaveLength(1);
  });
});
