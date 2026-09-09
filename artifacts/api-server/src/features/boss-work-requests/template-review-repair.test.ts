import { readFileSync, existsSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { PGlite } from "@electric-sql/pglite";

// Execute the route's actual schemas without booting the production DB/server.
const route = readFileSync(new URL("../../routes/communication-templates.ts", import.meta.url), "utf8");
const schemas = runInNewContext(
  route.slice(route.indexOf("export const communicationTemplateWriteSchema"), route.indexOf("const previewSchema"))
    .replace("export const", "const")
    + ";({ write: communicationTemplateWriteSchema, patch: communicationTemplatePatchSchema })",
  { z, placeholderSchema: z.enum(["contactName"]) },
);
const migrationUrl = new URL("../../../../../lib/db/migrations/20260909d_template_review_repair.sql", import.meta.url);
// Before the migration exists this deliberately runs against the unrepaired schema.
const repairSql = existsSync(migrationUrl) ? readFileSync(migrationUrl, "utf8") : "SELECT 1";
let db: PGlite;
let databaseOpen = false;
afterEach(async () => {
  if (databaseOpen) {
    databaseOpen = false;
    await db.close();
  }
});

async function fixture() {
  db = new PGlite();
  databaseOpen = true;
  await db.exec(`CREATE TABLE boss_accounts(id uuid PRIMARY KEY);
    CREATE TABLE organizations(id uuid PRIMARY KEY);
    CREATE TABLE contacts(id uuid PRIMARY KEY);
    CREATE TABLE follow_ups(id uuid PRIMARY KEY);
    CREATE TABLE communication_templates(id uuid PRIMARY KEY, code text, category text,
      template_version text, owner_kind text, state text, subject_template text,
      body_template text, updated_at timestamptz DEFAULT now());`);
  await db.exec(readFileSync(new URL("../../../../../lib/db/migrations/20260909b_boss_work_requests.sql", import.meta.url), "utf8"));
  const boss = randomUUID(), template = randomUUID();
  await db.query("INSERT INTO boss_accounts VALUES ($1)", [boss]);
  await db.query(`INSERT INTO communication_templates
    (id,code,category,template_version,owner_kind,state,subject_template,body_template,body_format)
    VALUES ($1,'convention_before_general_v2','convention_campaign','2026-09-gmail-final-v2','company','draft','Hello','<div>Code copy</div>','plain_text')`, [template]);
  return { boss, template };
}
async function review(template: string, boss: string, format: string, body: string, state = "waiting_on_dave", decision = "pending", dedupe: string | null = null) {
  const request = randomUUID();
  await db.query(`INSERT INTO boss_work_requests(id,type,state,title,assigned_boss_account_id,deduplication_key)
    VALUES ($1,'email_template_approval',$2,'Review',$3,$4)`, [request,state,boss,dedupe]);
  await db.query(`INSERT INTO communication_template_reviews
    (request_id,template_id,template_version,content_fingerprint,subject_snapshot,body_snapshot,body_format_snapshot,decision)
    VALUES ($1,$2,'2026-09-gmail-final-v2',$3,'Hello',$4,$5,$6)`, [request,template,randomUUID(),body,format,decision]);
  return request;
}
async function state(id: string) {
  return (await db.query<{state:string}>("SELECT state FROM boss_work_requests WHERE id=$1", [id])).rows[0].state;
}

describe("template review regression", () => {
  it("the registered migration marker becomes ready only after successful cleanup installation", async () => {
    await fixture();
    const source=readFileSync(new URL("../../../../../lib/db/src/migrations.ts",import.meta.url),"utf8");
    const registry=runInNewContext(source.slice(source.indexOf("const migrationFiles ="),source.indexOf("async function resolveMigrationDirectory"))
      .replace("as const;",";")+"migrationFiles");
    const registered=registry.find((item: {name:string})=>item.name==="20260909d_template_review_repair.sql");
    expect(registered).toBeDefined();
    expect((await db.query(registered.markerSql)).rows[0].ready).toBe(false);
    await db.exec(repairSql);
    expect((await db.query(registered.markerSql)).rows[0].ready).toBe(true);
  });
  it("a body-only edit does not downgrade existing HTML or accept an empty patch", () => {
    const changes = schemas.patch.parse({bodyTemplate:"<div>Updated</div>"});
    expect({...{bodyFormat:"html"}, ...changes}.bodyFormat).toBe("html");
    expect(schemas.patch.safeParse({}).success).toBe(false);
    expect(schemas.patch.parse({bodyFormat:"plain_text"}).bodyFormat).toBe("plain_text");
    expect(schemas.patch.parse({bodyFormat:"html"}).bodyFormat).toBe("html");
  });
  it("restores the good HTML review, closes only its pending duplicate, and is repeat-safe", async () => {
    const {boss,template}=await fixture();
    const good=await review(template,boss,"html","<div>Good design</div>");
    const bad=await review(template,boss,"plain_text","<div>Code copy</div>");
    const completed=await review(template,boss,"html","Approved design","approved","approved");
    await db.exec(repairSql);
    const saved=(await db.query("SELECT body_format,body_template FROM communication_templates WHERE id=$1",[template])).rows[0];
    expect(saved).toEqual({body_format:"html",body_template:"<div>Good design</div>"});
    expect(await state(good)).toBe("waiting_on_dave");
    expect(await state(bad)).toBe("cancelled");
    expect(await state(completed)).toBe("approved");
    const before=(await db.query("SELECT * FROM boss_work_request_events")).rows;
    expect(before).toHaveLength(1);
    await db.exec(repairSql);
    expect((await db.query("SELECT * FROM boss_work_request_events")).rows).toEqual(before);
  });
  it("leaves unsnapshotted user edits unchanged", async () => {
    const {boss,template}=await fixture();
    const good=await review(template,boss,"html","<div>Old</div>");
    const bad=await review(template,boss,"plain_text","<div>Code copy</div>");
    await db.query("UPDATE communication_templates SET body_template='<div>New unsent edit</div>' WHERE id=$1",[template]);
    await db.exec(repairSql);
    expect(await state(good)).toBe("waiting_on_dave");
    expect(await state(bad)).toBe("waiting_on_dave");
    expect((await db.query("SELECT body_template FROM communication_templates")).rows[0].body_template).toBe("<div>New unsent edit</div>");
  });
  it("does not repair other template categories or codes", async () => {
    const {boss,template}=await fixture();
    const good=await review(template,boss,"html","<div>Old</div>");
    const bad=await review(template,boss,"plain_text","<div>Code copy</div>");
    await db.query("UPDATE communication_templates SET code='unrelated_template' WHERE id=$1",[template]);
    await db.exec(repairSql);
    expect(await state(good)).toBe("waiting_on_dave");
    expect(await state(bad)).toBe("waiting_on_dave");
    expect((await db.query("SELECT body_format FROM communication_templates")).rows[0].body_format).toBe("plain_text");
  });
  it("does not overwrite an edit arriving between candidate selection and repair", async () => {
    const {boss,template}=await fixture();
    const good=await review(template,boss,"html","<div>Old</div>");
    const bad=await review(template,boss,"plain_text","<div>Code copy</div>");
    // Stage a competing edit at the migration's two-statement boundary.
    const boundary=repairSql.indexOf("-- Apply only candidates");
    expect(boundary).toBeGreaterThan(0);
    await db.exec(repairSql.slice(0,boundary));
    await db.query("UPDATE communication_templates SET body_template='<div>New unsent edit</div>' WHERE id=$1",[template]);
    await db.exec(repairSql.slice(boundary));
    expect(await state(good)).toBe("waiting_on_dave");
    expect(await state(bad)).toBe("waiting_on_dave");
    expect((await db.query("SELECT body_template FROM communication_templates")).rows[0].body_template).toBe("<div>New unsent edit</div>");
  });
  it("reduces all seven campaign pairs from fourteen open cards to seven without deleting snapshots", async () => {
    const {boss,template}=await fixture();
    const codes=["convention_before_general_v2","convention_before_new_event_v2","convention_before_past_event_v2",
      "convention_during_new_event_v2","convention_during_past_event_v2","convention_after_new_event_v2","convention_after_past_event_v2"];
    for(let i=0;i<codes.length;i++) {
      const id=i===0?template:randomUUID();
      if(i>0) await db.query(`INSERT INTO communication_templates
        (id,code,category,template_version,owner_kind,state,subject_template,body_template,body_format)
        VALUES ($1,$2,'convention_campaign','2026-09-gmail-final-v2','company','draft','Hello','<div>Code copy</div>','plain_text')`,[id,codes[i]]);
      await review(id,boss,"html",`<div>Good design ${i}</div>`);
      await review(id,boss,"plain_text","<div>Code copy</div>");
    }
    await db.exec(repairSql);
    expect((await db.query("SELECT count(*)::int AS n FROM boss_work_requests WHERE state='waiting_on_dave'")).rows[0].n).toBe(7);
    expect((await db.query("SELECT count(*)::int AS n FROM communication_template_reviews")).rows[0].n).toBe(14);
    expect((await db.query("SELECT count(*)::int AS n FROM communication_templates WHERE body_format='html'")).rows[0].n).toBe(7);
  });
  it("allows submitting a reverted revision again without reviving old decisions", async () => {
    const {boss,template}=await fixture();
    await db.exec(repairSql);
    const first=await review(template,boss,"html","<div>First</div>","waiting_on_dave","pending","fingerprint:first");
    const second=await review(template,boss,"html","<div>Second</div>","waiting_on_dave","pending","fingerprint:second");
    const reverted=await review(template,boss,"html","<div>First</div>","waiting_on_dave","pending","fingerprint:first");
    expect(await state(first)).toBe("cancelled");
    expect(await state(second)).toBe("cancelled");
    expect(await state(reverted)).toBe("waiting_on_dave");
    expect((await db.query("SELECT count(*)::int AS n FROM communication_template_reviews")).rows[0].n).toBe(3);
  });
  it("rolls back supersession if the new review transaction fails", async () => {
    const {boss,template}=await fixture();
    await db.exec(repairSql);
    const first=await review(template,boss,"html","<div>First</div>");
    await db.exec("BEGIN");
    await review(template,boss,"html","<div>Second</div>");
    await db.exec("ROLLBACK");
    expect(await state(first)).toBe("waiting_on_dave");
    expect((await db.query("SELECT * FROM boss_work_request_events")).rows).toHaveLength(0);
  });
  it("a new review supersedes only pending reviews for the same template and boss", async () => {
    const {boss,template}=await fixture();
    const old=await review(template,boss,"html","<div>Old</div>");
    const otherBoss=randomUUID();
    await db.query("INSERT INTO boss_accounts VALUES ($1)",[otherBoss]);
    const other=await review(template,otherBoss,"html","<div>Other boss</div>");
    const decided=await review(template,boss,"html","<div>Decision</div>","changes_requested","changes_requested");
    await db.exec(repairSql);
    const latest=await review(template,boss,"html","<div>Latest</div>");
    expect(await state(old)).toBe("cancelled");
    expect(await state(latest)).toBe("waiting_on_dave");
    expect(await state(other)).toBe("waiting_on_dave");
    expect(await state(decided)).toBe("changes_requested");
  });
});
