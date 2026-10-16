import type { GoogleMessagePage } from './google-api-types';

export type HistoryPage = {historyId:string;nextPageToken:string|null;changedThreads:string[]};
export type SyncFailureKind = 'expired_cursor'|'source_missing'|'retryable'|'auth'|'invalid';
export class SyncFailure extends Error {
  constructor(public kind:SyncFailureKind, public code:string, public retryAfterMs?:number) { super(code); }
}
export function syncFailure(error:unknown, history=false):SyncFailure {
  if(error instanceof SyncFailure) return error;
  const e=error as {code?:string;retryAfterSeconds?:number};
  const code=e?.code??'';
  if(code.includes('SOURCE_NOT_FOUND')) return new SyncFailure(history?'expired_cursor':'source_missing','SYNC_SOURCE_MISSING');
  if(/AUTHENTICATED|REAUTHORIZATION|SCOPE|PERMISSION/.test(code)) return new SyncFailure('auth','SYNC_REAUTH_REQUIRED');
  return new SyncFailure('retryable','SYNC_PROVIDER_UNAVAILABLE',e?.retryAfterSeconds?e.retryAfterSeconds*1000:undefined);
}
export interface MailboxChangeClient {
  getMailbox():Promise<{email:string;historyId:string}>;
  listHistory(input:{startHistoryId:string;pageToken?:string}):Promise<HistoryPage>;
  listMessagesPage(input:{query:string;pageToken?:string}):Promise<GoogleMessagePage>;
  listDraftsPage(pageToken?:string):Promise<GoogleMessagePage>;
}
const base='https://gmail.googleapis.com/gmail/v1/users/me';
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
function id(v:unknown):string { if(typeof v!=='string'||!v.trim())throw new SyncFailure('invalid','SYNC_INVALID_RESPONSE');return v; }
function cursor(v:unknown):string {const s=id(v);if(!/^\d+$/.test(s))throw new SyncFailure('invalid','SYNC_INVALID_RESPONSE');return s;}
function token(v:unknown):string|null {return v===undefined?null:id(v);}
function array(v:unknown):unknown[] {if(v===undefined)return [];if(!Array.isArray(v))throw new SyncFailure('invalid','SYNC_INVALID_RESPONSE');return v;}
export function createMailboxChangeClient(read:(url:string)=>Promise<Record<string,unknown>>):MailboxChangeClient {
  async function get(path:string,params:Record<string,string>,history=false){
    try {const url=new URL(base+path);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);return await read(url.toString());}
    catch(e){throw syncFailure(e,history);}
  }
  function refs(values:unknown){return array(values).map(v=>{const m=record(v);return {id:id(m.id),threadId:id(m.threadId)};});}
  return {
    async getMailbox(){const p=await get('/profile',{});return {email:id(p.emailAddress),historyId:cursor(p.historyId)};},
    async listHistory(input){
      const p=await get('/history',{startHistoryId:cursor(input.startHistoryId),maxResults:'100',...(input.pageToken?{pageToken:input.pageToken}:{})},true);
      const threads=new Set<string>();
      for(const entry of array(p.history)){
        const h=record(entry);
        for(const m of refs(h.messages))threads.add(m.threadId);
        for(const key of ['messagesAdded','messagesDeleted','labelsAdded','labelsRemoved']){
          for(const change of array(h[key]))threads.add(id(record(record(change).message).threadId));
        }
      }
      return {historyId:cursor(p.historyId),nextPageToken:token(p.nextPageToken),changedThreads:[...threads]};
    },
    async listMessagesPage(input){const p=await get('/messages',{q:input.query,maxResults:'100',...(input.pageToken?{pageToken:input.pageToken}:{})});return {messages:refs(p.messages),nextPageToken:token(p.nextPageToken)};},
    async listDraftsPage(pageToken){const p=await get('/drafts',{maxResults:'100',...(pageToken?{pageToken}:{})});return {messages:refs(array(p.drafts).map(d=>record(d).message)),nextPageToken:token(p.nextPageToken)};},
  };
}
