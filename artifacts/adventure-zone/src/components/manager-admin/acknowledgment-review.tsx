import { useState } from "react";

type Ack={id:string;title:string;managerComment:string|null;items:Array<{id:string;label:string;beforeValue:string|null;afterValue:string|null}>};
export function AcknowledgmentReview({acknowledgment,onResolve}:{acknowledgment:Ack;onResolve:(id:string,response:string)=>Promise<void>}){
  const [response,setResponse]=useState("");const [busy,setBusy]=useState(false);
  async function resolve(){if(busy)return;setBusy(true);try{await onResolve(acknowledgment.id,response.trim());}finally{setBusy(false);}}
  return <article className="rounded-xl border bg-white p-4">
    <h3 className="font-bold">{acknowledgment.title}</h3>
    <div className="mt-2 grid gap-2">{acknowledgment.items.map(item=><div className="rounded-lg bg-slate-50 px-3 py-2 text-sm" key={item.id}><p className="font-semibold">{item.label}</p><p>{item.beforeValue??"Not set"} → <strong>{item.afterValue??"Not set"}</strong></p></div>)}</div>
    {acknowledgment.managerComment?<div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p className="font-semibold">Manager comment</p><p>{acknowledgment.managerComment}</p></div>:null}
    <label className="mt-3 block text-sm font-semibold">Admin response<textarea aria-label="Admin response" className="mt-1 min-h-20 w-full rounded-lg border p-2 font-normal" onChange={event=>setResponse(event.target.value)} value={response}/></label>
    <button className="button-primary mt-2" disabled={busy} onClick={()=>void resolve()} type="button">{busy?"Resolving…":"Resolve"}</button>
  </article>;
}
