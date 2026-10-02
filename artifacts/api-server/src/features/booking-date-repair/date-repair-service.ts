import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { planningWriterTransaction } from "../leg-planning/planning-writer-hooks";
import type { AllocationDatabase } from "../outreach-planner/outreach-allocation";
import { recordAuditEntry } from "../audit/audit-service";
import { repairProposalSchema,repairApplySchema,repairQueueSchema,type RepairProposalInput } from "./date-repair-dto";
import { resolveBookingDates,dateEndpointInstant,type EndpointEvidence,type DateEvidenceInput,type DateRepairPreview,type ApplyDateRepairInput,type DateRepairReceipt } from "./date-evidence";
import { BookingDateRepairRepository,query,hash,fail,type RepairSnapshot,type RepairSource,type Row } from "./date-repair-repository";
import type { PlanningDatabase } from "../leg-planning/planning-repository";

export type ReviewedPreview=DateRepairPreview&{
 beforeResolved:ReturnType<typeof resolveBookingDates>;afterResolved:ReturnType<typeof resolveBookingDates>;
 selection:{bookingId:string;name:string;profileId:string|null;status:string;packages:Row[]};
};
type StoredPreview={proposal:RepairProposalInput;preview:ReviewedPreview};
const endpointRaw=(input:DateEvidenceInput,field:EndpointEvidence["field"])=>{
 const window=field.startsWith("public_")?input.rawPublic:input.rawReservation;
 return field.endsWith("_start")?window.start:window.end;
};
const setRaw=(input:DateEvidenceInput,field:EndpointEvidence["field"],value:string|null)=>{
 const window=field.startsWith("public_")?input.rawPublic:input.rawReservation;
 if(field.endsWith("_start"))window.start=value;else window.end=value;
};
export class BookingDateRepairService {
 readonly repository=new BookingDateRepairRepository();
 constructor(readonly database:AllocationDatabase,readonly clock=()=>new Date()){}
 private proposal(value:RepairProposalInput):RepairProposalInput{
  const parsed=repairProposalSchema.safeParse(value);
  if(!parsed.success)fail(400,"INVALID_DATE_REPAIR_PROPOSAL");
  const p=parsed.data,clear=new Set(p.clearFields);
  if(clear.size!==p.clearFields.length||[...clear].some(f=>!p.endpoints.some(e=>e.field===f)))fail(400,"CLEAR_REQUIRES_SOURCE_CLASSIFICATION");
  if(clear.has("reservation_start")!==clear.has("reservation_end"))fail(400,"CLEAR_WHOLE_RESERVATION_REQUIRED");
  for(const e of p.endpoints){
   if(e.semantics==="exclusive_date"&&e.field.endsWith("_start"))fail(400,"EXCLUSIVE_START_INVALID");
   if(clear.has(e.field)&&(e.value!==null||e.kind.startsWith("verified")))fail(400,"CLEAR_REQUIRES_UNKNOWN_CLASSIFICATION");
   if(e.kind.startsWith("verified")&&e.kind!==(e.field.startsWith("public_")?"verified_event":"verified_reservation"))fail(400,"ENDPOINT_KIND_MISMATCH");
  }
  return p;
 }
 private async proposed(tx:PlanningDatabase,p:RepairProposalInput,snapshot:RepairSnapshot,lock=false){
  const after=structuredClone(snapshot.input),sources:RepairSource[]=[];
  for(const endpoint of [...p.endpoints].sort((a,b)=>(a.sourceRef.type+a.sourceRef.id+a.field).localeCompare(b.sourceRef.type+b.sourceRef.id+b.field))){
   const source=await this.repository.source(tx,snapshot,endpoint.sourceRef,lock);sources.push(source);
   if(endpoint.kind.startsWith("verified")){
    const instant=dateEndpointInstant(endpoint.value,endpoint.semantics,endpoint.field);
    if(!instant)fail(422,"INVALID_VERIFIED_DATE");
    const allowed=source.allowed?.[endpoint.field];
    if(source.classifyOnly||source.allowed&&(!allowed||allowed.value!==endpoint.value||allowed.semantics!==endpoint.semantics))fail(422,"SOURCE_DOES_NOT_PROVE_ENDPOINT");
    if(!source.allowed&&(!endpoint.value||!source.content.includes(endpoint.value)))fail(422,"DATE_NOT_IN_SAVED_SOURCE");
    setRaw(after,endpoint.field,instant);
   }else if(p.clearFields.includes(endpoint.field))setRaw(after,endpoint.field,null);
   else if(endpoint.value!==endpointRaw(snapshot.input,endpoint.field)&&endpoint.kind!=="sales_milestone")fail(422,"CLASSIFICATION_MUST_PRESERVE_RAW_VALUE");
   const revision=Math.max(0,...snapshot.input.evidence.filter(e=>e.field===endpoint.field).map(e=>e.revision))+1;
   after.evidence.push({...endpoint,sourceRef:{type:source.type,id:source.id,revision:source.revision},revision});
  }
  // NOT NULL reservations are all or nothing. Public endpoints may remain explicitly partial.
  if(Boolean(after.rawReservation.start)!==Boolean(after.rawReservation.end))fail(422,"COMPLETE_RESERVATION_REQUIRED");
  const resolved=resolveBookingDates(after);
  if(resolved.reviewReasons.some(r=>r.startsWith("REVERSED_")))fail(422,"REVERSED_DATE_WINDOW");
  return {after,sources};
 }
 private impacts(snapshot:RepairSnapshot,after:DateEvidenceInput){
  const resolved=resolveBookingDates(after),before=snapshot.resolved,op=snapshot.operational;
  const rows=(table:string)=>op[table].map(r=>r.value);
  const id=snapshot.booking.id;
  const material=hash({public:before.publicWindow,reservation:before.reservationWindow,raw: snapshot.input.rawPublic,rawReservation:snapshot.input.rawReservation})
   !==hash({public:resolved.publicWindow,reservation:resolved.reservationWindow,raw:after.rawPublic,rawReservation:after.rawReservation});
  const holds=rows("outreach_holds").filter(r=>r.booking_id===id&&r.state==="active"&&new Date(r.expires_at)>this.clock());
  const resources=rows("booking_resource_assignments").filter(r=>r.booking_id===id);
  const crew=rows("leg_plan_crew_commitments").filter(r=>r.booking_id===id);
  const plans=rows("leg_event_plans").filter(r=>r.booking_id===id&&r.committed);
  const trips=rows("trip_stops").filter(r=>r.booking_id===id);
  const reasons:string[]=[];
  if(material&&(holds.length||resources.length||crew.length||plans.length||trips.length))reasons.push("RECONCILE_EXISTING_COMMITMENTS_FIRST");
  // An already evidenced signed reservation is an obligation even before individual assignments.
  if(material&&["confirmed","signed","booked"].includes(snapshot.booking.status)&&(before.reservationWindow||before.publicWindow))reasons.push("RECONCILE_CONFIRMED_WINDOW_FIRST");
  const affected=new Set<string>([id]);
  for(const hold of holds)if(hold.booking_id)affected.add(hold.booking_id);
  const target=resolved.reservationWindow??resolved.publicWindow;
  if(material&&target&&["confirmed","signed","booked"].includes(snapshot.booking.status)){
   const end=new Date(target.end).getTime()-((resolved.reservationWindow?resolved.reservationEndExclusive:resolved.publicEndExclusive)?1:0);
   const targetPackages=rows("booking_package_selections").filter(r=>r.booking_id===id).map(r=>r.package_template_id);
   const selectedResources=resources.map(r=>r.resource_id);
   for(const other of rows("bookings").filter(r=>r.id!==id&&["confirmed","signed","booked"].includes(r.status))){
    // Other unresolved obligations prevent a definitive capacity claim.
    const dates=other.date_provenance;
    const unsupported=(dates.rawReservation.start||dates.rawReservation.end)&&!dates.reservationWindow;
    const window=unsupported?null:dates.reservationWindow??dates.publicWindow;
    const start=window?Date.parse(window.start):NaN,otherEnd=window?Date.parse(window.end)-((dates.reservationWindow?dates.reservationEndExclusive:dates.publicEndExclusive)?1:0):NaN;
    if(!Number.isFinite(start)||!Number.isFinite(otherEnd)||new Date(otherEnd).getUTCFullYear()>=9999){
     affected.add(other.id);reasons.push("OTHER_COMMITMENT_DATE_REVIEW_REQUIRED");continue;
    }
    if(start<=end&&otherEnd>=Date.parse(target.start)){
     const shared=other.travel_leg_id&&other.travel_leg_id===snapshot.booking.travel_leg_id
       ||rows("booking_resource_assignments").some(r=>r.booking_id===other.id&&selectedResources.includes(r.resource_id));
     if(shared){affected.add(other.id);reasons.push("OVERLAPPING_COMMITMENT");}
     for(const packageId of targetPackages){
      const overlapping=rows("booking_package_selections").filter(r=>r.package_template_id===packageId&&r.booking_id!==id).filter(r=>{
       const b=rows("bookings").find(b=>b.id===r.booking_id);if(!b||!["confirmed","signed","booked"].includes(b.status))return false;
       const dates=b.date_provenance;
       const w=(dates.rawReservation.start||dates.rawReservation.end)&&!dates.reservationWindow?null:dates.reservationWindow??dates.publicWindow;
       return !w||Date.parse(w.start)<=end&&Date.parse(w.end)-((dates.reservationWindow?dates.reservationEndExclusive:dates.publicEndExclusive)?1:0)>=Date.parse(target.start);
      });
      const template=rows("package_templates").find(r=>r.id===packageId);
      if(!template||overlapping.length+1>Math.max(0,Number(template.normal_capacity)-Number(template.temporary_unavailable_quantity??0))){
       reasons.push("PACKAGE_CAPACITY_REVIEW_REQUIRED");overlapping.forEach(r=>affected.add(r.booking_id));
      }
     }
    }
   }
  }
  return {reasons:[...new Set(reasons)],affectedBookingIds:[...affected].sort(),blocked:reasons.length>0};
 }
 async preview(value:RepairProposalInput,actorId:string):Promise<ReviewedPreview>{
  if(!actorId)fail(403,"OWNER_ACTOR_REQUIRED");
  const p=this.proposal(value);
  return this.database.transaction(async tx=>{
   const snapshot=await this.repository.snapshot(tx,p.bookingId),{after,sources}=await this.proposed(tx,p,snapshot);
   const preview:ReviewedPreview={id:randomUUID(),bookingId:p.bookingId,actorId,expiresAt:new Date(this.clock().getTime()+30*60*1000).toISOString(),
    fingerprint:hash({snapshot,proposal:p,sources:sources.map(s=>({type:s.type,id:s.id,revision:s.revision}))}),
    before:snapshot.input,after,impacts:this.impacts(snapshot,after),beforeResolved:snapshot.resolved,afterResolved:resolveBookingDates(after),
    selection:{bookingId:p.bookingId,name:snapshot.booking.name,profileId:snapshot.booking.organization_id??null,status:snapshot.booking.status,
     packages:snapshot.operational.booking_package_selections.filter(r=>r.value.booking_id===p.bookingId).map(r=>r.value)}};
   await tx.execute(sql`INSERT INTO booking_date_repair_previews(id,booking_id,actor,fingerprint,payload,expires_at)
    VALUES(${preview.id}::uuid,${p.bookingId}::uuid,${actorId},${preview.fingerprint},${JSON.stringify({proposal:p,preview})}::jsonb,${preview.expiresAt}::timestamptz)`);
   return preview;
  },{isolationLevel:"repeatable read"});
 }
 async apply(value:ApplyDateRepairInput,actorId:string):Promise<DateRepairReceipt>{
  const parsed=repairApplySchema.safeParse(value);if(!parsed.success)fail(400,"INVALID_APPLY_INPUT");
  if(!actorId)fail(403,"OWNER_ACTOR_REQUIRED");
  const input=parsed.data,requestFingerprint=hash({previewId:input.previewId,fingerprint:input.fingerprint});
  return planningWriterTransaction(this.database,async tx=>{
   const receiptRows=await query(tx,sql`SELECT * FROM booking_date_repair_receipts WHERE actor=${actorId} AND request_key=${input.requestKey}`);
   if(receiptRows.length){
    const receipt=receiptRows[0];if(receipt.request_fingerprint!==requestFingerprint)fail(409,"REQUEST_KEY_PAYLOAD_MISMATCH");
    return {id:receipt.id,bookingId:receipt.booking_id,previewId:receipt.preview_id,requestKey:receipt.request_key,appliedAt:new Date(receipt.applied_at).toISOString()};
   }
   const [row]=await query(tx,sql`SELECT * FROM booking_date_repair_previews WHERE id=${input.previewId}::uuid FOR SHARE`);
   if(!row)fail(404,"PREVIEW_NOT_FOUND");
   if(row.actor!==actorId)fail(403,"PREVIEW_ACTOR_MISMATCH");
   if(row.fingerprint!==input.fingerprint||new Date(row.expires_at)<=this.clock())fail(409,"PREVIEW_STALE_OR_EXPIRED");
   const saved=row.payload as StoredPreview,p=this.proposal(saved.proposal);
   const snapshot=await this.repository.snapshot(tx,p.bookingId,true);
   let proposed:Awaited<ReturnType<BookingDateRepairService["proposed"]>>;
   try{proposed=await this.proposed(tx,p,snapshot,true);}catch(error){if((error as {status?:number}).status===422)fail(409,"SOURCE_STALE");throw error;}
   const {after,sources}=proposed;
   if(hash({snapshot,proposal:p,sources:sources.map(s=>({type:s.type,id:s.id,revision:s.revision}))})!==input.fingerprint)fail(409,"PREVIEW_STALE");
   const impacts=this.impacts(snapshot,after);if(impacts.blocked)fail(409,impacts.reasons.join(","));
   await tx.execute(sql`UPDATE bookings SET starts_at=${after.rawPublic.start}::timestamptz,ends_at=${after.rawPublic.end}::timestamptz,updated_at=now() WHERE id=${p.bookingId}::uuid`);
   if(p.clearFields.includes("reservation_start"))await tx.execute(sql`DELETE FROM booking_operational_windows WHERE booking_id=${p.bookingId}::uuid`);
   else if(p.endpoints.some(e=>e.field.startsWith("reservation_")&&e.kind==="verified_reservation")){
    await tx.execute(sql`INSERT INTO booking_operational_windows(booking_id,starts_at,ends_at,source)
     VALUES(${p.bookingId}::uuid,${after.rawReservation.start}::timestamptz,${after.rawReservation.end}::timestamptz,'reviewed_timestamp')
     ON CONFLICT(booking_id) DO UPDATE SET starts_at=excluded.starts_at,ends_at=excluded.ends_at,source=excluded.source,updated_at=now()`);
   }
   const appended=after.evidence.slice(snapshot.input.evidence.length);
   for(const e of appended)await tx.execute(sql`INSERT INTO booking_date_evidence(booking_id,field,kind,value,semantics,revision,source_type,source_id,source_revision,actor)
    VALUES(${p.bookingId}::uuid,${e.field},${e.kind},${e.value},${e.semantics},${e.revision},${e.sourceRef.type},${e.sourceRef.id},${e.sourceRef.revision},${actorId})`);
   const receipt:DateRepairReceipt={id:randomUUID(),bookingId:p.bookingId,previewId:input.previewId,requestKey:input.requestKey,appliedAt:this.clock().toISOString()};
   const beforeValues={...snapshot.input,resolved:snapshot.resolved},afterValues={...after,resolved:resolveBookingDates(after)};
   await tx.execute(sql`INSERT INTO booking_date_repair_receipts(id,booking_id,preview_id,actor,request_key,request_fingerprint,before_values,after_values,source_references,reason,impacts,applied_at)
    VALUES(${receipt.id}::uuid,${p.bookingId}::uuid,${input.previewId}::uuid,${actorId},${input.requestKey},${requestFingerprint},
     ${JSON.stringify(beforeValues)}::jsonb,${JSON.stringify(afterValues)}::jsonb,${JSON.stringify(appended.map(e=>e.sourceRef))}::jsonb,${p.reason},${JSON.stringify(impacts)}::jsonb,${receipt.appliedAt}::timestamptz)`);
   await recordAuditEntry(tx,{entityType:"booking_date_repair",entityId:p.bookingId,action:"apply",before:beforeValues,after:{...afterValues,receipt,reason:p.reason,impacts,actorId}});
   return receipt;
  },"booking-date-repair","commitment");
 }
 async queue(value:{bookingId?:string;after?:string;limit?:number}){
  const parsed=repairQueueSchema.safeParse(value);if(!parsed.success)fail(400,"INVALID_QUEUE_QUERY");
  const q=parsed.data;
  const rows=await query(this.database,sql`SELECT b.id FROM bookings b LEFT JOIN booking_operational_windows w ON w.booking_id=b.id
   WHERE (${q.bookingId??null}::uuid IS NULL OR b.id=${q.bookingId??null}::uuid)
   AND (${q.after??null}::uuid IS NULL OR b.id>${q.after??null}::uuid)
   AND (${q.bookingId??null}::uuid IS NOT NULL OR booking_resolved_dates(b.id,b.starts_at,b.ends_at,w.starts_at,w.ends_at)->>'evidenceState'='needs_review')
   ORDER BY b.id LIMIT ${q.limit+1}`);
  const records=[];
  for(const r of rows.slice(0,q.limit)){
   const snapshot=await this.repository.snapshot(this.database,r.id);
   records.push({bookingId:r.id,profileId:snapshot.booking.organization_id??null,name:snapshot.booking.name,status:snapshot.booking.status,
    season:snapshot.resolved.verifiedPublicStart?.slice(0,4)??null,dateProvenance:snapshot.resolved,
    packages:snapshot.operational.booking_package_selections.filter(s=>s.value.booking_id===r.id).map(s=>s.value),
    assignments:snapshot.operational.booking_resource_assignments.filter(s=>s.value.booking_id===r.id).map(s=>s.value),
    sources:await this.repository.sources(this.database,snapshot)});
  }
  return {records,nextCursor:rows.length>q.limit?records.at(-1)?.bookingId??null:null};
 }
}
