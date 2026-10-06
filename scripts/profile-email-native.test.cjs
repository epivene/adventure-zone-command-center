const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {stripTypeScriptTypes}=require('node:module');
const root=path.resolve(__dirname,'..');
function load(file,names,deps={}) {
 let text=fs.readFileSync(path.join(root,file),'utf8').replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export /gm,'');
 text=text.replace(/constructor\(([\s\S]*?)\)\s*\{\s*\}/g,(_match,args)=>{const names=[...args.matchAll(/private readonly (\w+)/g)].map(x=>x[1]);return 'constructor('+args.replace(/private readonly /g,'')+') {'+names.map(x=>'this.'+x+'='+x+';').join('')+'}';});
 const js=stripTypeScriptTypes(text,{mode:'strip'});
 return new Function(...Object.keys(deps),js+';return {'+names.join(',')+'};')(...Object.values(deps));
}
const folder='artifacts/api-server/src/features/google-workspace/';
const config=load(folder+'google-profile-label-config.ts',['canonicalProfileLabelName','GOOGLE_PROFILE_LABEL_HIERARCHY','isCurrentProfileLabelPath','normalizedProfileLabelPath','profileLabelIdentity','isProfileLabelPath']);
const {GoogleProfileLabelResolver}=load(folder+'google-profile-label-resolver.ts',['GoogleProfileLabelResolver'],config);
const {GoogleProfileLabelSyncService}=load(folder+'google-profile-label-sync-service.ts',['GoogleProfileLabelSyncService'],config);
function fixture({missing=false,failed=false,attention=false,linkedPolicy=false}={}) {
 let row=null,labels=['INBOX','UNREAD','business'],created=0,attentionCalls=0,current=true,modifyCount=0;
 const mapping={connectionId:'account-a',organizationId:'profile-a',gmailLabelId:'profile-label',gmailLabelName:'Profiles/Fair',state:'active',lastErrorCode:null};
 const gmail={async listLabels(){return missing?[]:[{id:'profile-label',name:'Profiles/Fair',type:'user'}];},async createLabel(name){created++;return {id:'created',name,type:'user'};},async renameLabel(){throw Error('unexpected rename');},async getThreadLabelIds(){return [...labels];},async modifyThreadLabels({addLabelIds,removeLabelIds}){modifyCount++;if(failed){failed=false;throw Error('rate limit');}labels=labels.filter(x=>!removeLabelIds.includes(x));labels=[...new Set([...labels,...addLabelIds])];},async modifyMessageLabels(){}};
 const repository={async getOrganization(){return {id:'profile-a',name:'Fair',consolidatedIntoId:null};},async findByOrganization(){return missing?null:mapping;},async findByLabelId(){return mapping;},async adopt(value){return {...value,state:'active'};},async markState(){},async listManagedLabelIds(){return ['profile-label'];}};
 const mutations={async threadPolicy(){return {current,reuseOnly:linkedPolicy};},async createOrLoad(intent){if(!row)row={...intent,id:'one',state:'pending',attemptCount:0,intentGeneration:1,lastErrorCode:null,targetLabelId:null,removeLabelIds:[]};return row;},async withThreadLock(_input,work){return work();},async get(){return row;},async retryNow(){if(row.state==='retryable_error')row={...row,state:'pending'};return row;},async claim(){if(row.state==='completed')return null;row={...row,state:'processing',attemptCount:row.attemptCount+1};return row;},async complete(value){row={...row,...value,state:'completed'};return row;},async fail(value){row={...row,...value,lastErrorCode:value.errorCode};return row;}};
 const resolver=new GoogleProfileLabelResolver(repository,gmail);
 const service=new GoogleProfileLabelSyncService({enabled:true,mutations,resolver,labels:repository,gmail,...(attention?{attention:async()=>{attentionCalls++;labels=labels.filter(x=>x!=='INBOX');return ['INBOX'];}}:{})});
 const input={connectionId:'account-a',messageId:'message-a',threadId:'thread-a',organizationId:'profile-a',actorId:'owner',decisionRevision:'r1',preserveInbox:true};
 return {service,input,getLabels:()=>labels,getCreated:()=>created,getAttention:()=>attentionCalls,getRow:()=>row,setCurrent:value=>{current=value;},modifyCount:()=>modifyCount};
}
test('linking keeps Inbox, unread and unrelated labels',async()=>{
 const h=fixture();const result=await h.service.assignThread(h.input);
 assert.equal(result.state,'completed');assert.deepEqual(h.getLabels().sort(),['INBOX','UNREAD','business','profile-label'].sort());
});
test('link operation survives a failed label request and retry',async()=>{
 const h=fixture({failed:true});await h.service.assignThread(h.input);await h.service.retry('one');
 assert.equal(h.getRow().operation,'link_thread');assert.ok(h.getLabels().includes('INBOX'));
});
test('linking cannot trigger legacy attention archiving',async()=>{
 const h=fixture({attention:true});await h.service.assignThread(h.input);
 assert.equal(h.getAttention(),0);assert.ok(h.getLabels().includes('INBOX'));
});
test('missing mapped label is reported without creating duplicates',async()=>{
 const h=fixture({missing:true});const result=await h.service.assignThread(h.input);
 assert.equal(h.getCreated(),0);assert.equal(result.errorCode,'GOOGLE_WORKSPACE_GMAIL_LABEL_NOT_FOUND');
});
test('legacy explicit filing still archives',async()=>{
 const h=fixture();await h.service.assignThread({...h.input,preserveInbox:false});
 assert.ok(!h.getLabels().includes('INBOX'));
});
test('repeated linking preserves one operation and one label',async()=>{
 const h=fixture();await h.service.assignThread(h.input);await h.service.assignThread(h.input);
 assert.equal(h.getRow().id,'one');assert.equal(h.getLabels().filter(x=>x==='profile-label').length,1);assert.equal(h.getCreated(),0);
});

const {createHash}=require('node:crypto');
const {GoogleMailboxService,draftRevision}=load(folder+'google-mailbox-service.ts',['GoogleMailboxService','draftRevision'],{createHash,pool:{}});
function mailboxFixture({sendFails=false,accountChanged=false,sendError=null,rawOverride=null}={}) {
 const account={id:'account-a',email:'owner@example.com',status:'connected'};
 let sendCount=0,ledger=null,raw=rawOverride || 'bWltZS13aXRoLWF0dGFjaG1lbnRz',sentRaw=null,modified=null;
 const read={async getThreadDetail(){return {id:'thread-a',subject:'Subject',messages:[{id:'msg-a',to:'to@example.com',from:'owner@example.com',bodyText:'Body',attachments:[]}]};},async getGmailDraftRaw(){return {draftId:'draft-a',messageId:'msg-a',threadId:'thread-a',raw};},
  async listMessagePage(input){return {messages:[{id:'msg-a',threadId:'thread-a'}],nextPageToken:'next'};},
  async getMessageMetadata(){return {id:'msg-a',threadId:'thread-a',headers:{from:'a@example.com',to:'owner@example.com',subject:'Question',date:'2026-10-01'},labelIds:['INBOX','UNREAD'],snippet:'A question',internalDateMs:1,hasAttachments:false};}};
 const tx={async query(sql,values) {
  if(sql.startsWith('SELECT state,'))return {rows:ledger?[ledger]:[]};
  if(sql.startsWith('INSERT INTO google_workspace_mailbox_sends')) ledger={state:'sending'};
  if(sql.includes("SET state='sent'"))ledger={state:'sent',message_id:values[2],thread_id:values[3]};
  if(sql.includes("SET state='uncertain'"))ledger={state:'uncertain'};
  if(sql.startsWith("DELETE FROM google_workspace_mailbox_sends")) ledger=null;
  return {rows:[]};
 },release(){}};
 const database={query:tx.query,async connect(){return tx;}};
 const connection={async getCurrent(){return accountChanged?{...account,id:'account-b'}:account;},
  async createReadClient(){return read;},
  async createGmailDeliveryClient(){return {connectionId:account.id,client:{async sendGmailDraft(input){if(input.beforeSend)await input.beforeSend();sendCount++;sentRaw=input.raw;if(sendError)throw Error(sendError);if(sendFails)throw Error('timeout');return {messageId:'sent-a',threadId:'thread-a'};}}};},
  async createGmailLabelMutationClient(){return {connectionId:account.id,client:{async modifyThreadLabels(input){modified=input;}}};}};
 const service=new GoogleMailboxService(connection,database);
 const input={connectionId:'account-a',draftId:'draft-a',revision:draftRevision(raw)};
 return {service,input,sendCount:()=>sendCount,sentRaw:()=>sentRaw,raw,ledger:()=>ledger,modified:()=>modified};
}
test('native mailbox reads unlinked Inbox without filing messages',async()=>{
 const h=mailboxFixture();const page=await h.service.list({folder:'inbox',query:''});
 assert.equal(page.messages.length,1);assert.deepEqual(page.messages[0].profiles,[]);assert.deepEqual(page.messages[0].labelIds,['INBOX','UNREAD']);assert.equal(h.modified(),null);
});
test('draft sending preserves reviewed MIME including attachments',async()=>{
 const h=mailboxFixture();await h.service.sendDraft(h.input);
 assert.equal(h.sentRaw(),h.raw);assert.equal(h.sendCount(),1);assert.equal(h.ledger().state,'sent');
});
test('duplicate successful send returns saved result without sending twice',async()=>{
 const h=mailboxFixture();await h.service.sendDraft(h.input);const second=await h.service.sendDraft(h.input);
 assert.equal(second.messageId,'sent-a');assert.equal(h.sendCount(),1);
});
test('uncertain send survives a retry without duplicate delivery',async()=>{
 const h=mailboxFixture({sendFails:true});
 await assert.rejects(()=>h.service.sendDraft(h.input),/SEND_OUTCOME_UNCERTAIN/);
 await assert.rejects(()=>h.service.sendDraft(h.input),/SEND_OUTCOME_UNCERTAIN/);
 assert.equal(h.sendCount(),1);assert.equal(h.ledger().state,'uncertain');
});
test('changed draft must be reviewed again before any send',async()=>{
 const h=mailboxFixture();await assert.rejects(()=>h.service.sendDraft({...h.input,revision:'different'}),/DRAFT_CHANGED/);assert.equal(h.sendCount(),0);assert.equal(h.ledger(),null);
});
test('changed account blocks a stale send request',async()=>{
 const h=mailboxFixture({accountChanged:true});await assert.rejects(()=>h.service.sendDraft(h.input),/CONNECTION_CHANGED/);assert.equal(h.sendCount(),0);
});
test('explicit archive removes only Inbox',async()=>{
 const h=mailboxFixture();await h.service.archive('thread-a','account-a');assert.deepEqual(h.modified(),{threadId:'thread-a',addLabelIds:[],removeLabelIds:['INBOX']});
});
const {projectCallBrief}=load('artifacts/adventure-zone/src/components/profiles/profile-call-brief-model.ts',['projectCallBrief']);
test('call brief keeps year-specific bookings and excludes administrative notes from discussion',()=>{
 const profile={id:'profile-a',contacts:[{id:'primary',name:'Organizer',isPrimary:true}],
  bookings:[{id:'old',name:'Old',startsAt:'2025-10-01',status:'completed'},{id:'next',name:'New',startsAt:'2027-10-01',status:'pending_contract'}],
  notes:[{id:'note',kind:'note',body:'Admin edit',occurredAt:'2026-10-06'},{id:'call',kind:'call',body:'Discussed package',occurredAt:'2026-10-01'}],
  followUps:[{kind:'call',dueAt:'2026-10-10',completedAt:null}]};
 const result=projectCallBrief(profile,2027);assert.deepEqual(result.bookings.map(x=>x.id),['next']);assert.equal(result.discussion.id,'call');assert.equal(result.nextAction.kind,'call');assert.equal(projectCallBrief(profile,2026).bookings.length,0);
});

test('later reply inherits reuse-only policy and never creates a missing label',async()=>{
 const h=fixture({missing:true,linkedPolicy:true});const result=await h.service.labelInboundMessage(h.input);
 assert.equal(h.getCreated(),0);assert.equal(result.errorCode,'GOOGLE_WORKSPACE_GMAIL_LABEL_NOT_FOUND');
});
test('later reply cannot invoke an archiving hook on a link-only thread',async()=>{
 const h=fixture({attention:true,linkedPolicy:true});await h.service.labelInboundMessage(h.input);
 assert.equal(h.getAttention(),0);assert.ok(h.getLabels().includes('INBOX'));
});
test('completed label reconciliation rejects obsolete thread intent',async()=>{
 const h=fixture();await h.service.assignThread(h.input);h.setCurrent(false);const result=await h.service.assignThread(h.input);
 assert.equal(result.errorCode,'GOOGLE_WORKSPACE_ASSIGNMENT_SUPERSEDED');assert.equal(h.modifyCount(),1);
});



test('definite provider rejection keeps the draft retryable',async()=>{
 const h=mailboxFixture({sendError:'GOOGLE_WORKSPACE_GMAIL_SEND_REJECTED'});
 await assert.rejects(()=>h.service.sendDraft(h.input),/SEND_REJECTED/);assert.equal(h.ledger(),null);
});
test('pre-send draft change does not poison the draft as uncertain',async()=>{
 const h=mailboxFixture({sendError:'GOOGLE_WORKSPACE_DRAFT_CHANGED'});
 await assert.rejects(()=>h.service.sendDraft(h.input),/DRAFT_CHANGED/);assert.equal(h.ledger(),null);
});



test('saved draft review exposes Cc and Bcc recipients from its MIME',async()=>{
 const raw=Buffer.from('To: to@example.com\r\nCc: cc@example.com\r\nBcc: hidden@example.com,\r\n other@example.com\r\nSubject: Subject\r\n\r\nBody').toString('base64url');
 const h=mailboxFixture({rawOverride:raw});const draft=await h.service.draft('draft-a','account-a');
 assert.deepEqual(draft.recipients,{to:'to@example.com',cc:'cc@example.com',bcc:'hidden@example.com, other@example.com'});
});



const {PostgresGoogleProfileAssignmentTransaction}=load(folder+'google-profile-assignment-transaction.ts',['PostgresGoogleProfileAssignmentTransaction'],{defaultPool:{}});
const {GoogleMailboxService:LinkService}=load(folder+'google-mailbox-service.ts',['GoogleMailboxService'],{createHash,pool:{},PostgresGoogleProfileAssignmentTransaction});
function linkFixture(previousOwner=null) {
 let owner=previousOwner,mappingWrites=0,commits=0,rollbacks=0,audits=0;
 const tx={async query(sql,values=[]) {
  if(sql==='COMMIT'){commits++;return {rows:[]};}
  if(sql==='ROLLBACK'){rollbacks++;return {rows:[]};}
  if(sql.includes('SELECT id')&&sql.includes('google_workspace_connections'))return {rows:[{id:'account-a'}]};
  if(sql.includes('SELECT DISTINCT organization_id'))return {rows:owner?[{organization_id:owner}]:[]};
  if(sql.includes('FROM organizations')&&sql.includes('SELECT id'))return {rows:[{id:'profile-a'}]};
  if(sql.includes('INSERT INTO google_workspace_validation_mappings')){owner=values[3];mappingWrites++;}
  if(sql.includes('INSERT INTO google_workspace_gmail_thread_intents'))return {rows:[{generation:1,current_mutation_id:null}]};
  if(sql.includes('INSERT INTO google_workspace_gmail_mutations'))return {rows:[{id:'mutation-a',connection_id:values[0],message_id:values[1],thread_id:values[2],organization_id:values[3],operation:values[8],state:'pending',attempt_count:0,intent_generation:1,idempotency_key:values[4],remove_label_ids:[]}]};
  if(sql.includes('INSERT INTO google_workspace_audit_events'))audits++;
  return {rows:[]};
 },release(){}};
 const database={query:tx.query,async connect(){return tx;}};
 const connection={async getCurrent(){return {id:'account-a',status:'connected',email:'owner@example.com'};},async createReadClient(){return {async getMessageMetadata(){return {id:'msg-a',threadId:'thread-a',headers:{subject:'Question',from:'sender@example.com',to:'owner@example.com'},internalDateMs:1,hasAttachments:false};}};},
  async createGmailLabelMutationClient(){throw Error('GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED');}};
 const service=new LinkService(connection,database);
 const input={connectionId:'account-a',threadId:'thread-a',messageId:'msg-a',organizationId:'profile-a',actorId:'owner'};
 return {service,input,state:()=>({owner,mappingWrites,commits,rollbacks,audits})};
}
test('profile association commits even when Gmail label access fails',async()=>{
 const h=linkFixture();const result=await h.service.link(h.input);
 assert.equal(result.linked,true);assert.equal(result.gmailSync.state,'retryable_error');assert.equal(h.state().owner,'profile-a');assert.equal(h.state().commits,1);
});
test('changing profile requires the verified current owner explicitly',async()=>{
 const h=linkFixture('old-profile');await assert.rejects(()=>h.service.link(h.input),/PROFILE_LINK_CONFLICT/);assert.equal(h.state().mappingWrites,0);assert.equal(h.state().rollbacks,1);
 const result=await h.service.link({...h.input,expectedOrganizationId:'old-profile'});assert.equal(result.linked,true);assert.equal(h.state().owner,'profile-a');assert.equal(h.state().commits,1);
});
test('mark read changes only unread status, preserving Inbox',async()=>{
 const h=mailboxFixture();await h.service.markRead('thread-a','account-a',true);
 assert.deepEqual(h.modified(),{threadId:'thread-a',addLabelIds:[],removeLabelIds:['UNREAD']});
});



const {GoogleMailboxService:SavedCopyService}=load(folder+'google-mailbox-service.ts',['GoogleMailboxService'],{
 createHash,pool:{},PostgresGoogleProfileEmailArchiveRepository:class {
  async findByProviderThread(){return {subject:'Saved discussion',originalGmailUrl:'https://mail.google.com/',lastSyncedAt:'2026-10-01T00:00:00Z',messages:[{gmailMessageId:'msg-a',bodyText:'Saved body',attachments:[]}]};}
 }
});
test('unavailable live Gmail clearly identifies a linked saved copy and timestamp',async()=>{
 const account={id:'account-a',status:'connected'};
 const service=new SavedCopyService({async getCurrent(){return account;},async createReadClient(){return {async getThreadDetail(){throw Error('Gmail unavailable');}};}},
 {async query(){return {rows:[{id:'profile-a',name:'Fair'}]};}});
 const result=await service.thread('thread-a','account-a');assert.equal(result.savedCopy,true);assert.equal(result.sourceState,'saved_copy_gmail_unavailable');assert.equal(result.lastSyncedAt,'2026-10-01T00:00:00Z');assert.equal(result.messages[0].bodyText,'Saved body');
});
