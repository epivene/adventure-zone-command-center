import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { PaperNotePhoneService } from "./paper-note-phone-service";

const organizationId = "10000000-0000-4000-8000-000000000001";
const contactId = "20000000-0000-4000-8000-000000000001";
const entryId = "30000000-0000-4000-8000-000000000001";

function rowValue(rows: unknown[], index: number, key: string): unknown {
  const row = rows[index];
  return row && typeof row === "object" && !Array.isArray(row) && key in row
    ? (row as Record<string, unknown>)[key]
    : undefined;
}

async function harness() {
  const client = new PGlite();
  await client.exec(`
    create table organizations (
      id uuid primary key,
      phone text,
      normalized_phone text,
      updated_at timestamptz not null default now()
    );
    create table organization_locations (
      id uuid primary key,
      organization_id uuid not null references organizations(id)
    );
    create table contacts (
      id uuid primary key,
      phone text,
      normalized_phone text,
      updated_at timestamptz not null default now()
    );
    create table contact_phones (
      id uuid primary key default gen_random_uuid(),
      contact_id uuid not null references contacts(id),
      number text not null,
      normalized_number text,
      type text not null default 'unknown',
      extension text,
      label text,
      instructions text,
      status text not null default 'active',
      primary boolean not null default false,
      source text not null default 'local',
      source_paper_note_entry_id uuid,
      do_not_call_at timestamptz,
      do_not_call_reason text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index contact_phones_contact_normalized_number_unique
      on contact_phones(contact_id, normalized_number)
      where normalized_number is not null;
    create table organization_phones (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organizations(id),
      organization_location_id uuid references organization_locations(id),
      number text not null,
      normalized_number text,
      type text not null default 'unknown',
      extension text,
      normalized_extension text,
      label text,
      instructions text,
      status text not null default 'active',
      primary boolean not null default false,
      source text not null default 'local',
      source_paper_note_entry_id uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
  await client.query(`insert into organizations(id) values($1)`, [organizationId]);
  await client.query(`insert into contacts(id) values($1)`, [contactId]);
  const db = drizzle(client);
  return { client, db, service: new PaperNotePhoneService() };
}

describe("PaperNotePhoneService", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("adds a contact phone with a separate extension and provenance", async () => {
    const { client, db, service } = await harness();
    clients.push(client);
    const result = await service.apply(db as never, {
      owner: { kind: "contact", contactId },
      decision: "add_alternate",
      paper: {
        number: "208-555-0142",
        extension: "3115",
        type: "office",
        label: "fair office",
        instructions: "Ask for events",
        status: "active",
      },
      existingPhoneId: null,
      sourcePaperNoteEntryId: entryId,
    }, new Date("2026-08-20T18:00:00Z"));

    expect(result.action).toBe("added_alternate");
    const rows = (await client.query(`select number, extension, instructions, source, source_paper_note_entry_id from contact_phones`)).rows;
    expect(rows).toEqual([{
      number: "208-555-0142",
      extension: "3115",
      instructions: "Ask for events",
      source: "paper_note",
      source_paper_note_entry_id: entryId,
    }]);
  });

  it("treats an already-saved normalized contact phone as already present", async () => {
    const { client, db, service } = await harness();
    clients.push(client);
    const inserted = await client.query(
      `insert into contact_phones(contact_id, number, normalized_number, type, label, status, primary, source)
       values($1, '435-890-6349', '+14358906349', 'office', 'saved label', 'active', false, 'local')
       returning id`,
      [contactId],
    );
    const savedId = String(rowValue(inserted.rows, 0, "id"));

    const result = await service.apply(db as never, {
      owner: { kind: "contact", contactId },
      decision: "add_alternate",
      paper: {
        number: "(435) 890-6349",
        extension: null,
        type: "mobile",
        label: "paper label",
        instructions: "paper instructions",
        status: "active",
      },
      existingPhoneId: null,
      sourcePaperNoteEntryId: entryId,
    }, new Date("2026-08-22T19:47:46Z"));

    expect(result).toEqual({ phoneId: savedId, action: "already_present" });
    expect((await client.query(`select id, type, label, source, source_paper_note_entry_id from contact_phones where contact_id = $1`, [contactId])).rows).toEqual([{
      id: savedId,
      type: "office",
      label: "saved label",
      source: "local",
      source_paper_note_entry_id: null,
    }]);
  });

  it("replaces primary only when explicitly selected and syncs the legacy field", async () => {
    const { client, db, service } = await harness();
    clients.push(client);
    await client.query(`insert into contact_phones(contact_id, number, normalized_number, primary) values($1, '701-555-0100', '+17015550100', true)`, [contactId]);

    await service.apply(db as never, {
      owner: { kind: "contact", contactId },
      decision: "replace_primary",
      paper: { number: "208-555-0142", extension: null, type: "mobile", label: null, instructions: null, status: "active" },
      existingPhoneId: null,
      sourcePaperNoteEntryId: entryId,
    }, new Date());

    expect((await client.query(`select number from contact_phones where primary = true`)).rows).toEqual([{ number: "208-555-0142" }]);
    expect((await client.query(`select phone, normalized_phone from contacts where id = $1`, [contactId])).rows).toEqual([{ phone: "208-555-0142", normalized_phone: "+12085550142" }]);
  });

  it("inactivates an old number without ever touching Do Not Call", async () => {
    const { client, db, service } = await harness();
    clients.push(client);
    const inserted = await client.query(`insert into contact_phones(contact_id, number, normalized_number, primary) values($1, '701-555-0100', '+17015550100', true) returning id`, [contactId]);
    const oldId = String(rowValue(inserted.rows, 0, "id"));

    await service.apply(db as never, {
      owner: { kind: "contact", contactId },
      decision: "inactivate_saved_add_paper",
      paper: { number: "208-555-0142", extension: null, type: "office", label: null, instructions: null, status: "active" },
      existingPhoneId: oldId,
      sourcePaperNoteEntryId: entryId,
    }, new Date());

    expect((await client.query(`select status, do_not_call_at from contact_phones where id = $1`, [oldId])).rows).toEqual([{ status: "inactive", do_not_call_at: null }]);
  });

  it("writes nothing for ignore or crossed-out note-only decisions", async () => {
    const { client, db, service } = await harness();
    clients.push(client);
    for (const decision of ["ignore_paper", "crossed_out_note_only"] as const) {
      await service.apply(db as never, {
        owner: { kind: "organization", organizationId, organizationLocationId: null },
        decision,
        paper: { number: "208-555-0142", extension: "3115", type: "office", label: null, instructions: null, status: "questionable" },
        existingPhoneId: null,
        sourcePaperNoteEntryId: entryId,
      }, new Date());
    }
    expect((await client.query(`select count(*)::int as count from organization_phones`)).rows).toEqual([{ count: 0 }]);
  });
});
