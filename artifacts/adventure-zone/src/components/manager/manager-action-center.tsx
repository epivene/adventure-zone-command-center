import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, MessageSquare } from "lucide-react";
import { useManagerAuth } from "@/lib/manager-auth-context";

type Item={id:string;label:string;beforeValue:string|null;afterValue:string|null};
type Ack={id:string;status:"waiting_acknowledgment"|"acknowledged"|"needs_admin_review"|"resolved";sourceType?:string;title:string;managerComment?:string|null;items:Item[]};

export function ManagerActionCenter(){
  const {managerApi}=useManagerAuth();
  const [items,setItems]=useState<Ack[]>([]);
  const [comments,setComments]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);

  const load=useCallback(async()=>{
    const data=await managerApi<{acknowledgments:Ack[]}>("/manager/acknowledgments");
    setItems(data.acknowledgments??[]);
  },[managerApi]);

  useEffect(()=>{
    void load().catch(()=>{});
    const timer=window.setInterval(()=>void load().catch(()=>{}),5000);
    return()=>window.clearInterval(timer);
  },[load]);

  async function submit(id:string,withComment:boolean){
    if(busy) return;
    setBusy(id);setError(null);
    try{
      const comment=withComment?(comments[id]??"").trim():"";
      const data=await managerApi<{acknowledgment:Ack}>(`/manager/acknowledgments/${id}/acknowledge`,{method:"POST",body:JSON.stringify({comment:comment||null})});
      if(data.acknowledgment.status==="acknowledged"||data.acknowledgment.status==="resolved") setItems(current=>current.filter(row=>row.id!==id));
      else setItems(current=>current.map(row=>row.id===id?data.acknowledgment:row));
    }catch(e){setError(e instanceof Error?e.message:"Could not acknowledge change");}
    finally{setBusy(null);}
  }

  if(!items.length) return null;
  return <section aria-label="Changes needing your attention" className="mx-auto mt-3 grid max-w-3xl gap-3 px-4">
    {items.map(item=><article className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm" key={item.id}>
      <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"/><div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-wider text-amber-800">{item.sourceType==="manager_message"?"Acknowledgment required":"Admin updated your leg"}</p><h2 className="font-bold text-slate-900">{item.title}</h2></div></div>
      <div className="mt-3 grid gap-2">{item.items.map(change=><div className="rounded-lg bg-white/80 px-3 py-2 text-sm" key={change.id}><p className="font-semibold">{change.label}</p>{change.beforeValue?<p className="text-slate-600">{change.beforeValue} → <span className="font-semibold text-slate-900">{change.afterValue??"Not set"}</span></p>:<p className="whitespace-pre-wrap text-slate-900">{change.afterValue??"Not set"}</p>}</div>)}</div>
      {item.status==="needs_admin_review"?<div className="mt-3 flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-amber-800"><MessageSquare className="h-4 w-4"/>Waiting for admin review{item.managerComment?` — ${item.managerComment}`:""}</div>:<>
        <label className="mt-3 block text-sm font-semibold">Optional comment<textarea aria-label="Optional comment" className="mt-1 min-h-16 w-full rounded-lg border bg-white p-2 font-normal" onChange={event=>setComments(current=>({...current,[item.id]:event.target.value}))} placeholder="Ask a question or flag a concern…" value={comments[item.id]??""}/></label>
        <div className="mt-2 flex flex-wrap gap-2"><button className="button-primary" disabled={busy===item.id} onClick={()=>void submit(item.id,false)} type="button"><Check className="mr-1 inline h-4 w-4"/>Acknowledge</button><button className="button-secondary" disabled={busy===item.id||!(comments[item.id]??"").trim()} onClick={()=>void submit(item.id,true)} type="button">Acknowledge & Send Comment</button></div>
      </>}
    </article>)}
    {error?<p className="text-sm font-semibold text-red-600" role="alert">{error}</p>:null}
  </section>;
}
