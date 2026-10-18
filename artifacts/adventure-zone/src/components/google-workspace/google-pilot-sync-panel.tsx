import { useEffect,useState } from "react";
import { apiFetch } from "@/lib/auth-token";
import {GoogleMailboxSyncPanel} from './google-mailbox-sync-panel';
type Item={profileId:string;profileName:string;threadId:string;checkedAt:string|null;errorCode:string|null;ownerDecision:string|null;followups:{id:string;kind:string;dueAt:string|null}[];snapshot:{state:string;drafts:{id:string;bodyText:string}[];latestEmail?:{bodyText:string;subject:string}}|null};
const names:Record<string,string>={owner_decision:"Owner decision needed",draft_to_review:"Draft to review",draft_missing:"Draft missing — check Gmail",reply_to_review:"Reply to review",waiting_for_reply:"Waiting for reply",contact_blocked:"Contact needs fixing",needs_review:"Review needed"};
export function GooglePilotSyncPanel(){
 const [mode,setMode]=useState<string|null>(null);
 useEffect(()=>{let live=true;void apiFetch('/email-thread-attention/sync/status').then(async r=>r.ok?(await r.json()).mode:'off').then(value=>{if(live)setMode(value??'off');}).catch(()=>{if(live)setMode('off');});return()=>{live=false;};},[]);
 if(mode===null)return <p className="my-4 text-sm">Loading saved email status…</p>;
 return mode==='active'?<GoogleMailboxSyncPanel/>:<LegacyPilotSyncPanel/>;
}
function LegacyPilotSyncPanel(){
 const [items,setItems]=useState<Item[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 async function load(sync=false){
  setBusy(true);setError("");
  try {
   const res=await apiFetch("/email-thread-attention/pilot"+(sync?"/sync":""),sync?{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}:undefined);
   if(!res.ok)throw Error("Could not check pilot sync. Your saved records are unchanged.");
   setItems((await res.json()).items);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 useEffect(()=>{void load();},[]);
 return <section className="my-4 rounded-xl border bg-card p-4" aria-label="Customer email sync pilot">
  <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Customer email sync pilot</h2><button type="button" className="button-secondary" disabled={busy} onClick={()=>void load(true)}>{busy?"Checking…":"Check now"}</button></div>
  <p className="my-2 text-xs text-muted-foreground">Three conversations checked hourly. Saved views load without fetching Gmail. Follow-ups stay open until you review them.</p>
  {error&&<p role="alert">{error}</p>}
  <div className="grid gap-3 lg:grid-cols-3">{items.map(item=><article className="min-w-0 rounded border p-3" key={item.profileId}>
   <a className="font-semibold underline" href={`/profiles/${item.profileId}`}>{item.profileName}</a>
   <p className="my-2 font-medium">{item.errorCode?"Sync needs attention — showing last saved information":names[item.snapshot?.state??""]??"Awaiting first check"}</p>
   <p className="text-xs text-muted-foreground">Last synced: {item.checkedAt?new Date(item.checkedAt).toLocaleString():"Not yet"}</p>
   {item.ownerDecision&&<details className="mt-2"><summary>Saved decision / next action</summary><p className="text-sm">{item.ownerDecision}</p></details>}
   {item.snapshot?.drafts.map(draft=><details className="mt-2" key={draft.id}><summary>Current unsent draft</summary><p className="whitespace-pre-wrap break-words text-sm">{draft.bodyText}</p></details>)}
   {item.snapshot?.latestEmail&&<details className="mt-2"><summary>Latest email</summary><p className="whitespace-pre-wrap break-words text-sm">{item.snapshot.latestEmail.bodyText}</p></details>}
   <details className="mt-2"><summary>Open follow-ups ({item.followups.length})</summary><ul className="space-y-2 text-sm">{item.followups.map(f=><li key={f.id}>{f.kind} · {f.dueAt?new Date(f.dueAt).toLocaleDateString():"No date"}</li>)}</ul></details>
   <a className="mt-3 inline-block text-sm underline" href={`https://mail.google.com/mail/?authuser=theadventurezone12%40gmail.com#all/${encodeURIComponent(item.threadId)}`} target="_blank" rel="noopener noreferrer">Review in Gmail</a>
  </article>)}</div>
 </section>;
}
