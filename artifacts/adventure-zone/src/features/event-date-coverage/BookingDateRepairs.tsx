import { useSearch } from "wouter";
import { useRef,useState,type FormEvent } from "react";
import { useQuery,useQueryClient } from "@tanstack/react-query";
import { getDateRepairs,previewDateRepair,applyDateRepair,type Endpoint,type RepairRecord,type Preview,type Proposal } from "./booking-date-repairs-api";
import { notifyLegPlanningChanged } from "@/features/bookings/booking-operations-changes";
const fields=["public_start","public_end","reservation_start","reservation_end"] as const;
const labels={public_start:"Public start",public_end:"Public end",reservation_start:"Reservation start",reservation_end:"Reservation end"};
type FieldDraft={enabled:boolean;kind:Endpoint["kind"];value:string;semantics:Endpoint["semantics"];source:string;clear:boolean};
type Draft={reason:string;fields:Record<Endpoint["field"],FieldDraft>;revision:number};
function initial(record:RepairRecord):Draft{
 return {reason:"",revision:0,fields:Object.fromEntries(fields.map(field=>{
  const raw=field.startsWith("public_")?record.dateProvenance.rawPublic:record.dateProvenance.rawReservation;
  return [field,{enabled:field.startsWith("public_"),kind:"unknown_import",value:(field.endsWith("_start")?raw.start:raw.end)??"",semantics:"instant",source:"",clear:false}];
 })) as Draft["fields"]};
}
const display=(value:string|null)=>value??"Not recorded";
export function BookingDateRepairs(){
 const client=useQueryClient(),search=useSearch();
 const requestedBookingId=new URLSearchParams(search).get("bookingId")??undefined;
 const [selection,setSelection]=useState(""),selectedRef=useRef("");
 const [drafts,setDrafts]=useState<Record<string,Draft>>({});
 const draftRef=useRef(drafts);draftRef.current=drafts;
 const [preview,setPreview]=useState<Preview|null>(null),previewRef=useRef<Preview|null>(null);previewRef.current=preview;
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 const pending=useRef(false),generation=useRef(0),requestKeys=useRef(new Map<string,string>());
 const [cursor,setCursor]=useState<string|undefined>(),[savedPages,setSavedPages]=useState<RepairRecord[]>([]);
 const [season,setSeason]=useState(""),[reasonFilter,setReasonFilter]=useState("");
 const queue=useQuery({queryKey:["event-date-coverage","booking-date-repairs",requestedBookingId??"",season,reasonFilter,cursor??""],queryFn:()=>getDateRepairs({bookingId:requestedBookingId,after:cursor,limit:25,season:season?Number(season):undefined,reason:reasonFilter||undefined})});
 const records=[...savedPages,...(queue.data?.records??[])].filter((r,i,all)=>all.findIndex(x=>x.bookingId===r.bookingId)===i);
 const filtered=records.filter(r=>(!season||r.season===season)&&(!reasonFilter||r.dateProvenance.reviewReasons.includes(reasonFilter)));
 const detail=useQuery({queryKey:["event-date-coverage","booking-date-repair-detail",selection],queryFn:()=>getDateRepairs({bookingId:selection,limit:1}),enabled:Boolean(selection)});
 const record=detail.data?.records.find(r=>r.bookingId===selection)??records.find(r=>r.bookingId===selection),draft=record?drafts[selection]??initial(record):null;
 const select=(id:string)=>{
  generation.current++;selectedRef.current=id;setSelection(id);setPreview(null);setError("");setNotice("");setBusy(false);pending.current=false;
  const selected=records.find(r=>r.bookingId===id);
  if(selected)setDrafts(current=>current[id]?current:{...current,[id]:initial(selected)});
 };
 const edit=(change:(current:Draft)=>Draft)=>{
  if(!record)return;generation.current++;setPreview(null);setError("");setNotice("");
  setDrafts(current=>{const next=change(current[record.bookingId]??initial(record));return {...current,[record.bookingId]:{...next,revision:next.revision+1}};});
 };
 const fieldEdit=(field:Endpoint["field"],patch:Partial<FieldDraft>)=>edit(current=>({...current,fields:{...current.fields,[field]:{...current.fields[field],...patch}}}));
 async function createPreview(event:FormEvent,reconcileConfirmedWindow=false){
  event.preventDefault();if(!record||!draft||pending.current)return;
  const bookingId=record.bookingId,version=draft.revision,epoch=++generation.current;
  const endpoints:Proposal["endpoints"]=[],clearFields:Endpoint["field"][]=[];
  for(const field of fields){
   const value=draft.fields[field];if(!value.enabled)continue;
   const source=record.sources.find(s=>s.type+":"+s.id===value.source);
   if(!source){setError("Choose a saved source for every selected endpoint.");return;}
   endpoints.push({field,kind:value.kind,value:value.clear?null:value.value||null,semantics:value.semantics,sourceRef:{type:source.type,id:source.id}});
   if(value.clear)clearFields.push(field);
  }
  if(!endpoints.length){setError("Select at least one endpoint.");return;}
  pending.current=true;setBusy(true);setError("");setPreview(null);
  try{
   const result=await previewDateRepair({bookingId,reason:draft.reason,endpoints,clearFields,reconcileConfirmedWindow});
   if(generation.current===epoch&&selectedRef.current===bookingId&&draftRef.current[bookingId]?.revision===version)setPreview(result);
  }catch(cause){if(generation.current===epoch)setError(cause instanceof Error&&cause.message.includes("DATE_NOT_IN_SAVED_SOURCE")?"The selected source does not establish this endpoint. Check the saved event year, public versus access dates, and inclusive versus exclusive end. Choose the exact saved evidence; leave unsupported dates unresolved.":cause instanceof Error?cause.message:"Preview could not be created.");}
  finally{if(generation.current===epoch){pending.current=false;setBusy(false);}}
 }
 async function apply(){
  const current=previewRef.current;if(!current||current.impacts.blocked||pending.current||selectedRef.current!==current.bookingId)return;
  const epoch=++generation.current;pending.current=true;setBusy(true);setError("");
  let key=requestKeys.current.get(current.id);if(!key){key=crypto.randomUUID();requestKeys.current.set(current.id,key);}
  try{
   const receipt=await applyDateRepair({previewId:current.id,fingerprint:current.fingerprint,requestKey:key});
   notifyLegPlanningChanged({affectedBookingIds:current.impacts.affectedBookingIds,value:{seasonYear:Number(current.afterResolved.publicWindow?.start.slice(0,4))}});
   // Existing profile/map/calendar/readiness hooks and query clients share this notification.
   await client.invalidateQueries();
   setSavedPages([]);setCursor(undefined);
   if(generation.current===epoch){setPreview(null);setNotice("Repair saved. Refreshed booking, profile, schedule and readiness records. Receipt: "+receipt.id);}
  }catch(cause){
   if(generation.current===epoch){
    const stale=(cause as {status?:number})?.status===409;
    setError((cause instanceof Error?cause.message:"Repair could not be saved.")+(stale?" Create a fresh preview. Your draft is preserved.":" Your draft is preserved."));
    if(stale)setPreview(null);
   }
  }finally{if(generation.current===epoch){pending.current=false;setBusy(false);}}
 }
 return <section aria-label="Booking date repairs" className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
  <header><h2 className="text-xl font-bold">Booking date repairs</h2><p className="mt-1 text-sm text-muted-foreground">Select the exact historical booking and saved evidence. Public event dates and setup/travel reservations are reviewed separately.</p></header>
  <div className="grid gap-3 sm:grid-cols-2">
   <label className="grid gap-1 text-sm">Known verified season<input aria-label="Filter repair season" placeholder="e.g. 2027" value={season} type="number" min={1} max={9998} onChange={e=>{setSeason(e.target.value);setSavedPages([]);setCursor(undefined);select("");}}/></label>
   <label className="grid gap-1 text-sm">Review reason<select aria-label="Filter repair reason" value={reasonFilter} onChange={e=>{setReasonFilter(e.target.value);setSavedPages([]);setCursor(undefined);select("");}}><option value="">All reasons</option>{["INCOMPLETE_PUBLIC_WINDOW","INCOMPLETE_RESERVATION_WINDOW","REVERSED_PUBLIC_WINDOW","REVERSED_RESERVATION_WINDOW"].map(r=><option key={r}>{r}</option>)}</select></label>
  </div>
  <p className="text-xs text-muted-foreground">Review records are filtered by verified season and reason. Unknown seasons remain available without a season filter.</p>
  {queue.isError?<p role="alert">Review records could not be loaded. <button type="button" onClick={()=>queue.refetch()}>Retry</button></p>:null}
  <label className="grid gap-1 text-sm font-semibold">Exact booking<select aria-label="Exact booking" className="w-full min-w-0" value={selection} onChange={e=>select(e.target.value)}><option value="">Choose an exact booking</option>{filtered.map(r=><option key={r.bookingId} value={r.bookingId}>{r.name} · {r.season??"Season needs review"} · {r.packages.map(p=>(p.package_name?p.package_name+" · ":"")+p.package_template_id).join(", ")||"No package"} · Profile: {r.profileId??"Unlinked"} · Booking: {r.bookingId}</option>)}</select></label>
  {queue.data?.nextCursor?<button type="button" disabled={queue.isFetching} onClick={()=>{setSavedPages(records);setCursor(queue.data!.nextCursor!);}}>Load more review records</button>:null}
  {detail.isError?<p role="alert">Saved evidence could not be refreshed. <button type="button" onClick={()=>detail.refetch()}>Retry evidence</button></p>:null}
  {record&&draft?<div className="space-y-4">
   <div className="break-words text-sm"><p>Booking: {record.bookingId} · Profile: {record.profileId??"Unlinked"} · Commercial status: {record.status}</p><p>Assigned resources: {record.assignments.map(a=>a.resource_id).join(", ")||"Not recorded"}</p>
    <p>Raw public: {display(record.dateProvenance.rawPublic.start)} → {display(record.dateProvenance.rawPublic.end)}</p><p>Raw reservation: {display(record.dateProvenance.rawReservation.start)} → {display(record.dateProvenance.rawReservation.end)}</p>
    <p>Date state: {record.dateProvenance.evidenceState} · {record.dateProvenance.reviewReasons.join(", ")}</p>
    {!record.dateProvenance.publicWindow?<p>Public dates need evidence for both endpoints and the event year. A sales deadline or imported placeholder cannot establish event dates.</p>:null}
    {!record.dateProvenance.reservationWindow?<p>Reservation dates are not verified. Save separate setup/access evidence when equipment or crew must be reserved; public dates alone do not establish that window.</p>:null}
    {record.dateProvenance.endpointEvidence.map((e,i)=><p key={i}>{labels[e.field]}: {e.kind} · {e.semantics} · {e.sourceRef.type}:{e.sourceRef.id} · revision {e.sourceRef.revision}</p>)}
    {record.profileId?<a className="underline" href={"/event-profiles/"+encodeURIComponent(record.profileId)}>Create a separate season booking</a>:null}
   </div>
   <details className="rounded-lg border p-3" open><summary className="font-semibold">Saved sources</summary>{record.sources.length?record.sources.map(s=><article className="mt-3 break-words" key={s.type+":"+s.id}><p className="font-semibold">{s.label}</p><p className="text-xs">{s.type}:{s.id} · revision {s.revision}</p><p className="whitespace-pre-wrap text-sm">{s.content}</p>{s.contentTruncated?<p className="text-sm">Source excerpt truncated. Open the saved profile evidence to review the full source.</p>:null}{s.classifyOnly?<p className="text-sm">Sales/import classification only; this source cannot verify event dates.</p>:null}</article>):<p>No selectable saved evidence. Save or confirm evidence on the exact profile or booking first.</p>}</details>
   <form className="space-y-3" onSubmit={createPreview}>
    <div className="grid gap-3 lg:grid-cols-2">{fields.map(field=>{const f=draft.fields[field];return <fieldset className="min-w-0 space-y-2 rounded-lg border p-3" key={field}><legend className="px-1 font-semibold">{labels[field]}</legend>
     <label className="flex items-center gap-2"><input type="checkbox" aria-label={"Include "+field} checked={f.enabled} disabled={busy} onChange={e=>fieldEdit(field,{enabled:e.target.checked})}/>Review this endpoint</label>
     <label className="grid gap-1 text-sm">Saved source<select aria-label={"Source for "+field} value={f.source} disabled={!f.enabled||busy} onChange={e=>fieldEdit(field,{source:e.target.value})}><option value="">Choose saved evidence</option>{record.sources.map(s=><option key={s.type+":"+s.id} value={s.type+":"+s.id}>{s.label} · {s.type}:{s.id}</option>)}</select></label>
     <label className="grid gap-1 text-sm">Classification<select aria-label={"Classification for "+field} value={f.kind} disabled={!f.enabled||busy||f.clear} onChange={e=>fieldEdit(field,{kind:e.target.value as Endpoint["kind"]})}>{[field.startsWith("public_")?"verified_event":"verified_reservation","sales_milestone","unknown_import","unresolved_conflict"].map(kind=><option key={kind}>{kind}</option>)}</select></label>
     <label className="grid gap-1 text-sm">Value<input aria-label={"Value for "+field} value={f.value} disabled={!f.enabled||busy||f.clear} placeholder="YYYY-MM-DD or ISO timestamp" onChange={e=>fieldEdit(field,{value:e.target.value})}/></label>
     <label className="grid gap-1 text-sm">Date semantics<select aria-label={"Semantics for "+field} value={f.semantics} disabled={!f.enabled||busy} onChange={e=>fieldEdit(field,{semantics:e.target.value as Endpoint["semantics"]})}>{["instant","inclusive_date",...(field.endsWith("_end")?["exclusive_date"]:[])].map(value=><option key={value}>{value}</option>)}</select></label>
     <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={"Clear "+field} checked={f.clear} disabled={!f.enabled||busy} onChange={e=>fieldEdit(field,{clear:e.target.checked,...(e.target.checked?{kind:"unknown_import" as const}:{})})}/>Explicitly clear unsupported canonical value</label>
    </fieldset>;})}</div>
    <p className="text-sm text-muted-foreground">Clear both reservation endpoints together. Material edits to active commitments require existing reconciliation first.</p>
    <label className="grid gap-1 text-sm font-semibold">Reason<textarea aria-label="Repair reason" required minLength={8} maxLength={2000} value={draft.reason} disabled={busy} onChange={e=>edit(d=>({...d,reason:e.target.value}))}/></label>
    <button className="button-primary" disabled={busy||!record.sources.length} type="submit">{busy?"Working…":"Preview repair"}</button>
   </form>
   {preview?<section aria-label="Repair preview" className="space-y-3 rounded-lg border p-3">
    <h3 className="font-semibold">Repair preview</h3><p className="break-words text-sm">Exact booking: {preview.bookingId} · Preview expires {preview.expiresAt}</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Endpoint</th><th>Before</th><th>After</th><th>Semantics &amp; source</th></tr></thead><tbody>{fields.map(field=>{
     const old=field.startsWith("public_")?preview.before.rawPublic:preview.before.rawReservation,next=field.startsWith("public_")?preview.after.rawPublic:preview.after.rawReservation;
     const e=[...preview.after.evidence].reverse().find(e=>e.field===field);
     return <tr key={field} className="border-t align-top"><td>{labels[field]}</td><td className="break-all">{display(field.endsWith("_start")?old.start:old.end)}</td><td className="break-all">{display(field.endsWith("_start")?next.start:next.end)}</td><td className="break-all">{e?e.kind+" · "+e.semantics+" · "+e.sourceRef.type+":"+e.sourceRef.id+" · revision "+e.sourceRef.revision:"Unchanged evidence"}</td></tr>;
    })}</tbody></table></div>
    <p className="text-sm">Impacts: schedule, route and readiness facts will refresh for {preview.impacts.affectedBookingIds.join(", ")}.</p>
    {preview.impacts.confirmedWindowReview?<div className="space-y-2 rounded-lg border p-3 text-sm">
     <p className="font-semibold">Reconcile the existing signed window</p>
     <p className="break-words">Prior proved public dates: {display(preview.impacts.confirmedWindowReview.before.publicWindow?.start??null)} → {display(preview.impacts.confirmedWindowReview.before.publicWindow?.end??null)}</p>
     <p className="break-words">Prior proved reservation: {display(preview.impacts.confirmedWindowReview.before.reservationWindow?.start??null)} → {display(preview.impacts.confirmedWindowReview.before.reservationWindow?.end??null)}</p>
     <p>Review the proposed dates and saved source revisions above. Commercial status is preserved. Remaining hold, crew, equipment, committed-plan or trip obligations: {preview.impacts.confirmedWindowReview.obligationIds.join(", ")||"None"}. Resolve those obligations through their existing owner controls before reconciliation.</p>
     {preview.impacts.confirmedWindowReview.acknowledged?<p>Signed-window correction explicitly reconciled in this preview. Apply revalidates the exact windows, evidence and obligations.</p>:preview.impacts.confirmedWindowReview.canReconcile!==false&&preview.impacts.confirmedWindowReview.obligationIds.length===0?<button type="button" disabled={busy} onClick={event=>createPreview(event,true)}>Reconcile signed window and preview again</button>:null}
    </div>:null}
    {preview.impacts.reasons.includes("OTHER_COMMITMENT_DATE_REVIEW_REQUIRED")?<p className="text-sm text-amber-800">Other bookings still need date evidence. You can save this booking’s verified dates if there are no blocking conflicts. Capacity and operational readiness remain unverified until those bookings are reviewed.</p>:null}
    {preview.impacts.reasons.filter(reason=>reason!=="OTHER_COMMITMENT_DATE_REVIEW_REQUIRED").map(reason=><p className="text-sm text-amber-800" key={reason}>{reason}</p>)}
    {!preview.afterResolved.publicWindow||!preview.afterResolved.reservationWindow?<div className="rounded-lg border p-3 text-sm" aria-label="Remaining date evidence">
     <p className="font-semibold">Remaining date evidence</p>
     {!preview.afterResolved.publicWindow?<p>Public event dates are still incomplete or unverified. Save evidence for both endpoints and the correct year.</p>:null}
     {!preview.afterResolved.reservationWindow?<p>Setup/access reservation is still unverified. Public event dates do not reserve equipment or crew. Save separate access evidence when a reservation is needed.</p>:null}
     <p>Saving this repair preserves those unresolved checks.</p>
    </div>:null}
    <button className="button-primary" type="button" disabled={busy||preview.impacts.blocked} onClick={apply}>Apply reviewed repair</button>
   </section>:null}
  </div>:null}
  {error?<p className="break-words text-sm font-semibold text-rose-700" role="alert">{error}</p>:null}
  {notice?<p className="break-words text-sm" role="status">{notice}</p>:null}
 </section>;
}
