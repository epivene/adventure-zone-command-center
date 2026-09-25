import { afterAll, beforeAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { productionReads } from "./production-reads";
import { createReadTools } from "./read-tools";
import { emptySelection, type RunContext } from "./contracts";

let db: PGlite;
let tools: ReturnType<typeof createReadTools>;
const id = (n: number) =>
  `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const context: RunContext = {
  actor: { id: "owner", role: "owner", connectionId: null },
  conversationId: "conversation",
  runId: "run",
  selection: emptySelection(),
  grants: [],
  signal: new AbortController().signal,
};
const search = (args: Record<string, unknown>, c = context) =>
  tools.execute(c, {
    id: "search",
    name: "search_profiles",
    arguments: JSON.stringify(args),
  });

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE organizations(id uuid PRIMARY KEY,name text,city text,region text,updated_at timestamptz,consolidated_into_id uuid);
    CREATE TABLE contacts(id uuid PRIMARY KEY,first_name text,last_name text,email text,phone text,city text,region text);
    CREATE TABLE organization_contacts(organization_id uuid,contact_id uuid,active boolean);
    CREATE TABLE bookings(id uuid,organization_id uuid,name text,status text,starts_at timestamptz,created_at timestamptz);
    CREATE TABLE organization_locations(organization_id uuid,label text,venue_name text,act_source_label text);
    CREATE TABLE event_families(id uuid,name text,normalized_name text,description text);
    CREATE TABLE event_family_members(organization_id uuid,family_id uuid);
    CREATE TABLE booking_package_selections(booking_id uuid,package_template_id uuid);
    CREATE TABLE package_templates(id uuid,name text);
    CREATE TABLE follow_ups(organization_id uuid,completed_at timestamptz,due_at timestamptz);
    CREATE TABLE activities(id uuid,organization_id uuid,kind text,subject text,body text,occurred_at timestamptz,timeline_sort_at timestamptz,source_type text,deleted_at timestamptz);
    INSERT INTO organizations VALUES
      ('${id(1)}','Caldwell Family Fun Day','Caldwell','ID',now(),null),
      ('${id(2)}','4th of July Celebration (Caldwell)','Caldwell','ID',now(),null),
      ('${id(3)}','Caldwell Past Contact Only','Caldwell','ID',now(),null),
      ('${id(4)}','Caldwell Retired Duplicate','Caldwell','ID',now(),'${id(1)}'),
      ('${id(5)}','Caldwell Contact Without Email','Caldwell','ID',now(),null);
    INSERT INTO contacts VALUES
      ('${id(101)}','Caldwell Event','Contact','active@example.com',null,null,null),
      ('${id(102)}','Former','Coordinator','old@example.com',null,null,null),
      ('${id(103)}','Current','Coordinator',null,null,null,null);
    INSERT INTO organization_contacts VALUES
      ('${id(1)}','${id(101)}',true),
      ('${id(3)}','${id(102)}',false),
      ('${id(5)}','${id(103)}',true);
    INSERT INTO activities VALUES
      ('${id(201)}','${id(1)}','note','Prior outreach','Already emailed this event',now(),now(),'note',null),
      ('${id(202)}','${id(2)}','note','Prior outreach','Called last year, contact no longer listed',now(),now(),'note',null);
    INSERT INTO organizations
      SELECT ('22222222-2222-4222-8222-' || lpad(n::text,12,'0'))::uuid,
        'Paging Fair ' || lpad(n::text,2,'0'),null,null,now(),null
      FROM generate_series(1,23) n;
    INSERT INTO bookings VALUES('${id(301)}','${id(1)}','Autumn Showcase',null,null,now());
    INSERT INTO organization_locations VALUES('${id(1)}','Downtown Venue',null,null);
    INSERT INTO event_families VALUES('${id(401)}','Regional Festival Series','regional festival series',null);
    INSERT INTO event_family_members VALUES('${id(1)}','${id(401)}');
  `);
  tools = createReadTools({
    ownerId: "owner",
    ...productionReads(db as any, "owner", {} as any),
  });
});
afterAll(async () => {
  await db?.close();
});

it("finds profiles with no active linked contact without mistaking blank email or inactive links", async () => {
  const out = await search({
    query: "Caldwell",
    contactStatus: "missing",
    offset: null,
  });
  expect(out.status).toBe("ok");
  expect(out.data).toMatchObject({
    complete: true,
    nextOffset: null,
    historyIncluded: false,
  });
  expect(
    (out.data as any).profiles.map((p: any) => [
      p.organizationId,
      p.activeContactCount,
    ]),
  ).toEqual([
    [id(2), 0],
    [id(3), 0],
  ]);
});

it("returns canonical profile IDs and measured contact counts for a contact-name search", async () => {
  const out = await search({ query: "Caldwell Event Contact" });
  expect(out.status).toBe("ok");
  expect(out.data).toMatchObject({
    profiles: [
      {
        id: id(1),
        organizationId: id(1),
        kind: "organization",
        label: "Caldwell Family Fun Day",
        activeContactCount: 1,
      },
    ],
    historyIncluded: false,
  });
  const profile = (out.data as any).profiles[0];
  expect(profile).not.toHaveProperty("lastContactAt");
  expect(profile).not.toHaveProperty("bookingCount");
  const selected = {
    ...context,
    selection: {
      ...emptySelection(),
      organizationIds: [profile.organizationId],
    },
  };
  const verified = await tools.execute(selected, {
    id: "verify",
    name: "read_profile",
    arguments: JSON.stringify({ organizationId: profile.organizationId }),
  });
  expect(verified.status).toBe("ok");
  expect((verified.data as any).contacts).toHaveLength(1);
});

it("keeps lack of a current contact separate from recorded outreach history", async () => {
  const out = await search({
    query: "4th of July",
    contactStatus: "missing",
    offset: null,
  });
  expect((out.data as any).profiles).toMatchObject([
    { organizationId: id(2), activeContactCount: 0 },
  ]);
  expect((out.data as any).historyIncluded).toBe(false);
  const history = await tools.execute(context, {
    id: "history",
    name: "read_profile_history",
    arguments: JSON.stringify({ organizationId: id(2), offset: null }),
  });
  expect(history.status).toBe("ok");
  expect((history.data as any).activities[0].body).toBe(
    "Called last year, contact no longer listed",
  );
});

it("browses and paginates real missing-contact matches with no guessed search keyword", async () => {
  const first = await search({
    query: null,
    contactStatus: "missing",
    offset: null,
  });
  expect(first.status).toBe("partial");
  expect(first.data).toMatchObject({ complete: false, nextOffset: 20 });
  expect((first.data as any).profiles).toHaveLength(20);
  const second = await search({
    query: null,
    contactStatus: "missing",
    offset: 20,
  });
  expect(second.status).toBe("ok");
  expect(second.data).toMatchObject({ complete: true, nextOffset: null });
  expect((second.data as any).profiles).toHaveLength(5);
  const ids = [
    ...(first.data as any).profiles,
    ...(second.data as any).profiles,
  ].map((p: any) => p.id);
  expect(new Set(ids).size).toBe(25);
  expect(ids).not.toContain(id(4));
});

it.each(["Autumn Showcase", "Downtown Venue", "Regional Festival Series"])(
  "preserves owning-profile lookup for %s",
  async (query) => {
    const out = await search({ query, contactStatus: "present", offset: 0 });
    expect(out.status).toBe("ok");
    expect((out.data as any).profiles).toMatchObject([
      { organizationId: id(1), activeContactCount: 1 },
    ]);
  },
);

it("rejects malformed filters and denies profile search to other actors", async () => {
  expect(
    (
      await search({
        query: null,
        contactStatus: "never_contacted",
        offset: null,
      })
    ).code,
  ).toBe("ASSISTANT_ARGUMENTS_INVALID");
  expect(
    (await search({ query: null, contactStatus: "missing", offset: -1 })).code,
  ).toBe("ASSISTANT_ARGUMENTS_INVALID");
  expect(
    (
      await search(
        { query: null, contactStatus: "missing", offset: null },
        { ...context, actor: { ...context.actor, id: "other" } },
      )
    ).code,
  ).toBe("ASSISTANT_ACCESS_DENIED");
});
