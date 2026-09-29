import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { serializeProfileBrief, loadProfileBrief } from "./profile-brief";
import { emptySelection } from "./contracts";
it("bounds the brief and explicitly marks it partial", () => {
  const brief = serializeProfileBrief({
    identity: "Fair",
    primaryContact: "Jamie",
    nextFollowUp: "Email tomorrow",
    recentActivity: ["x".repeat(20000)],
  });
  expect(brief.length).toBeLessThanOrEqual(4000);
  expect(brief).toContain("Partial profile brief");
  expect(brief).toContain("omitted");
  expect(brief).toContain("Email tomorrow");
});
it("does not eagerly read profiles for general or batch conversations", async () => {
  const db = {
    query: async () => {
      throw Error("unexpected read");
    },
  };
  const base = {
    actor: { id: "owner", role: "owner" as const, connectionId: null },
    conversationId: "c",
    runId: "r",
    grants: [],
    signal: new AbortController().signal,
  };
  expect(
    await loadProfileBrief(db, { ...base, selection: emptySelection() }),
  ).toEqual([]);
  expect(
    await loadProfileBrief(db, {
      ...base,
      selection: { ...emptySelection(), organizationIds: ["a", "b"] },
    }),
  ).toEqual([]);
});

it("reads a fresh bounded brief with source IDs and excludes another profile", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE organizations(id uuid primary key,name text,city text,region text,updated_at timestamptz,consolidated_into_id uuid);
 CREATE TABLE contacts(id uuid primary key,first_name text,last_name text,email text,phone text);
 CREATE TABLE organization_contacts(organization_id uuid,contact_id uuid,active boolean,is_primary boolean);
 CREATE TABLE follow_ups(id uuid,organization_id uuid,kind text,due_at timestamptz,completed_at timestamptz);
 CREATE TABLE activities(id uuid,organization_id uuid,kind text,body text,occurred_at timestamptz,timeline_sort_at timestamptz,deleted_at timestamptz);`);
    const id = "11111111-1111-4111-8111-111111111111";
    await db.query(
      "INSERT INTO organizations VALUES($1,'County Fair','Denver','CO',now(),null)",
      [id],
    );
    await db.query(
      "INSERT INTO activities SELECT gen_random_uuid(),$1,'note',repeat('Large history ',10000),now(),now(),null FROM generate_series(1,50)",
      [id],
    );
    const context = {
      actor: { id: "owner", role: "owner" as const, connectionId: null },
      conversationId: "c",
      runId: "r",
      grants: [],
      signal: new AbortController().signal,
      selection: { ...emptySelection(), organizationIds: [id] },
    };
    const [brief] = await loadProfileBrief(db, context);
    expect(brief.recordId).toBe(id);
    expect(brief.complete).toBe(false);
    expect(brief.text.length).toBeLessThanOrEqual(4000);
    await db.query("UPDATE organizations SET name='Updated fair' WHERE id=$1", [
      id,
    ]);
    const [fresh] = await loadProfileBrief(db, context);
    expect(fresh.text).toContain("Updated fair");
    expect(fresh.version).not.toBe(brief.version);
    await db.query(
      "UPDATE organizations SET consolidated_into_id=$1 WHERE id=$1",
      [id],
    );
    await expect(loadProfileBrief(db, context)).rejects.toThrow(
      "ASSISTANT_PROFILE_NOT_FOUND",
    );
  } finally {
    await db.close();
  }
});
