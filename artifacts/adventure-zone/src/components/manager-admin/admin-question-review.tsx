import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/auth-token";

type Question = {
  id: string;
  travelLegId: string;
  bookingId: string | null;
  tripId: string | null;
  question: string;
  urgency: "normal" | "urgent";
  status: "needs_answer" | "answered" | "resolved";
  escalationReason: string;
  contextSnapshot?: any;
  createdAt?: string;
};
type Response = { id:string; actor_type?:string; actorType?:string; actor_id?:string; actorId?:string; body:string; created_at?:string; createdAt?:string };

function contextLines(snapshot: any): string[] {
  const values: string[] = [];
  if (snapshot?.leg?.name) values.push(`Leg: ${snapshot.leg.name}`);
  if (snapshot?.activeEvent?.name) values.push(`Event: ${snapshot.activeEvent.name}`);
  if (snapshot?.activeContext?.label && !snapshot?.activeEvent?.name) values.push(`Context: ${snapshot.activeContext.label}`);
  if (snapshot?.route?.label) values.push(`Route: ${snapshot.route.label}`);
  if (Array.isArray(snapshot?.handoffs) && snapshot.handoffs.length) values.push(`${snapshot.handoffs.length} equipment meetup${snapshot.handoffs.length === 1 ? "" : "s"} checked`);
  if (Array.isArray(snapshot?.acknowledgments) && snapshot.acknowledgments.length) values.push(`${snapshot.acknowledgments.length} acknowledgment${snapshot.acknowledgments.length === 1 ? "" : "s"} checked`);
  return values;
}

export function AdminQuestionReview({ question, onChanged }: { question: Question; onChanged: () => Promise<void> | void }) {
  const [responses,setResponses]=useState<Response[]>([]);
  const [reply,setReply]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [showKnowledge,setShowKnowledge]=useState(false);
  const [knowledgeTitle,setKnowledgeTitle]=useState("");
  const [knowledgeBody,setKnowledgeBody]=useState("");
  const [scope,setScope]=useState<"global"|"leg">("leg");
  const context=useMemo(()=>contextLines(question.contextSnapshot),[question.contextSnapshot]);

  async function loadThread(){
    try{const data=await apiGet<{responses:Response[]}>(`/admin/manager-assistant/questions/${question.id}`);setResponses(data.responses??[]);}catch(e){setError(e instanceof Error?e.message:"Could not load question thread");}
  }
  useEffect(()=>{void loadThread();},[question.id]);

  async function respond(){
    if(!reply.trim()||busy)return;setBusy(true);setError("");
    try{await apiPost(`/admin/manager-assistant/questions/${question.id}/respond`,{body:reply.trim()});setReply("");await loadThread();await onChanged();}
    catch(e){setError(e instanceof Error?e.message:"Could not send response");}finally{setBusy(false);}
  }
  async function resolve(){
    if(busy)return;setBusy(true);setError("");
    try{await apiPost(`/admin/manager-assistant/questions/${question.id}/resolve`,{});await onChanged();}
    catch(e){setError(e instanceof Error?e.message:"Could not resolve question");}finally{setBusy(false);}
  }
  function prepareKnowledge(){
    const lastAdmin=[...responses].reverse().find((row)=>(row.actor_type??row.actorType)==="admin");
    setKnowledgeTitle(question.question.slice(0,160));
    setKnowledgeBody(lastAdmin?.body??"");
    setShowKnowledge(true);
  }
  async function promote(){
    if(!knowledgeTitle.trim()||!knowledgeBody.trim()||busy)return;setBusy(true);setError("");
    try{await apiPost(`/admin/manager-assistant/questions/${question.id}/promote`,{title:knowledgeTitle.trim(),body:knowledgeBody.trim(),scope,scopeRecordId:scope==="leg"?question.travelLegId:null});setShowKnowledge(false);}
    catch(e){setError(e instanceof Error?e.message:"Could not save operations knowledge");}finally{setBusy(false);}
  }

  return <article className={`rounded-xl border bg-white p-4 shadow-sm ${question.urgency==="urgent"?"border-rose-300":"border-slate-200"}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${question.urgency==="urgent"?"bg-rose-100 text-rose-800":"bg-slate-100 text-slate-700"}`}>{question.urgency==="urgent"?"Urgent":"Normal"}</span><span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">{question.status.replace("_"," ")}</span></div><h3 className="mt-2 text-lg font-bold">{question.question}</h3></div>
      {question.createdAt?<time className="text-xs text-slate-500">{new Date(question.createdAt).toLocaleString()}</time>:null}
    </div>
    <p className="mt-2 text-sm text-slate-600"><b>Why it escalated:</b> {question.escalationReason}</p>
    {context.length?<div className="mt-3 rounded-lg bg-slate-50 p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Attached context</p><ul className="mt-1 grid gap-1 text-sm text-slate-700">{context.map(line=><li key={line}>{line}</li>)}</ul></div>:null}
    {responses.length?<div className="mt-3 grid gap-2">{responses.map(row=><div key={row.id} className="rounded-lg border border-slate-100 p-3"><p className="text-xs font-bold text-slate-500">{(row.actor_type??row.actorType)==="admin"?"Admin":"Manager"}</p><p className="mt-1 whitespace-pre-wrap text-sm">{row.body}</p></div>)}</div>:null}
    {question.status!=="resolved"?<div className="mt-3"><textarea className="min-h-20 w-full rounded-lg border border-slate-300 p-2 text-sm" placeholder="Answer the manager…" value={reply} onChange={event=>setReply(event.target.value)} maxLength={12000}/><div className="mt-2 flex flex-wrap gap-2"><button className="button-primary" disabled={busy||!reply.trim()} onClick={()=>void respond()} type="button">Send answer</button><button className="button-secondary" disabled={busy} onClick={()=>void resolve()} type="button">Resolve</button>{responses.some(row=>(row.actor_type??row.actorType)==="admin")?<button className="button-secondary" onClick={prepareKnowledge} type="button">Save as reusable knowledge</button>:null}</div></div>:null}
    {showKnowledge?<div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-3"><h4 className="font-bold">Reusable operations knowledge</h4><p className="mt-1 text-xs text-slate-600">This is explicit and reviewable. It will not change the booking or route.</p><input className="mt-3 w-full rounded-lg border p-2 text-sm" value={knowledgeTitle} onChange={e=>setKnowledgeTitle(e.target.value)} placeholder="Title"/><textarea className="mt-2 min-h-24 w-full rounded-lg border p-2 text-sm" value={knowledgeBody} onChange={e=>setKnowledgeBody(e.target.value)} placeholder="Reusable answer"/><select className="mt-2 rounded-lg border p-2 text-sm" value={scope} onChange={e=>setScope(e.target.value as "global"|"leg")}><option value="leg">This leg</option><option value="global">All legs</option></select><div className="mt-2 flex gap-2"><button className="button-primary" disabled={busy||!knowledgeTitle.trim()||!knowledgeBody.trim()} onClick={()=>void promote()} type="button">Save knowledge</button><button className="button-secondary" onClick={()=>setShowKnowledge(false)} type="button">Cancel</button></div></div>:null}
    {error?<p className="mt-3 text-sm font-semibold text-rose-700" role="alert">{error}</p>:null}
  </article>;
}
