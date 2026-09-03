import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  contacts,
  inboundCallSessions,
  inboundVoicemails,
} from "@/db/schema";
import { InboundVoicemailService } from "./inbound-voicemail-service";

const SESSION_ID = "10000000-0000-4000-8000-000000000001";
const VOICEMAIL_ID = "20000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "30000000-0000-4000-8000-000000000001";
const CONTACT_ID = "40000000-0000-4000-8000-000000000001";
const PHONE_ID = "50000000-0000-4000-8000-000000000001";

let client: PGlite;
let service: InboundVoicemailService;

beforeEach(async () => {
  client = new PGlite();
  await client.exec(`
    create table contacts (
      id uuid primary key,
      organization_id uuid,
      first_name text not null,
      last_name text not null
    );
    create table inbound_call_sessions (
      id uuid primary key,
      owner_id text not null,
      caller_number_snapshot text,
      organization_id uuid,
      contact_id uuid,
      phone_id uuid
    );
    create table inbound_voicemails (
      id uuid primary key,
      inbound_session_id uuid not null unique,
      recording_sid text unique,
      status text not null,
      duration_seconds integer,
      content_type text,
      retention_deadline timestamptz,
      handled_at timestamptz,
      handled_by text,
      organization_id uuid,
      contact_id uuid,
      phone_id uuid,
      deletion_attempted_at timestamptz,
      deletion_lease_expires_at timestamptz,
      deletion_attempts integer not null,
      deletion_error text,
      call_session_id uuid unique,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );
    insert into contacts (id, organization_id, first_name, last_name)
      values ('${CONTACT_ID}', '${ORGANIZATION_ID}', 'Avery', 'Lee');
    insert into inbound_call_sessions (
      id, owner_id, caller_number_snapshot, organization_id, contact_id, phone_id
    ) values (
      '${SESSION_ID}', 'owner', '+13035550101', '${ORGANIZATION_ID}', '${CONTACT_ID}', '${PHONE_ID}'
    );
    insert into inbound_voicemails (
      id, inbound_session_id, recording_sid, status, duration_seconds,
      deletion_attempts, created_at, updated_at
    ) values (
      '${VOICEMAIL_ID}', '${SESSION_ID}', 'RE123', 'available', 4,
      0, '2026-09-03T18:00:00Z', '2026-09-03T18:00:00Z'
    );
  `);
  const database = drizzle(client, {
    schema: { contacts, inboundCallSessions, inboundVoicemails },
  });
  service = new InboundVoicemailService(database as never, () => ({
    getRecordingMedia: vi.fn(),
  }) as never);
});

afterEach(async () => {
  await client.close();
});

describe("InboundVoicemailService", () => {
  it("keeps the matched caller identity from the inbound call session", async () => {
    const result = await service.list("owner");

    expect(result.items).toEqual([
      expect.objectContaining({
        id: VOICEMAIL_ID,
        callerDisplay: "Avery Lee",
        matched: true,
        organizationId: ORGANIZATION_ID,
        contactId: CONTACT_ID,
        phoneId: PHONE_ID,
        canLink: false,
      }),
    ]);
  });
});
