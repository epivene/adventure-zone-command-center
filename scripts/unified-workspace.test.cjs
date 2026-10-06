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
 return new Function(...Object.keys(deps),stripTypeScriptTypes(source,{mode:'strip'})+';return {'+names.join(',')+'};')(...Object.values(deps));
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
