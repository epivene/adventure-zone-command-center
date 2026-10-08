import { beforeEach, afterEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "./test-database";
import { ensureEmailThreadAttentionSchema } from "../../db/email-thread-attention-schema";
import { GmailDraftFilingService, type DraftFilingAccess } from "./gmail-draft-filing-service";
import { EmailThreadAttentionService } from "../google-workspace/email-thread-attention-service";
import { connectionTools, type ConnectionServices } from "./tool-registry";
let f: Awaited<ReturnType<typeof fixture>>, service: GmailDraftFilingService;
let account: string, wrong: string, currentAccount: string, thread: string, subject: string;
beforeEach(async () => {
  f = await fixture();
  await ensureEmailThreadAttentionSchema(f.db);
  await f.db.exec(`
    CREATE TABLE google_workspace_connections(id uuid PRIMARY KEY,role text,status text,updated_at timestamptz DEFAULT now());
    CREATE TABLE google_workspace_validation_mappings(connection_id uuid,message_id text,thread_id text,organization_id uuid,contact_id uuid,evidence_codes jsonb,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),PRIMARY KEY(connection_id,message_id));
    CREATE TABLE google_workspace_gmail_thread_intents(connection_id uuid,thread_id text,generation int,intent_kind text,organization_id uuid,current_mutation_id uuid,updated_at timestamptz DEFAULT now(),PRIMARY KEY(connection_id,thread_id));
    CREATE TABLE google_workspace_gmail_mutations(id uuid PRIMARY KEY,connection_id uuid,thread_id text,organization_id uuid,operation text,state text,last_error_code text,next_attempt_at timestamptz,processing_lease_expires_at timestamptz,updated_at timestamptz DEFAULT now());
    CREATE TABLE google_workspace_validation_review_items(connection_id uuid,message_id text,thread_id text,review_state text,resolved_organization_id uuid,reviewed_by text,reviewed_at timestamptz,gmail_sync_state text,gmail_sync_error_code text,gmail_sync_mutation_id uuid,updated_at timestamptz DEFAULT now());
    CREATE TABLE audit_entries(entity_type text,entity_id uuid,action text,"before" jsonb,"after" jsonb);
  `);
  account = currentAccount = randomUUID(); wrong = randomUUID(); thread = "arapahoe-thread"; subject = "Arapahoe County Fair";
  await f.db.query("INSERT INTO google_workspace_connections(id,role,status) VALUES($1,'workspace','connected')",[account]);
  await f.db.query("INSERT INTO organizations(id,name,city,region) VALUES($1,'Fair A','Springfield','IL')",[wrong]);
  await f.db.query("INSERT INTO google_workspace_validation_mappings(connection_id,message_id,thread_id,organization_id,evidence_codes) VALUES($1,'old-message',$2,$3,'[\"legacy\"]')",[account,thread,wrong]);
  const access = async (): Promise<DraftFilingAccess> => ({
    connectionId: currentAccount,
    readDraft: async () => ({draftId:"draft",messageId:"current",threadId:thread,raw:"mime"}),
    metadata: async id => ({id,threadId:thread,labelIds:["DRAFT"],headers:{subject,from:"lkingsbaker@arapahoegov.com",to:"office@example.test"}}),
  });
  service = new GmailDraftFilingService(f.db,access);
});
afterEach(async () => f.db.close());
const selection = () => ({gmailConnectionId:account,threadId:"arapahoe-thread",messageId:"current",profileId:f.profileId});
async function ready() {
  return {...selection(),expectedRevision:(await service.mappingRepair.preview(f.principal,selection())).expectedRevision,
    reason:"Verified Aurora Arapahoe correspondence; Fair A is an unrelated Springfield profile."};
}
it("repairs only exact-account/thread mappings, preserves profiles and full prior evidence, then unblocks draft filing",async () => {
  const otherAccount = randomUUID();
  await f.db.query("INSERT INTO google_workspace_validation_mappings(connection_id,message_id,thread_id,organization_id) VALUES($1,'unrelated',$2,$3),($4,'other-thread','elsewhere',$3)",[otherAccount,thread,wrong,account]);
  const profiles = (await f.db.query("SELECT * FROM organizations ORDER BY id")).rows;
  await expect(service.apply(f.principal,{requestKey:"blocked"},{
    draftId:"draft",profileId:f.profileId,expectedRevision:(await service.preview(f.principal,{draftId:"draft",profileId:f.profileId})).expectedRevision,
  })).rejects.toMatchObject({code:"EMAIL_ATTENTION_PROFILE_CONFLICT"});
  const r = await service.mappingRepair.apply(f.principal,{requestKey:"repair"},await ready());
  expect(r.value).toMatchObject({state:"mapping_repaired",changed:true,gmailSync:"not_performed",archiveSync:"not_performed",sent:false,profilesDeleted:false});
  expect((await f.db.query("SELECT * FROM organizations ORDER BY id")).rows).toEqual(profiles);
  const maps = (await f.db.query("SELECT * FROM google_workspace_validation_mappings ORDER BY message_id")).rows;
  expect(maps.find(m=>m.message_id==="old-message").organization_id).toBe(f.profileId);
  expect(maps.filter(m=>m.message_id!=="old-message").every(m=>m.organization_id===wrong)).toBe(true);
  const audit = (await f.db.query('SELECT * FROM audit_entries')).rows[0];
  expect(audit.before.mappings[0]).toMatchObject({organization_id:wrong,evidence_codes:["legacy"]});
  expect(audit.after.reason).toContain("Verified Aurora");
  const a = await service.preview(f.principal,{draftId:"draft",profileId:f.profileId});
  expect((await service.apply(f.principal,{requestKey:"draft-after-repair"},{draftId:"draft",profileId:f.profileId,expectedRevision:a.expectedRevision})).value.state).toBe("draft_filed");
  expect((await f.db.query("SELECT * FROM google_workspace_gmail_mutations")).rows).toEqual([]);
  for(const table of ["activities","follow_ups"]) expect((await f.db.query("SELECT * FROM "+table)).rows).toEqual([]);
});
it("replays once and refuses a different destination or reason for the same key",async () => {
  const a=await ready(), key={requestKey:"same"};
  const r=await service.mappingRepair.apply(f.principal,key,a);
  expect(await service.mappingRepair.apply(f.principal,key,a)).toEqual(r);
  expect((await f.db.query("SELECT * FROM audit_entries")).rows).toHaveLength(1);
  await expect(service.mappingRepair.apply(f.principal,key,{...a,reason:"changed"})).rejects.toMatchObject({code:"CONNECTION_REQUEST_CONFLICT"});
});
it.each(["mapping","new_mapping","profile","source","attention","intent"])("rejects a stale %s snapshot without partial repair",async change => {
  const a=await ready();
  if(change==="mapping") await f.db.query("UPDATE google_workspace_validation_mappings SET evidence_codes='[\"changed\"]'");
  if(change==="new_mapping") await f.db.query("INSERT INTO google_workspace_validation_mappings(connection_id,message_id,thread_id,organization_id) VALUES($1,'new',$2,$3)",[account,thread,wrong]);
  if(change==="profile") await f.db.query("UPDATE organizations SET updated_at=updated_at+interval '1 second' WHERE id=$1",[f.profileId]);
  if(change==="source") subject="Changed conversation";
  if(change==="attention") await f.db.query("INSERT INTO email_thread_attention(id,gmail_connection_id,thread_id,profile_id,state,reason,subject,reviewed_message_id,revision,actor_id) VALUES($1,$2,$3,$4,'needs_your_reply','Question','Fair','old-message',$5,'owner')",[randomUUID(),account,thread,wrong,randomUUID()]);
  if(change==="intent") await f.db.query("INSERT INTO google_workspace_gmail_thread_intents(connection_id,thread_id,generation,intent_kind,organization_id) VALUES($1,$2,1,'assign',$3)",[account,thread,wrong]);
  await expect(service.mappingRepair.apply(f.principal,{requestKey:change},a)).rejects.toMatchObject({code:"CONNECTION_STALE_REVISION"});
  expect((await f.db.query("SELECT * FROM audit_entries")).rows).toEqual([]);
  expect((await f.db.query("SELECT organization_id FROM google_workspace_validation_mappings")).rows.every(m=>m.organization_id===wrong)).toBe(true);
});
it("preserves reply state and due date while superseding stale jobs",async () => {
  const mutation=randomUUID(), attention=randomUUID();
  await f.db.query("INSERT INTO google_workspace_gmail_mutations(id,connection_id,thread_id,organization_id,operation,state) VALUES($1,$2,$3,$4,'assign_thread','pending')",[mutation,account,thread,wrong]);
  await f.db.query("INSERT INTO google_workspace_gmail_thread_intents(connection_id,thread_id,generation,intent_kind,organization_id,current_mutation_id) VALUES($1,$2,3,'assign',$3,$4)",[account,thread,wrong,mutation]);
  await f.db.query("INSERT INTO email_thread_attention(id,gmail_connection_id,thread_id,profile_id,state,reason,subject,due_at,reviewed_message_id,revision,actor_id) VALUES($1,$2,$3,$4,'waiting_for_their_reply','Proposal sent','Fair','2026-10-15T17:00:00Z','old-message',$5,'owner')",[attention,account,thread,wrong,randomUUID()]);
  const before=(await f.db.query("SELECT * FROM email_thread_attention")).rows[0];
  await service.mappingRepair.apply(f.principal,{requestKey:"jobs"},await ready());
  const after=(await f.db.query("SELECT * FROM email_thread_attention")).rows[0];
  expect(after).toMatchObject({profile_id:f.profileId,state:before.state,reason:before.reason,due_at:before.due_at});
  expect(after.revision).not.toBe(before.revision);
  expect((await f.db.query("SELECT * FROM email_thread_attention_audit")).rows).toHaveLength(1);
  expect((await f.db.query("SELECT * FROM google_workspace_gmail_mutations")).rows).toMatchObject([{state:"permanent_error",last_error_code:"GOOGLE_WORKSPACE_ASSIGNMENT_SUPERSEDED"}]);
  expect((await f.db.query("SELECT * FROM google_workspace_gmail_thread_intents")).rows).toMatchObject([{generation:4,current_mutation_id:null,organization_id:f.profileId}]);
});
it("blocks a cross-profile follow-up instead of silently moving or dropping it",async () => {
  await f.db.query("INSERT INTO email_thread_attention(id,gmail_connection_id,thread_id,profile_id,state,reason,subject,followup_id,reviewed_message_id,revision,actor_id) VALUES($1,$2,$3,$4,'needs_your_reply','Question','Fair',$5,'old-message',$6,'owner')",[randomUUID(),account,thread,wrong,randomUUID(),randomUUID()]);
  expect((await service.mappingRepair.preview(f.principal,selection())).blocker).toBe("CONNECTION_EMAIL_REPAIR_LINKED_FOLLOWUP");
  await expect(service.mappingRepair.apply(f.principal,{requestKey:"followup"},await ready())).rejects.toMatchObject({code:"CONNECTION_EMAIL_REPAIR_LINKED_FOLLOWUP"});
  expect((await f.db.query("SELECT organization_id FROM google_workspace_validation_mappings")).rows[0].organization_id).toBe(wrong);
});
it("rejects changed Google accounts and cross-thread message IDs",async () => {
  const a=await ready(); currentAccount=randomUUID();
  await expect(service.mappingRepair.apply(f.principal,{requestKey:"account"},a)).rejects.toMatchObject({code:"CONNECTION_EMAIL_REPAIR_SOURCE_CHANGED"});
  currentAccount=account; thread="different-thread";
  await expect(service.mappingRepair.preview(f.principal,selection())).rejects.toMatchObject({code:"CONNECTION_EMAIL_REPAIR_SOURCE_CHANGED"});
  thread="arapahoe-thread";
  await f.db.query("INSERT INTO google_workspace_validation_mappings(connection_id,message_id,thread_id,organization_id) VALUES($1,'current','wrong-thread',$2)",[account,wrong]);
  await expect(service.mappingRepair.preview(f.principal,selection())).rejects.toMatchObject({code:"CONNECTION_EMAIL_REPAIR_CROSS_THREAD"});
});
it("enforces scopes and revoked grants even on idempotent replay",async () => {
  const a=await ready(), denied={...f.principal,scopes:[]};
  await expect(service.mappingRepair.preview(denied,selection())).rejects.toMatchObject({code:"CONNECTION_ACCESS_DENIED"});
  await expect(service.mappingRepair.apply(denied,{requestKey:"denied"},a)).rejects.toMatchObject({code:"CONNECTION_ACCESS_DENIED"});
  await service.mappingRepair.apply(f.principal,{requestKey:"revoked"},a);
  await f.db.query("UPDATE chatgpt_connections SET revoked_at=now() WHERE id=$1",[f.principal.connectionId]);
  await expect(service.mappingRepair.apply(f.principal,{requestKey:"revoked"},a)).rejects.toMatchObject({code:"CONNECTION_REVOKED"});
});
it("rolls back mappings and receipts if audit persistence fails",async () => {
  const a=await ready();
  await f.db.exec(`CREATE FUNCTION reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$;
    CREATE TRIGGER reject_audit BEFORE INSERT ON audit_entries FOR EACH ROW EXECUTE FUNCTION reject_audit();`);
  await expect(service.mappingRepair.apply(f.principal,{requestKey:"rollback"},a)).rejects.toThrow("audit unavailable");
  expect((await f.db.query("SELECT organization_id FROM google_workspace_validation_mappings")).rows[0].organization_id).toBe(wrong);
  expect((await f.db.query("SELECT * FROM chatgpt_operations")).rows).toEqual([]);
});
it("registers discoverable correction tools with read and organize permissions",async () => {
  const tools=connectionTools({draftFiling:service} as ConnectionServices,f.principal);
  const preview=tools.find(t=>t.name==="preview_email_mapping_repair")!;
  const repair=tools.find(t=>t.name==="repair_email_profile_mapping")!;
  expect([preview.scope,preview.readOnly,repair.scope,repair.readOnly]).toEqual(["crm:read",true,"email:organize",false]);
  const p=await preview.call(selection()) as any;
  expect((await repair.call({...selection(),expectedRevision:p.expectedRevision,reason:"Verified Aurora identity",requestKey:"tool"}) as any).value.state).toBe("mapping_repaired");
});

it("unblocks received/sent conversation filing without changing the conflict guard",async () => {
  const attention=new EmailThreadAttentionService(f.db,{
    authorize:async()=>{},
    source:async()=>({gmailConnectionId:account,threadId:"arapahoe-thread",latestMessageId:"current",
      sourceFingerprint:"verified-thread",subject:"Arapahoe",from:"lkingsbaker@arapahoegov.com",to:"office@example.test",internalDateMs:1,hasAttachments:false}),
    assign:async()=>{throw new Error("Preview must not assign");},
    sync:async()=>{throw new Error("Preview must not synchronize");},
  });
  const actor={ownerId:f.principal.ownerId,connectorId:f.principal.connectionId};
  const input={messageId:"current",profileId:f.profileId,eventYear:2027,state:"waiting_for_their_reply" as const,
    reason:"Proposal sent",dueAt:null,followupId:null};
  await expect(attention.preview(actor,input)).rejects.toThrow("EMAIL_ATTENTION_PROFILE_CONFLICT");
  await service.mappingRepair.apply(f.principal,{requestKey:"received"},await ready());
  expect(await attention.preview(actor,input)).toMatchObject({profileId:f.profileId,state:"waiting_for_their_reply"});
});
it("corrects resolved reviews only within the reviewed thread and preserves pending reviews",async () => {
  await f.db.query("INSERT INTO google_workspace_validation_review_items(connection_id,message_id,thread_id,review_state,resolved_organization_id) VALUES($1,'resolved',$2,'resolved',$3),($1,'pending',$2,'pending',NULL),($1,'elsewhere','elsewhere','resolved',$3)",[account,thread,wrong]);
  await service.mappingRepair.apply(f.principal,{requestKey:"reviews"},await ready());
  const rows=(await f.db.query("SELECT * FROM google_workspace_validation_review_items ORDER BY message_id")).rows;
  expect(rows.find(r=>r.message_id==="resolved")).toMatchObject({resolved_organization_id:f.profileId,gmail_sync_state:"pending",gmail_sync_mutation_id:null});
  expect(rows.find(r=>r.message_id==="pending")).toMatchObject({review_state:"pending",resolved_organization_id:null});
  expect(rows.find(r=>r.message_id==="elsewhere").resolved_organization_id).toBe(wrong);
  expect((await f.db.query("SELECT * FROM audit_entries")).rows[0].before.reviews).toHaveLength(2);
});
