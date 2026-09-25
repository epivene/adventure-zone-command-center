import { afterEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { productionReads } from "./production-reads";
import { createReadTools } from "./read-tools";
import { emptySelection } from "./contracts";
let db: PGlite;
afterEach(async () => {
  if (db) await db.close();
});
it("reads the selected current profile and active contacts without loading historical bodies", async () => {
  db = new PGlite();
  const id = "11111111-1111-4111-8111-111111111111";
  await db.exec(`CREATE TABLE organizations(id uuid PRIMARY KEY,name text,updated_at timestamptz,consolidated_into_id uuid);
  CREATE TABLE contacts(id uuid PRIMARY KEY,email text);
  CREATE TABLE organization_contacts(organization_id uuid,contact_id uuid,active boolean);
  INSERT INTO organizations VALUES('${id}','BBQ Days',now(),null);
  INSERT INTO contacts VALUES('22222222-2222-4222-8222-222222222222','current@example.com'),('33333333-3333-4333-8333-333333333333','inactive@example.com');
  INSERT INTO organization_contacts VALUES('${id}','22222222-2222-4222-8222-222222222222',true),('${id}','33333333-3333-4333-8333-333333333333',false);`);
  const tools = createReadTools({
    ownerId: "owner",
    ...productionReads(db as any, "owner", {} as any),
  });
  const context = {
    actor: { id: "owner", role: "owner" as const, connectionId: null },
    conversationId: "c",
    runId: "r",
    selection: { ...emptySelection(), organizationIds: [id] },
    grants: [],
    signal: new AbortController().signal,
  };
  const call = {
    id: "profile",
    name: "read_profile",
    arguments: JSON.stringify({ organizationId: id }),
  };
  const out = await tools.execute(context, call);
  expect(out.status).toBe("ok");
  expect(out.data).toMatchObject({
    organization: { id, name: "BBQ Days" },
    contacts: [{ email: "current@example.com" }],
    historyIncluded: false,
  });
  expect(out.evidence[0].complete).toBe(false);
  expect(JSON.stringify(out)).not.toContain("inactive@example.com");
  const denied = await tools.execute(
    { ...context, actor: { ...context.actor, id: "other" } },
    call,
  );
  expect(denied.code).toBe("ASSISTANT_ACCESS_DENIED");
  const unselected = await tools.execute(
    { ...context, selection: emptySelection() },
    call,
  );
  expect(unselected.code).toBe("ASSISTANT_TARGET_NOT_IN_BATCH");
});
