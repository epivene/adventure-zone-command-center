import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "./test-database";
import { BatchProfileContextService } from "./batch-profile-context";
import { ConnectionReadService } from "./read-service";

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => { f = await fixture(); });
afterEach(async () => { await f.db.close(); });
const read = (input: unknown) => new BatchProfileContextService(f.db).read(f.principal, input);

it("requires the active connection and crm:read even for a mixed batch", async () => {
  const input = {profileIds: [f.profileId, randomUUID()], eventYear: null, sections: ["contacts"]};
  await expect(new BatchProfileContextService(f.db).read({...f.principal, scopes: []}, input))
    .rejects.toMatchObject({code: "CONNECTION_ACCESS_DENIED"});
  await f.db.query("UPDATE chatgpt_connections SET revoked_at=now() WHERE id=$1", [f.principal.connectionId]);
  await expect(read(input)).rejects.toMatchObject({code: "CONNECTION_REVOKED"});
});

it("keeps individual failures separate and matches the single-profile page", async () => {
  const other = randomUUID(), missing = randomUUID();
  await f.db.query("INSERT INTO organizations(id,name) VALUES($1,'Other')", [other]);
  await f.db.query("INSERT INTO activities(organization_id,kind,subject,body,occurred_at,timeline_sort_at) VALUES($1,'note','Call','Existing terms',now(),now())", [f.profileId]);
  const batch = await read({profileIds:[f.profileId,missing,other], eventYear:2027, sections:["history","followups"]});
  const single = await new ConnectionReadService(f.db).context(f.principal,
    {profileId:f.profileId,eventYear:2027,section:"history"});
  expect(batch.results[0].sections?.history).toEqual(single.sections.history);
  expect(batch.results[0].sections?.followups).toMatchObject({availability:"available",items:[]});
  expect(batch.results[1].error).toMatchObject({code:"CONNECTION_PROFILE_UNAVAILABLE"});
  expect(batch.results[2].profile).toMatchObject({id:other,name:"Other"});
  expect(JSON.stringify(batch.results[2])).not.toContain("Existing terms");
});

it("rejects oversized and duplicate batches before querying", async () => {
  await expect(read({profileIds:Array.from({length:6},()=>randomUUID()),eventYear:null}))
    .rejects.toMatchObject({code:"CONNECTION_INVALID_BATCH_INPUT"});
  await expect(read({profileIds:[f.profileId,f.profileId],eventYear:null}))
    .rejects.toMatchObject({code:"CONNECTION_INVALID_BATCH_INPUT"});
});

it("paginates independently and rejects a cursor for another profile", async () => {
  await f.db.query("INSERT INTO follow_ups(organization_id,kind,updated_at) SELECT $1,'call',now()+n*interval '1 second' FROM generate_series(1,12) n", [f.profileId]);
  const first = await read({profileIds:[f.profileId],eventYear:null,sections:["followups"]});
  const page = first.results[0].sections!.followups as {items:{id:string}[];nextCursor:string;truncated:boolean};
  expect(page.items).toHaveLength(10);
  expect(page.truncated).toBe(true);
  const second = await read({profileIds:[f.profileId],eventYear:null,sections:["followups"],
    cursors:{[f.profileId]:{followups:page.nextCursor}}});
  const remaining = second.results[0].sections!.followups as {items:{id:string}[];nextCursor:string};
  expect(remaining.items).toHaveLength(2);
  expect(remaining.nextCursor).toBeNull();
  expect(new Set([...page.items,...remaining.items].map(x=>x.id)).size).toBe(12);
  const other = randomUUID();
  await f.db.query("INSERT INTO organizations(id,name) VALUES($1,'Other')",[other]);
  const mismatch = await read({profileIds:[other],eventYear:null,sections:["followups"],cursors:{[other]:{followups:page.nextCursor}}});
  expect(mismatch.results[0].errors?.followups).toMatchObject({code:"CONNECTION_INVALID_CURSOR"});
});

it("reports a stale profile revision and scopes saved draft associations to the connection", async () => {
  const old = (await read({profileIds:[f.profileId],eventYear:null,sections:["drafts"]})).results[0].profile as {revision:string};
  await f.db.query("UPDATE organizations SET updated_at=updated_at+interval '1 second' WHERE id=$1",[f.profileId]);
  const stale = await read({profileIds:[f.profileId],eventYear:null,sections:["drafts"],expectedRevisions:{[f.profileId]:old.revision}});
  expect(stale.results[0].error).toMatchObject({code:"CONNECTION_PROFILE_CHANGED"});
  const ours = randomUUID(), someoneElses = randomUUID();
  const content = JSON.stringify({organizationId:f.profileId,subject:"Saved draft"});
  const otherConnection = randomUUID();
  await f.db.query("INSERT INTO chatgpt_connections(id,owner_id,client_id,scopes) VALUES($1,$2,'other',$3)",
    [otherConnection,f.principal.ownerId,JSON.stringify(f.principal.scopes)]);
  await f.db.query("INSERT INTO chatgpt_external_drafts(id,owner_id,connection_id,content,revision) VALUES($1,$2,$3,$4,$5),($6,$2,$7,$4,$8)",
    [ours,f.principal.ownerId,f.principal.connectionId,content,randomUUID(),someoneElses,otherConnection,randomUUID()]);
  const result = await read({profileIds:[f.profileId],eventYear:null,sections:["drafts"]});
  expect((result.results[0].sections!.drafts as {items:{id:string;revision:string}[]}).items)
    .toEqual([expect.objectContaining({id:ours,revision:expect.any(String)})]);
});

it("bounds concurrent profile work and isolates rate-limited sections without retrying writes", async () => {
  const other = randomUUID();
  await f.db.query("INSERT INTO organizations(id,name) VALUES($1,'Other')",[other]);
  const original = f.db.query.bind(f.db);
  let active = 0, peak = 0, limited = 0;
  const db = {query: async (sql:string, params?:unknown[]) => {
    active++; peak = Math.max(peak, active);
    try {
      if (sql.includes("FROM follow_ups")) { limited++; throw Object.assign(new Error("limited"), {status:429}); }
      return await original(sql,params);
    } finally { active--; }
  }};
  const result = await new BatchProfileContextService(db).read(f.principal,
    {profileIds:[f.profileId,other],eventYear:null,sections:["followups"]});
  expect(peak).toBeLessThanOrEqual(2);
  expect(limited).toBe(2);
  expect(result.results.every(x => x.errors?.followups)).toBe(true);
});
