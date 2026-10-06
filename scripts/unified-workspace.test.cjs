const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {stripTypeScriptTypes}=require('node:module');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
function load(file,names,deps={}) {
 if(!fs.existsSync(path.join(root,file)))return {};
 let source=fs.readFileSync(path.join(root,file),'utf8').replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export type \{[\s\S]*?\} from [^;]+;/gm,'').replace(/^export /gm,'');
 source=source.replace(/constructor\(([\s\S]*?)\)\s*\{/g,(_m,args)=>{const fields=[...args.matchAll(/(?:private readonly|private|public|protected) (\w+)/g)].map(x=>x[1]);return 'constructor('+args.replace(/(?:private readonly|private|public|protected) /g,'')+') {'+fields.map(x=>'this.'+x+'='+x+';').join('');});
 return new Function(...Object.keys(deps),stripTypeScriptTypes(source,{mode:'strip'})+';return {'+names.map(n=>n+': typeof '+n+' === "undefined" ? undefined : '+n).join(',')+'};')(...Object.values(deps));
}
const base='artifacts/api-server/src/features/';
const contracts=load(base+'chatgpt-connection/contracts.ts',['requireConnectionScope','activeConnection','ConnectionError'],{createHash});
const {parseWebsiteInquiryCursor,WebsiteInquiryNotFoundError}=load(base+'website-inquiries/website-inquiry-review-service.ts',['parseWebsiteInquiryCursor','WebsiteInquiryNotFoundError']);
const {WebsiteInquiryReads}=load(base+'chatgpt-connection/website-inquiry-reads.ts',['WebsiteInquiryReads'],{...contracts,parseWebsiteInquiryCursor,WebsiteInquiryNotFoundError});
const principal={ownerId:'owner',connectionId:'connection',clientId:'client',scopes:['crm:read']};
const inquiryId='2920fe88-43a4-4edf-bf5d-4142bee692f3';
function fixture({revoked=false}={}){
 const db={async query(sql,args){assert.deepEqual(args,['connection','owner','client']);return {rows:[{id:'connection',owner_id:'owner',client_id:'client',scopes:['crm:read'],revoked_at:revoked?'now':null}]};}};
 let calls=0;
 const review={async list(input){calls++;return {items:[{id:inquiryId,status:'new',eventName:'Fair'}],nextCursor:null};},async detail(id){calls++;if(id!==inquiryId)throw Error('Website inquiry not found.');return {inquiry:{id,eventName:'Fair',message:'Original full customer question',convertedOrganizationId:null},auditHistory:[]};}};
 return {db,review,calls:()=>calls};
}
test('COM can list inquiries with links and read the original message without status changes',async()=>{
 assert.equal(typeof WebsiteInquiryReads,'function','inquiry read connector is missing');
 const h=fixture(),s=new WebsiteInquiryReads(h.db,h.review,'https://app.example');
 const list=await s.list(principal,{});
 assert.equal(list.items[0].url,'https://app.example/website-inquiries?inquiry='+inquiryId);
 assert.equal(list.nextCursor,null);
 const detail=await s.detail(principal,{inquiryId});
 assert.equal(detail.inquiry.message,'Original full customer question');assert.equal(detail.inquiry.status,undefined);
});
test('inquiry reads reject revoked connections and absent scopes before accessing records',async()=>{
 assert.equal(typeof WebsiteInquiryReads,'function');
 for(const [p,revoked] of [[{...principal,scopes:[]},false],[principal,true]]){
  const h=fixture({revoked}),s=new WebsiteInquiryReads(h.db,h.review,'https://app.example');
  await assert.rejects(s.list(p,{}));assert.equal(h.calls(),0);
 }
});
test('inquiry reads reject malformed cursors, IDs, statuses and limits',async()=>{
 assert.equal(typeof WebsiteInquiryReads,'function');
 const h=fixture(),s=new WebsiteInquiryReads(h.db,h.review,'https://app.example');
 for(const input of [{cursor:'bad'},{limit:0},{limit:101},{status:'deleted'}])await assert.rejects(s.list(principal,input));
 await assert.rejects(s.detail(principal,{inquiryId:'not-id'}));assert.equal(h.calls(),0);
});
module.exports={load};

const frontend='artifacts/adventure-zone/src/';
const {bookingNavigation}=load(frontend+'features/navigation/booking-navigation.ts',['bookingNavigation']);
const {readEmailWorkspaceState,legacyReviewUrl}=load(frontend+'features/emails/email-workspace-state.ts',['readEmailWorkspaceState','legacyReviewUrl']);
test('primary booking navigation leads to Emails rather than a separate review destination',()=>{
 assert.equal(typeof bookingNavigation,'function');
 assert.deepEqual(bookingNavigation(true).map(x=>[x.href,x.label]),[['/today','Today'],['/profiles','Profiles'],['/emails','Emails'],['/schedule','Schedule']]);
 assert.equal(bookingNavigation(false)[3].label,'Schedule & Routes');
});
test('legacy review links retain exact identifiers and return context',()=>{
 assert.equal(typeof legacyReviewUrl,'function');
 const url=legacyReviewUrl('?attentionMessage=message-a&profileId=profile-a&returnTo=%2Ftoday');
 assert.equal(url,'/emails?attentionMessage=message-a&profileId=profile-a&returnTo=%2Ftoday&view=review');
 assert.equal(readEmailWorkspaceState(url.split('?')[1]).attentionMessage,'message-a');
});
test('email workspace URLs select all views without stale browser storage',()=>{
 assert.equal(typeof readEmailWorkspaceState,'function');
 for(const view of ['inbox','sent','drafts','review','needs_reply','waiting'])assert.equal(readEmailWorkspaceState('?view='+view).view,view);
 assert.equal(readEmailWorkspaceState('?folder=sent&q=Fair&threadId=t').view,'sent');
 assert.equal(readEmailWorkspaceState('?view=bogus').view,'inbox');
 assert.equal(readEmailWorkspaceState('?folder=search&q=Fair').query,'Fair');
});

const {readAttentionList}=load(base+'google-workspace/email-attention-list.ts',['readAttentionList'],{Buffer});
test('saved attention views bind paging to the active account and saved state',async()=>{
 assert.equal(typeof readAttentionList,'function');
 let active='account-a';const queries=[];
 const db={async query(sql,args){queries.push({sql,args});if(sql.includes('google_workspace_connections'))return {rows:[{id:active}]};
 return {rows:[{id:'b',thread_id:'thread-b',profile_id:'profile',state:'needs_your_reply',subject:'Reply',updated_at:'2026-10-06T12:00:00Z',reviewed_message_id:'msg-b'},{id:'a',thread_id:'thread-a',profile_id:'profile',state:'needs_your_reply',subject:'Reply',updated_at:'2026-10-06T11:00:00Z',reviewed_message_id:'msg-a'}]};}};
 const page=await readAttentionList(db,async()=>{}, {ownerId:'owner',connectorId:null},{gmailConnectionId:'account-a',state:'needs_your_reply',limit:1});
 assert.equal(page.items.length,1);assert.equal(page.items[0].threadId,'thread-b');assert.ok(page.nextCursor);
 assert.deepEqual(queries[1].args.slice(0,2),['account-a','needs_your_reply']);
 await assert.rejects(readAttentionList(db,async()=>{}, {ownerId:'owner',connectorId:null},{gmailConnectionId:'account-a',state:'waiting_for_their_reply',cursor:page.nextCursor}),/CURSOR/);
 active='account-b';
 await assert.rejects(readAttentionList(db,async()=>{}, {ownerId:'owner',connectorId:null},{gmailConnectionId:'account-a',state:'needs_your_reply'}),/CONNECTION_CHANGED/);
});

const {readMailboxContext,isCurrentMailboxResponse}=load(frontend+'features/emails/email-workspace-state.ts',['readMailboxContext','isCurrentMailboxResponse']);
test('mailbox restoration is account-scoped and ignores stale responses',()=>{
 assert.equal(typeof readMailboxContext,'function');assert.equal(typeof isCurrentMailboxResponse,'function');
 const storage={getItem(key){return key==='az-mailbox:account-a'?JSON.stringify({accountId:'account-a',threadId:'t',scrollY:42}):null;}};
 assert.equal(readMailboxContext(storage,'account-a').threadId,'t');assert.equal(readMailboxContext(storage,'account-b'),null);
 assert.equal(isCurrentMailboxResponse(1,2,'a','a'),false);assert.equal(isCurrentMailboxResponse(2,2,'a','b'),false);assert.equal(isCurrentMailboxResponse(2,2,'a','a'),true);
});

const {groupMasterWork}=load(frontend+'features/today/group-master-work.ts',['groupMasterWork']);
const work=(id,kind,overrides={})=>({id,kind,sourceId:id,sourceType:'work',eventName:'Same fair',organizationId:'profile',priority:'normal',pinned:false,manualOrder:null,dueAt:null,completedAt:null,...overrides});
test('Today groups distinct actions and prioritizes one review over duplicate draft/reply sources',()=>{
 assert.equal(typeof groupMasterWork,'function');
 const queue={needsAttention:[work('r','reply',{sourceId:'mail',threadId:'t'}),work('d','draft',{sourceId:'mail',threadId:'t'}),work('v','review',{sourceId:'mail',threadId:'t'})],active:[work('call','callback'),work('paper','booking')],completedToday:[]};
 const groups=groupMasterWork(queue,new Date('2026-10-06T12:00:00Z'));
 assert.deepEqual(groups.replies.map(x=>x.id),['v']);assert.deepEqual(groups.calls.map(x=>x.id),['call']);assert.deepEqual(groups.booking.map(x=>x.id),['paper']);
});
test('Today respects saved ordering and collapses waiting, future and completed items',()=>{
 assert.equal(typeof groupMasterWork,'function');
 const queue={needsAttention:[],active:[work('urgent','research',{priority:'urgent'}),work('pin','research',{pinned:true}),work('manual','research',{manualOrder:0}),work('waiting','follow_up',{attentionState:'waiting_for_their_reply'}),work('future','follow_up',{dueAt:'2026-10-09T12:00:00Z'}),work('done','booking',{completedAt:'2026-10-06'})],completedToday:[]};
 const g=groupMasterWork(queue,new Date('2026-10-06T12:00:00Z'));
 assert.deepEqual(g.booking.map(x=>x.id),['pin','manual','urgent']);assert.deepEqual(g.waiting.map(x=>x.id),['waiting']);assert.deepEqual(g.later.map(x=>x.id),['future']);assert.deepEqual(g.completed.map(x=>x.id),['done']);
});

const {mergeProfileHistory}=load(frontend+'components/profiles/profile-activity-history-model.ts',['mergeProfileHistory']);
test('profile history merges original IDs without losing distinct same-date activities',()=>{
 assert.equal(typeof mergeProfileHistory,'function');
 const history=mergeProfileHistory([{id:'n',kind:'call',body:'Called',occurredAt:new Date('2026-10-06')}],[{id:'n',kind:'call',body:'Duplicate',occurredAt:new Date('2026-10-06')},{id:'mail:t',kind:'email',body:'Customer reply',occurredAt:new Date('2026-10-06'),href:'/emails?threadId=t'}]);
 assert.equal(history.length,2);assert.equal(history.find(x=>x.id==='n').body,'Called');assert.equal(history.find(x=>x.kind==='email').href,'/emails?threadId=t');
});

const zodRequire=require('node:module').createRequire(path.join(root,'artifacts/api-server/package.json'));
let z;try { z=(process.env.AZ_ZOD_PATH?require(process.env.AZ_ZOD_PATH):zodRequire('zod')).z; } catch {}
if(z) test('COM inquiry catalog exposes strict read-only schemas and routes calls to the authorized reader',async()=>{
 const schema=z.object({});
 const {connectionTools}=load(base+'chatgpt-connection/tool-registry.ts',['connectionTools'],{z,mergeInputSchema:schema,operationalInput:schema,scheduleSections:['bookings'],routeSections:['stops'],resourceSections:['resources'],eventDatesSchema:schema,sourceSchema:schema,draftContentSchema:schema,closeFollowupSchema:z.object({action:z.enum(['complete','dismiss'])}),bookingWorkTools:()=>[],emailAttentionTools:()=>[],todayReadInput:schema,emailReviewToolReminder:'',operationalReviewToolReminder:''});
 const h=fixture(),inquiries=new WebsiteInquiryReads(h.db,h.review,'https://app.example');
 const tools=connectionTools({inquiries},principal),list=tools.find(x=>x.name==='list_website_inquiries'),detail=tools.find(x=>x.name==='read_website_inquiry');
 assert.equal(list.scope,'crm:read');assert.equal(list.readOnly,true);assert.equal(detail.readOnly,true);
 assert.equal(list.schema.safeParse({limit:101}).success,false);assert.equal(list.schema.safeParse({archive:true}).success,false);assert.equal(detail.schema.safeParse({inquiryId:'bad'}).success,false);
 assert.equal((await detail.call({inquiryId})).inquiry.message,'Original full customer question');
});

const {mailboxRestoreTarget,writeMailboxContext,writeReviewContext,readReviewContext,reviewSelectionUrl,attentionContextKey}=load(frontend+'features/emails/email-workspace-state.ts',['mailboxRestoreTarget','writeMailboxContext','writeReviewContext','readReviewContext','reviewSelectionUrl','attentionContextKey']);
test('thread and draft deep links restore identities outside the current mailbox page',()=>{
 assert.equal(typeof mailboxRestoreTarget,'function');
 const target=mailboxRestoreTarget({accountId:'a',threadId:'archived',profileId:'p'},[],'a');
 assert.equal(target.threadId,'archived');assert.equal(target.profiles[0].id,'p');
 assert.equal(mailboxRestoreTarget({accountId:'b',threadId:'old'},[],'a'),null);
 assert.equal(mailboxRestoreTarget({draftId:'draft-old'},[],'a').draftId,'draft-old');
});
test('Back preserves selected identity and list scroll independently of pane visibility',()=>{
 assert.equal(typeof writeMailboxContext,'function');
 const values=new Map(),storage={setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)||null};
 writeMailboxContext(storage,{accountId:'a',threadId:'older',scrollY:420,showList:true});
 assert.deepEqual(readMailboxContext(storage,'a'),{accountId:'a',threadId:'older',scrollY:420,showList:true});
});
test('review selection and return pane persist per account without stale filing context',()=>{
 assert.equal(typeof writeReviewContext,'function');
 const values=new Map(),storage={setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)||null};
 writeReviewContext(storage,{accountId:'a',messageId:'review-2',scrollY:300,pane:'list'});
 assert.equal(readReviewContext(storage,'a').messageId,'review-2');assert.equal(readReviewContext(storage,'b'),null);
 const url=reviewSelectionUrl('?view=review&attentionMessage=old&profileId=p','new');
 assert.equal(new URLSearchParams(url.split('?')[1]).get('reviewMessageId'),'new');
 assert.equal(new URLSearchParams(url.split('?')[1]).has('attentionMessage'),false);
 assert.notEqual(attentionContextKey('a','m','profile-a'),attentionContextKey('a','m','profile-b'));
});
test('Today retains separate review actions and drafts in the same thread',()=>{
 const a=work('v1','review',{threadId:'t',messageId:'m1',sourceId:'source-1'});
 const b=work('v2','review',{threadId:'t',messageId:'m2',sourceId:'source-2'});
 assert.equal(groupMasterWork({needsAttention:[a,b],active:[],completedToday:[]}).replies.length,2);
});
