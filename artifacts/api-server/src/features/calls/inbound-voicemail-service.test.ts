import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  contacts,
  contactPhones,
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
    create table contact_phones (
      id uuid primary key,
      contact_id uuid not null,
      normalized_number text
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
    insert into contact_phones (id, contact_id, normalized_number)
      values ('${PHONE_ID}', '${CONTACT_ID}', '+13035550101');
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
    schema: { contacts, contactPhones, inboundCallSessions, inboundVoicemails },
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

  it("recovers a unique stored-phone match for an older unmatched session", async () => {
    await client.exec(`
      update inbound_call_sessions
      set organization_id = null, contact_id = null, phone_id = null
      where id = '${SESSION_ID}'
    `);

    const result = await service.list("owner");

    expect(result.items[0]).toEqual(expect.objectContaining({
      callerDisplay: "Avery Lee",
      matched: true,
      organizationId: ORGANIZATION_ID,
      contactId: CONTACT_ID,
      phoneId: PHONE_ID,
      canLink: false,
    }));
  });

  it("does not guess when a caller number belongs to more than one contact", async () => {
    await client.exec(`
      update inbound_call_sessions
      set organization_id = null, contact_id = null, phone_id = null
      where id = '${SESSION_ID}';
      insert into contacts (id, organization_id, first_name, last_name)
        values ('60000000-0000-4000-8000-000000000001', null, 'Another', 'Caller');
      insert into contact_phones (id, contact_id, normalized_number)
        values (
          '70000000-0000-4000-8000-000000000001',
          '60000000-0000-4000-8000-000000000001',
          '+13035550101'
        );
    `);

    const result = await service.list("owner");

    expect(result.items[0]).toEqual(expect.objectContaining({
      matched: false,
      organizationId: null,
      contactId: null,
      phoneId: null,
      canLink: true,
    }));
  });

  it("returns only new messages for the new filter while keeping both badge counts", async () => {
    await client.exec(`
      insert into inbound_call_sessions (
        id, owner_id, caller_number_snapshot, organization_id, contact_id, phone_id
      ) values (
        '80000000-0000-4000-8000-000000000001', 'owner', '+13035550101',
        '${ORGANIZATION_ID}', '${CONTACT_ID}', '${PHONE_ID}'
      );
      insert into inbound_voicemails (
        id, inbound_session_id, recording_sid, status, duration_seconds,
        deletion_attempts, created_at, updated_at
      ) values (
        '90000000-0000-4000-8000-000000000001',
        '80000000-0000-4000-8000-000000000001', 'RE456', 'handled', 8,
        0, '2026-09-03T18:05:00Z', '2026-09-03T18:05:00Z'
      );
    `);

    const result = await (service.list as any)("owner", undefined, "new");

    expect(result.items.map(({ id }: { id: string }) => id)).toEqual([VOICEMAIL_ID]);
    expect(result.newCount).toBe(1);
    expect(result.handledCount).toBe(1);
  });
});
