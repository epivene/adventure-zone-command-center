import { afterEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { productionReads } from "./production-reads";
import { createReadTools } from "./read-tools";
import { emptySelection } from "./contracts";
let db: PGlite;
afterEach(async () => {
  if (db) await db.close();
});
it("pages through approved template metadata then reads exactly one current body", async () => {
  db = new PGlite();
  await db.exec(`CREATE TABLE communication_templates(id uuid PRIMARY KEY, code text, name text, template_version text, subject_template text, body_template text, body_format text, required_placeholders jsonb, reviewed_at timestamptz, state text);
  INSERT INTO communication_templates SELECT ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'template-'||n,'Template '||lpad(n::text,3,'0'),'v1','The Adventure Zone',repeat('<p>PRIVATE_HTML_BODY</p>',1000),'html','[]',now(),'active' FROM generate_series(1,26)n;
  INSERT INTO communication_templates VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','not-reviewed','Not reviewed','v1','subject','secret unapproved','html','[]',NULL,'active');`);
  const reads = productionReads(db as any, "owner", {} as any);
  const tools = createReadTools({ ownerId: "owner", ...reads });
  const context = {
    actor: { id: "owner", role: "owner" as const, connectionId: null },
    conversationId: "c",
    runId: "r",
    selection: emptySelection(),
    grants: [],
    signal: new AbortController().signal,
  };
  const first = await tools.execute(context, {
    id: "catalog",
    name: "read_templates",
    arguments: '{"offset":0}',
  });
  expect(first.status).toBe("partial");
  const legacy = await tools.execute(context, {
    id: "legacy",
    name: "read_templates",
    arguments: "{}",
  });
  expect(legacy.data).toEqual(first.data);
  expect(first.data).toMatchObject({ nextOffset: 25, complete: false });
  expect(JSON.stringify(first)).not.toContain("PRIVATE_HTML_BODY");
  const page = await tools.execute(context, {
    id: "page",
    name: "read_templates",
    arguments: '{"offset":25}',
  });
  expect(page.data).toMatchObject({ nextOffset: null, complete: true });
  const selected = await tools.execute(context, {
    id: "body",
    name: "read_template",
    arguments: '{"templateId":"00000000-0000-4000-8000-000000000001"}',
  });
  expect(selected.status).toBe("ok");
  expect(selected.data).toMatchObject({
    template_version: "v1",
    body_template: expect.stringContaining("PRIVATE_HTML_BODY"),
  });
  const unapproved = await tools.execute(context, {
    id: "bad",
    name: "read_template",
    arguments: '{"templateId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',
  });
  expect(unapproved.status).toBe("blocked");
  expect(JSON.stringify(unapproved)).not.toContain("secret unapproved");
});
