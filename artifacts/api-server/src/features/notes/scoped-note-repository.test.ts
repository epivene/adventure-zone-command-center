import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eventFamilies, scopedNotes } from "@/db/schema";
import { organizationLocations } from "@/db/schema";
import { ScopedNoteRepository } from "./scoped-note-repository";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOCATION_ID = "11111111-1111-4111-8111-111111111111";
const FAMILY_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_FAMILY_ID = "33333333-3333-4333-8333-333333333333";

let client: PGlite;
let db: ReturnType<typeof drizzle>;
let repo: ScopedNoteRepository;

beforeAll(async () => {
  client = new PGlite();
  await client.exec(`
    create table organizations (id uuid primary key, name text not null);
    create table organization_locations (
      id uuid primary key,
      organization_id uuid not null references organizations(id),
      label text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table event_families (
      id uuid primary key,
      name text not null,
      normalized_name text not null unique,
      description text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table scoped_notes (
      id uuid primary key default gen_random_uuid(),
      organization_location_id uuid references organization_locations(id) on delete restrict,
      event_family_id uuid references event_families(id) on delete restrict,
      body text not null,
      source text not null default 'local',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint scoped_notes_exactly_one_owner check (
        (organization_location_id is not null)::int + (event_family_id is not null)::int = 1
      ),
      constraint scoped_notes_body_nonblank check (nullif(trim(body), '') is not null)
    );
    insert into organizations (id, name) values
      ('${ORG_A}', 'Alpha'), ('${ORG_B}', 'Beta');
    insert into organization_locations (id, organization_id, label) values
      ('${LOCATION_ID}', '${ORG_A}', 'Main grounds');
    insert into event_families (id, name, normalized_name) values
      ('${FAMILY_ID}', 'Fourth of July', 'fourth of july'),
      ('${OTHER_FAMILY_ID}', 'Oktoberfest', 'oktoberfest');
  `);
  db = drizzle(client, { schema: { organizationLocations, eventFamilies, scopedNotes } });
  repo = new ScopedNoteRepository(db as never);
});

afterAll(async () => { await client.close(); });

describe("ScopedNoteRepository", () => {
  it("creates and lists family notes newest first", async () => {
    const first = await repo.create({ kind: "event_family", id: FAMILY_ID }, "Book early", new Date("2026-01-01T12:00:00Z"));
    const second = await repo.create({ kind: "event_family", id: FAMILY_ID }, "Use holiday pitch", new Date("2026-02-01T12:00:00Z"));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const notes = await repo.list({ kind: "event_family", id: FAMILY_ID });
    expect(notes.slice(0, 2).map((note) => note.body)).toEqual(["Use holiday pitch", "Book early"]);
  });

  it("rejects wrong-owner updates without changing the note", async () => {
    const created = await repo.create({ kind: "organization_location", id: LOCATION_ID }, "Load from east gate");
    if (!created.ok) throw new Error("expected note creation");
    const result = await repo.update({ kind: "event_family", id: FAMILY_ID }, created.note.id, "wrong owner");
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    const notes = await repo.list({ kind: "organization_location", id: LOCATION_ID });
    expect(notes.find((note) => note.id === created.note.id)?.body).toBe("Load from east gate");
  });

  it("keeps location notes attached when the location moves organizations", async () => {
    const created = await repo.create({ kind: "organization_location", id: LOCATION_ID }, "Use north lot");
    if (!created.ok) throw new Error("expected note creation");
    await db.update(organizationLocations).set({ organizationId: ORG_B }).where(eq(organizationLocations.id, LOCATION_ID));
    const notes = await repo.list({ kind: "organization_location", id: LOCATION_ID });
    expect(notes).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.note.id, body: "Use north lot" })]));
  });

  it("returns owner-not-found for missing owners", async () => {
    const result = await repo.create({ kind: "event_family", id: "44444444-4444-4444-8444-444444444444" }, "Missing");
    expect(result).toEqual({ ok: false, code: "OWNER_NOT_FOUND" });
  });
});
