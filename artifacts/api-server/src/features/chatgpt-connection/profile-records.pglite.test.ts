import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as main from "@workspace/db/schema";
import * as documents from "../../../../../lib/db/src/business-document-schema";
import * as invoices from "../../../../../lib/db/src/invoice-schema";
import * as families from "../../../../../lib/db/src/event-family-schema";
import * as paper from "../../../../../lib/db/src/paper-note-schema";
import * as attendance from "../../../../../lib/db/src/event-attendance-history-schema";
import * as promos from "../../../../../lib/db/src/early-bird-promo-schema";
import * as dates from "../../../../../lib/db/src/event-date-coverage-schema";
import { fixture } from "./test-database";
import { ensureChatGPTConnectionSchema } from "../../db/chatgpt-connection-schema";
import { ProfileUpdateService } from "./profile-update-service";
import { ConnectionReadService } from "./read-service";
import { connectionTools } from "./tool-registry";
import { recordSources } from "./profile-record-sources";
let f: Awaited<ReturnType<typeof fixture>>, reads: ConnectionReadService, updates: ProfileUpdateService;
const source = { url: "https://countyfair.example/about", retrievedAt: "2026-10-07T16:00:00Z", eventYear: null, claim: "Official fair contact and profile information.", verification: "verified" as const };
const tables = [
  main.organizations, main.contacts, main.contactPhones, main.organizationLocations,
  main.bookings, main.activities, main.eventManagerReviews, main.contractDrafts,
  main.contractVersions, main.contractFiles, main.contractStatusEvents, main.contractCoiDrafts,
  main.followUps, main.auditEntries, invoices.invoices, invoices.invoicePayments,
  families.eventFamilies, families.eventFamilyMembers, families.scopedNotes,
  paper.organizationPhones, paper.paperNoteEntries, attendance.eventAttendanceHistory,
  promos.earlyBirdPromoEnrollments, documents.businessDocuments, documents.businessDocumentLinks,
  documents.businessDocumentReviewItems, documents.businessDocumentAuditEvents, dates.eventDateFacts,
];
beforeEach(async () => {
  f = await fixture();
  for (const table of tables) {
    const cfg = getTableConfig(table);
    await f.db.exec('DROP TABLE IF EXISTS "' + cfg.name + '" CASCADE');
    const cols = cfg.columns.map(c => '"' + c.name + '" ' + ("enumValues" in c && c.enumValues ? "text" : c.getSQLType()) +
      (c.name === "id" ? " PRIMARY KEY DEFAULT gen_random_uuid()" : ""));
    await f.db.exec('CREATE TABLE "' + cfg.name + '" (' + cols.join(",") + ')');
  }
  await ensureChatGPTConnectionSchema(f.db);
  await f.db.query("INSERT INTO organizations(id,name,city,region,website,description,updated_at,created_at) VALUES($1,'County Fair','Town','UT',NULL,'Prior facts and source links.',now(),now())", [f.profileId]);
  reads = new ConnectionReadService(f.db); updates = new ProfileUpdateService(f.db);
});
afterEach(async () => f.db.close());
async function save(values: Record<string, unknown>, extra: Record<string, unknown> = {}, requestKey = "profile-save") {
  const details = await reads.details(f.principal, {profileId: f.profileId});
  return updates.save(f.principal, {requestKey}, {profileId:f.profileId, expectedRevision:details.expectedRevision, values, reason:"Owner-authorized profile correction.", sources:[source], ...extra});
}
it("reads About and saves an existing website replacement without per-profile approval, preserving exact prior values", async () => {
  await f.db.query("UPDATE organizations SET website='https://old.example/' WHERE id=$1", [f.profileId]);
  expect(await reads.details(f.principal, {profileId:f.profileId})).toMatchObject({about:"Prior facts and source links.", aboutTruncated:false});
  const result = await save({website:"https://countyfair.example/",about:"Prior facts and source links. Shortened wording."});
  expect(result.value).toMatchObject({website:"https://countyfair.example/",changed:true});
  const audit = (await f.db.query('SELECT "before","after" FROM audit_entries WHERE entity_id=$1', [f.profileId])).rows[0] as any;
  expect(audit.before).toEqual({website:"https://old.example/",about:"Prior facts and source links."});
  expect(audit.after.sources).toEqual([source]);
  expect(audit.after.values.about).toContain("Prior facts");
  expect((await f.db.query("SELECT count(*)::int AS n FROM chatgpt_update_proposals")).rows[0].n).toBe(0);
});
it("saves authorized name/address/deadline/deal preference and normalizes phone", async () => {
  const result = await save({name:"County Fair & Festival", phone:"(307) 555-0123", address1:"123 Main St",applicationDeadline:"2027-04-01",recommendedDealModel:"either"});
  expect(result.value).toMatchObject({name:"County Fair & Festival",phone:"(307) 555-0123",applicationDeadline:"2027-04-01",recommendedDealModel:"either"});
  expect((await f.db.query("SELECT normalized_phone FROM organizations WHERE id=$1", [f.profileId])).rows[0].normalized_phone).toBeTruthy();
});
it("blocks null/blank clearing, invalid URLs/dates and unknown fields without changing data", async () => {
  for (const values of [{about:null},{about:" "},{phone:""},{website:"javascript:alert(1)"},{applicationDeadline:"2027-02-30"},{status:"confirmed"},{contactId:randomUUID()}]) {
    await expect(save(values)).rejects.toBeDefined();
  }
  expect((await f.db.query("SELECT count(*)::int AS n FROM audit_entries")).rows[0].n).toBe(0);
  expect((await reads.details(f.principal,{profileId:f.profileId})).about).toBe("Prior facts and source links.");
});
it("rejects stale revision, revoked grants and missing edit scope", async () => {
  const details = await reads.details(f.principal,{profileId:f.profileId});
  await f.db.query("UPDATE organizations SET updated_at=clock_timestamp() + interval '1 second' WHERE id=$1", [f.profileId]);
  await expect(save({city:"New Town"}, {expectedRevision:details.expectedRevision})).rejects.toMatchObject({code:"CONNECTION_STALE_REVISION"});
  const input={profileId:f.profileId,expectedRevision:(await reads.details(f.principal,{profileId:f.profileId})).expectedRevision,values:{city:"New Town"},reason:"Owner-authorized correction.",sources:[source]};
  await expect(updates.save({...f.principal,scopes:["crm:read"]},{requestKey:"missing"},input)).rejects.toMatchObject({code:"CONNECTION_ACCESS_DENIED"});
  await f.db.query("UPDATE chatgpt_connections SET revoked_at=now() WHERE id=$1", [f.principal.connectionId]);
  await expect(updates.save(f.principal,{requestKey:"revoked"},input)).rejects.toBeDefined();
  expect((await f.db.query("SELECT count(*)::int AS n FROM audit_entries")).rows[0].n).toBe(0);
});
it("uses idempotent receipts and rejects request-key reuse with different values", async () => {
  const expectedRevision=(await reads.details(f.principal,{profileId:f.profileId})).expectedRevision;
  const input={profileId:f.profileId,expectedRevision,values:{about:"Prior facts and source links. Concise."},reason:"Owner-authorized cleanup.",sources:[source]};
  const first=await updates.save(f.principal,{requestKey:"retry"},input);
  expect(await updates.save(f.principal,{requestKey:"retry"},input)).toEqual(first);
  await expect(updates.save(f.principal,{requestKey:"retry"},{...input,values:{about:"Changed."}})).rejects.toBeDefined();
  expect((await f.db.query("SELECT count(*)::int AS n FROM audit_entries")).rows[0].n).toBe(1);
});
it("requires supplied verified factual evidence and a matching website source", async () => {
  await expect(save({website:"https://wrong.example/"})).rejects.toMatchObject({code:"CONNECTION_WEBSITE_SOURCE_MISMATCH"});
  await expect(save({city:"New Town"},{sources:[{...source,verification:"unverified"}]})).rejects.toMatchObject({code:"CONNECTION_VERIFIED_SOURCE_REQUIRED"});
});
it("returns all legacy About text through chunked records but never issues an edit revision for truncated details", async () => {
  const about="Prior facts ".repeat(1000);
  await f.db.query("UPDATE organizations SET description=$2 WHERE id=$1",[f.profileId,about]);
  expect(await reads.details(f.principal,{profileId:f.profileId})).toMatchObject({aboutTruncated:true,expectedRevision:null});
  let cursor: string | undefined, text="", expectedRevision: string | null = null;
  do {
    const page:any=await reads.record(f.principal,{section:"profiles",recordId:f.profileId,cursor});
    text+=page.text; cursor=page.nextCursor ?? undefined; expectedRevision=page.expectedRevision;
  } while(cursor);
  expect(JSON.parse(text).description).toBe(about);
  expect(expectedRevision).toBeTruthy();
  await save({about:"Prior facts retained in concise wording."},{expectedRevision});
  const audit:any=(await f.db.query('SELECT "before" FROM audit_entries WHERE entity_id=$1',[f.profileId])).rows[0];
  expect(audit.before.about).toBe(about);
});
it("pages full activity content, rejects changed records and preserves profile isolation", async () => {
  const id=randomUUID(),other=randomUUID(),body="Saved long email body. ".repeat(1000);
  await f.db.query("INSERT INTO activities(id,organization_id,kind,body,occurred_at,timeline_sort_at,updated_at) VALUES($1,$2,'email_out',$3,now(),now(),now())",[id,f.profileId,body]);
  const page:any=await reads.record(f.principal,{profileId:f.profileId,section:"activities",recordId:id});
  expect(page.truncated).toBe(true); expect(page.nextCursor).toBeTruthy();
  const second:any=await reads.record(f.principal,{profileId:f.profileId,section:"activities",recordId:id,cursor:page.nextCursor});
  expect(second.offset).toBe(8000);
  await f.db.query("UPDATE activities SET body='Changed source' WHERE id=$1",[id]);
  await expect(reads.record(f.principal,{profileId:f.profileId,section:"activities",recordId:id,cursor:page.nextCursor})).rejects.toMatchObject({code:"CONNECTION_RECORD_CHANGED"});
  await f.db.query("INSERT INTO organizations(id,name,updated_at) VALUES($1,'Other Fair',now())",[other]);
  await expect(reads.record(f.principal,{profileId:other,section:"activities",recordId:id})).rejects.toMatchObject({code:"CONNECTION_RECORD_UNAVAILABLE"});
});
it("runs static source projections against production column definitions", async () => {
  const available = new Set(tables.map(t=>getTableConfig(t).name));
  for(const [section,source] of Object.entries(recordSources)) {
    if(!available.has(source.table))continue;
    const page:any=await reads.records(f.principal,{section});
    expect(page.availability,section).toBe("available");
  }
});
it("distinguishes unavailable sources from an empty saved section and never exposes credentials/storage keys", async () => {
  const page:any=await reads.records(f.principal,{section:"email_messages"});
  expect(page).toMatchObject({availability:"unavailable",complete:false});
  expect(JSON.stringify(recordSources)).not.toMatch(/encrypted_refresh_token|password_hash|storage_key|storage_object_key/);
  await expect(reads.records(f.principal,{section:"google_workspace_connections"})).rejects.toBeDefined();
});
it("exposes read-only full record tools and standing-edit saves with strict schemas", async () => {
  const tools=connectionTools({reads,updates} as any,f.principal);
  for(const name of ["read_profile_details","list_app_records","read_app_record"])
    expect(tools.find(t=>t.name===name)).toMatchObject({scope:"crm:read",readOnly:true});
  const saveTool=tools.find(t=>t.name==="save_profile_update")!;
  expect(saveTool).toMatchObject({scope:"crm:update",readOnly:false});
  expect(saveTool.schema.safeParse({profileId:f.profileId,expectedRevision:"revision",values:{about:"Facts"},reason:"Cleanup",sources:[source],requestKey:"save",approvalId:randomUUID()}).success).toBe(false);
});
