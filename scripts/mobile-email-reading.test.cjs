const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{stripTypeScriptTypes}=require('node:module');
const root=path.resolve(__dirname,'..');
function load(file,names,deps={}) {
 let s=fs.readFileSync(path.join(root,file),'utf8').replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export type \{[\s\S]*?\} from [^;]+;/gm,'').replace(/^export /gm,'');
 s=s.replace(/constructor\(([\s\S]*?)\)\s*\{\s*\}/g,(_match,args)=>{const names=[...args.matchAll(/private readonly (\w+)/g)].map(x=>x[1]);return 'constructor('+args.replace(/private readonly /g,'')+') {'+names.map(x=>'this.'+x+'='+x+';').join('')+'}';});
 return new Function(...Object.keys(deps),stripTypeScriptTypes(s,{mode:'strip'})+';return {'+names.join(',')+'};')(...Object.values(deps));
}
const apiDir='artifacts/api-server/src/features/google-workspace/';
test('full Gmail reads preserve multipart HTML alongside readable plain text',async()=>{
 const {createGoogleWorkspaceReadClient}=load(apiDir+'google-api-client.ts',['createGoogleWorkspaceReadClient'],{Buffer});
 const html='<table><tr><td><b>Event proposal</b></td></tr></table>';
 const client=createGoogleWorkspaceReadClient({environment:{clientId:'id',clientSecret:'secret',redirectUri:'https://app.test/callback',appOrigin:'https://app.test'},refreshToken:'refresh',fetcher:async url=>new Response(JSON.stringify(String(url).includes('/token')?{access_token:'token',expires_in:3600}:{id:'t',messages:[{id:'m',internalDate:'1791331200000',payload:{mimeType:'multipart/alternative',parts:[{mimeType:'text/plain',body:{data:Buffer.from('Event proposal').toString('base64url')}},{mimeType:'text/html',body:{data:Buffer.from(html).toString('base64url')}}]}}]}))});
 const thread=await client.getThreadDetail('t');assert.equal(thread.messages[0].bodyHtml,html);assert.equal(thread.messages[0].bodyText,'Event proposal');
});
test('date fallback accepts stored numeric timestamps and RFC header dates without inventing dates',()=>{
 const {emailTime,formatEmailDate}=load('artifacts/adventure-zone/src/features/emails/email-presentation.ts',['emailTime','formatEmailDate']);
 assert.equal(emailTime({internalDateMs:'1791331200000',date:''}),1791331200000);
 assert.equal(emailTime({internalDateMs:null,date:'Tue, 06 Oct 2026 18:00:00 -0600'}),1791331200000);
 assert.equal(formatEmailDate({internalDateMs:'1791331200000',date:''},false,new Date('2026-10-07T00:01:00Z')).includes('2026'),true);
 assert.equal(formatEmailDate({internalDateMs:null,date:''}),'Date unavailable');
});
test('all rendered lists and threads sort newest first without mutating source chronological data',()=>{
 const {newestEmails}=load('artifacts/adventure-zone/src/features/emails/email-presentation.ts',['newestEmails']);
 const items=[{id:'old',internalDateMs:10},{id:'new',internalDateMs:'30'},{id:'middle',internalDateMs:20},{id:'unknown',internalDateMs:null}];
 assert.deepEqual(newestEmails(items).map(x=>x.id),['new','middle','old','unknown']);assert.equal(items[0].id,'old');
});

test('archive hydration preserves original HTML alongside plain text',()=>{
 const {messageFromRow}=load(apiDir+'google-profile-email-archive-repository.ts',['messageFromRow']);
 const row={id:'row',gmail_message_id:'m',gmail_thread_id:'t',from_value:'a',to_value:'b',cc_value:'',subject:'Event',date_value:'',body_text:'Event',body_html:'<b>Event</b>',direction:'incoming',internal_date_ms:'1791331200000',attachments_json:[]};
 assert.equal(messageFromRow(row).bodyHtml,'<b>Event</b>');
 assert.equal(messageFromRow({...row,body_html:null}).bodyHtml,undefined);
});

test('Gmail HTML stored as a MIME body attachment is read rather than dropped',async()=>{
 const {createGoogleWorkspaceReadClient}=load(apiDir+'google-api-client.ts',['createGoogleWorkspaceReadClient'],{Buffer});
 const html='<p>Large formatted proposal</p>',requests=[];
 const client=createGoogleWorkspaceReadClient({environment:{clientId:'id',clientSecret:'secret',redirectUri:'https://app.test/callback',appOrigin:'https://app.test'},refreshToken:'refresh',fetcher:async (url,init)=>{requests.push([String(url),init?.method]);return new Response(JSON.stringify(String(url).includes('/token')?{access_token:'token',expires_in:3600}:String(url).includes('/attachments/')?{data:Buffer.from(html).toString('base64url')}:{id:'t',messages:[{id:'m',internalDate:'1791331200000',payload:{mimeType:'text/html',body:{attachmentId:'large-body'}}}]}));}});
 const thread=await client.getThreadDetail('t');assert.equal(thread.messages[0].bodyHtml,html);assert.ok(requests.some(([url,method])=>url.includes('/messages/m/attachments/large-body') && !method));
});
test('email previews decode HTML entities as text without interpreting sender markup',()=>{
 const {emailPreviewText}=load('artifacts/adventure-zone/src/features/emails/email-presentation.ts',['emailPreviewText']);
 assert.equal(emailPreviewText('We don&#39;t &amp; &lt;b&gt;claim&lt;/b&gt;'),'We don\'t & <b>claim</b>');
});

test('archive upsert binds HTML to the existing message identity without creating another message',async()=>{
 const queries=[];
 const {PostgresGoogleProfileEmailArchiveRepository}=load(apiDir+'google-profile-email-archive-repository.ts',['PostgresGoogleProfileEmailArchiveRepository'],{defaultPool:{}});
 const db={query:async(sql,values)=>{queries.push({sql,values});return {rows:[{id:'conversation'}]};}};
 const repository=new PostgresGoogleProfileEmailArchiveRepository(db,'account');
 repository.getForOrganization=async()=>({id:'conversation'});
 await repository.upsertThread({organizationId:'profile',gmailThreadId:'thread',subject:'Event',contactId:null,originalGmailUrl:null,archiveState:'complete',lastSyncedAt:new Date('2026-10-07T00:00:00Z'),messages:[{gmailMessageId:'message',gmailThreadId:'thread',internalDateMs:1791331200000,from:'a',to:'b',cc:'',subject:'Event',date:'',direction:'incoming',bodyText:'Event',bodyHtml:'<b>Event</b>',attachments:[]}]});
 const insert=queries.find(q=>q.sql.includes('INSERT INTO google_workspace_profile_email_messages'));
 assert.equal(insert.values[2],'message');assert.equal(insert.values[14],'<b>Event</b>');assert.equal(insert.values.length,15);assert.ok(insert.sql.includes('body_html = EXCLUDED.body_html'));assert.ok(insert.sql.includes('ON CONFLICT (connection_id, gmail_message_id)'));
});
