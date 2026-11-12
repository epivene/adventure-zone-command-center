import { beforeEach, afterEach, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { EventDateCorrectionService, eventDateCorrectionTools } from "./event-date-correction";
import type { ConnectionPrincipal } from "./contracts";

let db: PGlite, service: EventDateCorrectionService, p: ConnectionPrincipal;
let profileId: string, oldId: string, candidateId: string;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE organizations(id uuid PRIMARY KEY, name text, consolidated_into_id uuid, updated_at timestamptz DEFAULT now());
    CREATE TABLE chatgpt_connections(id uuid PRIMARY KEY, owner_id text, client_id text, scopes jsonb, revoked_at timestamptz, last_used_at timestamptz);
    CREATE TABLE chatgpt_operations(id uuid PRIMARY KEY, connection_id uuid, operation text, request_key text, input_hash text, receipt jsonb, UNIQUE(connection_id,operation,request_key));
    CREATE TABLE audit_entries(id uuid DEFAULT gen_random_uuid(), entity_type text, entity_id uuid, action text, "before" jsonb, "after" jsonb);
    CREATE TABLE activities(id uuid PRIMARY KEY, organization_id uuid, kind text, subject text, body text, occurred_at timestamptz, timeline_sort_at timestamptz);
    CREATE TABLE bookings(id uuid PRIMARY KEY, starts_on date, ends_on date);
    CREATE TABLE followups(id uuid PRIMARY KEY, due_at timestamptz);
  `);
  await db.exec(readFileSync(new URL("../../../../../lib/db/migrations/20260921_event_date_coverage.sql", import.meta.url), "utf8"));
  profileId = randomUUID(); oldId = randomUUID(); candidateId = randomUUID();
  p = { ownerId: "owner", connectionId: randomUUID(), clientId: "client", scopes: ["crm:read", "crm:update"] };
  await db.query("INSERT INTO chatgpt_connections(id,owner_id,client_id,scopes) VALUES($1,$2,$3,$4)", [p.connectionId,p.ownerId,p.clientId,JSON.stringify(p.scopes)]);
  await db.query("INSERT INTO organizations(id,name) VALUES($1,'Eastern Montana Fair (Miles City)')", [profileId]);
  await db.query(`INSERT INTO event_date_facts(id,organization_id,starts_on,ends_on,status,rationale,source_kind,source_title,source_url,verified_at,active)
    VALUES($1,$2,'2027-08-18','2027-08-21','confirmed','Original contract','web','Original email','https://mail.google.com/#all/old',now(),true),
    ($3,$2,'2027-08-25','2027-08-28','needs_review','Corrected contract, access August 23–29','web','Corrected email','https://mail.google.com/#all/corrected',now(),false)`, [oldId,profileId,candidateId]);
  service = new EventDateCorrectionService(db);
});
afterEach(async () => { await db.close(); });
const input = () => ({ profileId, candidateId });
const consent = { confirmedCorrection: true as const, source: "current_owner_message" as const, instruction: "Replace Miles City August 18–21 with August 25–28, 2027." };
async function correction() {
  const preview = await service.preview(p, input());
  return { ...input(), expectedRevision: preview.expectedRevision, reason: "Owner confirmed the corrected contract dates.", authorization: consent };
}

it("previews both date ranges without changing the active fact", async () => {
  const preview = await service.preview(p, input());
  expect(preview).toMatchObject({profileId, candidate:{id:candidateId,starts_on:"2027-08-25",ends_on:"2027-08-28"},activeFacts:[{id:oldId,starts_on:"2027-08-18",ends_on:"2027-08-21"}]});
  expect(preview.expectedRevision).toMatch(/^[a-f0-9]{64}$/);
  expect((await db.query("SELECT id FROM event_date_facts WHERE active")).rows).toEqual([{id:oldId}]);
  expect((await db.query("SELECT * FROM chatgpt_operations")).rows).toHaveLength(0);
});

it("promotes the exact reviewed correction, preserves source/history and leaves operational records alone", async () => {
  await db.query("INSERT INTO bookings VALUES($1,'2027-08-23','2027-08-29')", [randomUUID()]);
  await db.query("INSERT INTO followups VALUES($1,'2026-11-16T16:00:00Z')", [randomUUID()]);
  const operational = await db.query("SELECT to_jsonb(b) AS row FROM bookings b UNION ALL SELECT to_jsonb(f) FROM followups f");
  const args = await correction();
  const receipt = await service.apply(p, {requestKey:"miles-city"}, args);
  const rows = (await db.query("SELECT id,active,status,starts_on::text,ends_on::text,superseded_by_id,source_url FROM event_date_facts ORDER BY active")).rows;
  expect(rows).toEqual([
    {id:oldId,active:false,status:"confirmed",starts_on:"2027-08-18",ends_on:"2027-08-21",superseded_by_id:candidateId,source_url:"https://mail.google.com/#all/old"},
    {id:candidateId,active:true,status:"confirmed",starts_on:"2027-08-25",ends_on:"2027-08-28",superseded_by_id:null,source_url:"https://mail.google.com/#all/corrected"},
  ]);
  expect(receipt.value).toMatchObject({profileId,factId:candidateId,startsOn:"2027-08-25",endsOn:"2027-08-28",supersededFactIds:[oldId]});
  expect((await db.query("SELECT to_jsonb(b) AS row FROM bookings b UNION ALL SELECT to_jsonb(f) FROM followups f")).rows).toEqual(operational.rows);
  const audit = (await db.query('SELECT "before","after" FROM audit_entries')).rows[0];
  expect(audit.before.activeFacts[0].starts_on).toBe("2027-08-18");
  expect(audit.after.authorization).toEqual(consent);
  expect((await db.query("SELECT body FROM activities")).rows[0].body).toContain("2027-08-25");
  expect((await service.apply(p,{requestKey:"miles-city"},args)).operationId).toBe(receipt.operationId);
  expect((await db.query("SELECT * FROM audit_entries")).rows).toHaveLength(1);
  await expect(service.apply(p,{requestKey:"miles-city"},{...args,reason:"Different input"})).rejects.toMatchObject({code:"CONNECTION_REQUEST_CONFLICT"});
});

it.each(["active", "candidate"])("rejects a stale preview after the %s fact changes", async which => {
  const args = await correction();
  await db.query("UPDATE event_date_facts SET rationale='New evidence' WHERE id=$1", [which === "active" ? oldId : candidateId]);
  await expect(service.apply(p,{requestKey:"stale"},args)).rejects.toMatchObject({code:"CONNECTION_STALE_REVISION"});
  expect((await db.query("SELECT id FROM event_date_facts WHERE active")).rows).toEqual([{id:oldId}]);
});

it("rejects another profile's candidate and consolidated profiles", async () => {
  await expect(service.preview(p,{profileId,candidateId:randomUUID()})).rejects.toMatchObject({code:"CONNECTION_DATE_FACT_UNAVAILABLE"});
  const other = randomUUID();
  await db.query("INSERT INTO organizations(id,name) VALUES($1,'Another fair')",[other]);
  await expect(service.preview(p,{profileId:other,candidateId})).rejects.toMatchObject({code:"CONNECTION_DATE_FACT_UNAVAILABLE"});
  await db.query("UPDATE organizations SET consolidated_into_id=$1 WHERE id=$2",[other,profileId]);
  await expect(service.preview(p,input())).rejects.toMatchObject({code:"CONNECTION_PROFILE_UNAVAILABLE"});
});

it("requires read and update scope, current connection and explicit owner correction authorization", async () => {
  const args = await correction();
  await expect(service.apply({...p,scopes:["crm:read"]},{requestKey:"scope"},args)).rejects.toMatchObject({code:"CONNECTION_ACCESS_DENIED"});
  await expect(service.apply({...p,scopes:["crm:update"]},{requestKey:"read"},args)).rejects.toMatchObject({code:"CONNECTION_ACCESS_DENIED"});
  await expect(service.apply(p,{requestKey:"no-owner"},{...args,authorization:{...consent,confirmedCorrection:false}} as any)).rejects.toThrow();
  await expect(service.apply(p,{requestKey:"background"},{...args,authorization:{...consent,source:"automation"}} as any)).rejects.toThrow();
  await expect(service.preview({...p,ownerId:"someone-else"},input())).rejects.toMatchObject({code:"CONNECTION_ACCESS_DENIED"});
  await db.query("UPDATE chatgpt_connections SET revoked_at=now()");
  await expect(service.apply(p,{requestKey:"revoked"},args)).rejects.toMatchObject({code:"CONNECTION_REVOKED"});
});

it.each(["verified_at=NULL", "source_url=NULL", "superseded_by_id=id", "status='expected'"])("cannot confirm a candidate with %s", async change => {
  await db.query(`UPDATE event_date_facts SET ${change} WHERE id=$1`,[candidateId]);
  await expect(service.preview(p,input())).rejects.toMatchObject({code:"CONNECTION_DATE_CORRECTION_NOT_REVIEWABLE"});
});

it("rolls back dates and note if audit storage fails", async () => {
  const args = await correction();
  await db.exec("ALTER TABLE audit_entries ADD CONSTRAINT fail_audit CHECK (action <> 'update')");
  await expect(service.apply(p,{requestKey:"rollback"},args)).rejects.toThrow();
  expect((await db.query("SELECT id FROM event_date_facts WHERE active")).rows).toEqual([{id:oldId}]);
  for (const table of ["activities","chatgpt_operations"]) expect((await db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0);
});

it("exposes the correction as a write and enforces validation on direct tool calls", async () => {
  const tools = eventDateCorrectionTools(service,p);
  const preview = tools.find(t=>t.name === "preview_event_date_correction")!;
  const apply = tools.find(t=>t.name === "apply_event_date_correction")!;
  expect(preview.readOnly).toBe(true);
  expect(apply).toMatchObject({readOnly:false,scope:"crm:update"});
  const reviewed = await preview.call(input());
  const result = await apply.call({...input(),expectedRevision:reviewed.expectedRevision,reason:"Owner confirmed corrected dates",authorization:consent,requestKey:"tool"});
  expect(result.value.startsOn).toBe("2027-08-25");
});
