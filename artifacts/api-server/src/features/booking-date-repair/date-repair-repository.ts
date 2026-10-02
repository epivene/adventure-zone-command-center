import { sql, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";
import { planningRows, PlanningError, type PlanningDatabase } from "../leg-planning/planning-repository";
import type { DateEvidenceInput, EndpointEvidence, ResolvedDates } from "./date-evidence";
import { parseOperationalEventDateText } from "../google-workspace/calendar/operational-calendar-matcher";
import type { RepairProposalInput } from "./date-repair-dto";

export type Row=Record<string,any>;
export const hash=(value:unknown):string=>{
 const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==="object"
  ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,stable(x)])):v;
 return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
};
export const query=async<T extends Row=Row>(db:PlanningDatabase,q:SQL)=>planningRows<T>(await db.execute(q));
export const fail=(status:number,code:string):never=>{throw new PlanningError(status,code);};
export type RepairSource={type:string;id:string;revision:string;label:string;content:string;allowed?:Partial<Record<EndpointEvidence["field"],{value:string;semantics:EndpointEvidence["semantics"]}>>;classifyOnly?:boolean};
export type RepairSnapshot={booking:Row;window:Row|null;input:DateEvidenceInput;resolved:ResolvedDates;operational:Record<string,Row[]>};
const tables=["booking_date_evidence","bookings","booking_operational_windows","booking_package_selections","booking_resource_assignments","booking_leg_assignments","trips","trip_stops","trip_resource_assignments","outreach_holds","leg_event_plans","leg_plan_crew_commitments","leg_season_plans","crew_availability","package_sets","package_set_members","resources","package_templates","leg_plan_splits","leg_plan_authorities","leg_plan_approval_requests","leg_plan_approval_decisions"] as const;
export class BookingDateRepairRepository {
 async snapshot(tx:PlanningDatabase,bookingId:string,lock=false):Promise<RepairSnapshot>{
  if(lock){const row=await query(tx,sql`SELECT id FROM bookings WHERE id=${bookingId}::uuid FOR UPDATE`);if(!row.length)fail(404,"BOOKING_NOT_FOUND");
   await tx.execute(sql`SELECT booking_id FROM booking_operational_windows WHERE booking_id=${bookingId}::uuid FOR UPDATE`);}
  const [row]=await query(tx,sql`SELECT to_jsonb(b) AS booking,to_jsonb(w) AS window,
   booking_resolved_dates(b.id,b.starts_at,b.ends_at,w.starts_at,w.ends_at) AS resolved
   FROM bookings b LEFT JOIN booking_operational_windows w ON w.booking_id=b.id WHERE b.id=${bookingId}::uuid`);
  if(!row)fail(404,"BOOKING_NOT_FOUND");
  const evidence=await query(tx,sql`SELECT field,kind,value,semantics,revision,
    jsonb_build_object('type',source_type,'id',source_id,'revision',source_revision) AS "sourceRef"
    FROM booking_date_evidence WHERE booking_id=${bookingId}::uuid ORDER BY field,revision,source_type,source_id,source_revision`);
  const operational:Record<string,Row[]>={};
  for(const table of tables)operational[table]=table==="bookings"
   ? await query(tx,sql`SELECT to_jsonb(b)||jsonb_build_object('date_provenance',booking_resolved_dates(b.id,b.starts_at,b.ends_at,w.starts_at,w.ends_at)) AS value FROM bookings b LEFT JOIN booking_operational_windows w ON w.booking_id=b.id ORDER BY b.id`)
   : await query(tx,sql.raw("SELECT to_jsonb(t) AS value FROM "+table+" t ORDER BY to_jsonb(t)::text"));
  return {booking:row.booking,window:row.window,resolved:row.resolved,input:{bookingId,
   rawPublic:row.resolved.rawPublic,rawReservation:row.resolved.rawReservation,evidence:evidence as EndpointEvidence[]},operational};
 }
 async source(tx:PlanningDatabase,snapshot:RepairSnapshot,ref:RepairProposalInput["endpoints"][number]["sourceRef"],lock=false):Promise<RepairSource>{
  const booking=snapshot.booking,share=lock?sql` FOR SHARE`:sql``;
  let records:Row[]=[];
  if(ref.type==="saved_note"){
   records=await query(tx,sql`SELECT * FROM activities WHERE id=${ref.id}::uuid AND deleted_at IS NULL AND
    (booking_id=${booking.id}::uuid OR (booking_id IS NULL AND organization_id=${booking.organization_id}::uuid))${share}`);
   if(!records.length)fail(422,"SOURCE_OUTSIDE_BOOKING");
   const r=records[0];return {...ref,revision:hash(r),label:r.subject??"Saved note",content:r.body??""};
  }
  if(ref.type==="saved_event_fact"){
   records=await query(tx,sql`SELECT * FROM event_date_facts WHERE id=${ref.id}::uuid AND organization_id=${booking.organization_id}::uuid AND active=true AND status='confirmed' AND verified_at IS NOT NULL${share}`);
   if(!records.length)fail(422,"SOURCE_NOT_CONFIRMED");
   const r=records[0];return {...ref,revision:hash(r),label:r.source_title??"Confirmed event fact",content:JSON.stringify(r),
    allowed:{public_start:{value:r.starts_on,semantics:"inclusive_date"},...(r.ends_on?{public_end:{value:r.ends_on,semantics:"inclusive_date" as const}}:{})}};
  }
  if(ref.type==="google_calendar_review"){
   records=await query(tx,sql`SELECT * FROM google_operational_calendar_reviews WHERE id=${ref.id}::uuid AND booking_id=${booking.id}::uuid AND state='accepted'${share}`);
   if(!records.length)fail(422,"SOURCE_NOT_ACCEPTED");
   const r=records[0],p=r.proposed_changes?.parsed??{},g=r.proposed_changes?.google??{};
   const actual=parseOperationalEventDateText(p.actualEventDateText??null,Number(String(g.startDate).slice(0,4)));
   return {...ref,revision:hash(r),label:"Accepted calendar review",content:JSON.stringify(r.proposed_changes),
    allowed:{...(g.startDate?{reservation_start:{value:g.startDate,semantics:"inclusive_date" as const}}:{}),
     ...(g.endDateExclusive?{reservation_end:{value:g.endDateExclusive,semantics:"exclusive_date" as const}}:{}),
     ...(actual?{public_start:{value:actual.startsAt.toISOString().slice(0,10),semantics:"inclusive_date" as const},public_end:{value:actual.endsAt.toISOString().slice(0,10),semantics:"inclusive_date" as const}}:{})}};
  }
  if(ref.type==="business_document"){
   const [document]=await query(tx,sql`SELECT * FROM business_documents WHERE id=${ref.id}::uuid AND lifecycle='active' AND review_state='accepted'${share}`);
   if(!document)fail(422,"SOURCE_NOT_ACCEPTED");
   const links=await query(tx,sql`SELECT * FROM business_document_links WHERE document_id=${ref.id}::uuid
    AND (booking_id=${booking.id}::uuid OR (booking_id IS NULL AND organization_id=${booking.organization_id}::uuid))${share}`);
   if(!links.length)fail(422,"SOURCE_OUTSIDE_BOOKING");
   const [version]=await query(tx,sql`SELECT * FROM business_document_versions WHERE id=${document.current_version_id}::uuid AND document_id=${ref.id}::uuid${share}`);
   if(!version)fail(422,"SOURCE_VERSION_MISSING");
   const [blob]=await query(tx,sql`SELECT * FROM business_document_blobs WHERE id=${version.blob_id}::uuid AND validation_state='accepted'${share}`);
   if(!blob)fail(422,"SOURCE_QUARANTINED");
   return {...ref,revision:hash({document,links,version,blob}),label:document.display_name,content:document.notes??""};
  }
  if(ref.type==="act_source_version"){
   const proof=snapshot.input.evidence.filter(e=>e.sourceRef.type==="act_source_record"&&e.sourceRef.revision===ref.id);
   if(!proof.length)fail(422,"SOURCE_OUTSIDE_BOOKING");
   const [version]=await query(tx,sql`SELECT * FROM act_source_record_versions WHERE id=${ref.id}::uuid${share}`);
   if(!version)fail(422,"SOURCE_VERSION_MISSING");
   return {...ref,revision:hash(version),label:"ACT source (classification only)",content:JSON.stringify(version.raw_snapshot),classifyOnly:true};
  }
  const proof=snapshot.input.evidence.filter(e=>e.sourceRef.type==="leg_plan_mutation_receipt"&&e.sourceRef.id===ref.id);
  if(!proof.length)fail(422,"SOURCE_OUTSIDE_BOOKING");
  const [receipt]=await query(tx,sql`SELECT * FROM leg_plan_mutation_receipts WHERE id=${ref.id}::uuid${share}`);
  if(!receipt)fail(422,"SOURCE_VERSION_MISSING");
  return {...ref,revision:hash(receipt),label:"Committed planning receipt",content:JSON.stringify(receipt),
   allowed:Object.fromEntries(proof.filter(e=>e.value&&e.kind==="verified_reservation").map(e=>[e.field,{value:e.value!,semantics:e.semantics}]))};
 }
 async sources(tx:PlanningDatabase,snapshot:RepairSnapshot):Promise<RepairSource[]>{
  const b=snapshot.booking;
  const refs:Array<{type:RepairProposalInput["endpoints"][number]["sourceRef"]["type"];id:string}>=[];
  const append=(type:typeof refs[number]["type"],records:Row[])=>records.forEach(r=>refs.push({type,id:r.id}));
  append("saved_note",await query(tx,sql`SELECT id FROM activities WHERE deleted_at IS NULL AND (booking_id=${b.id}::uuid OR (booking_id IS NULL AND organization_id=${b.organization_id}::uuid)) ORDER BY updated_at DESC,id LIMIT 30`));
  append("saved_event_fact",await query(tx,sql`SELECT id FROM event_date_facts WHERE organization_id=${b.organization_id}::uuid AND active=true AND status='confirmed' AND verified_at IS NOT NULL LIMIT 10`));
  append("google_calendar_review",await query(tx,sql`SELECT id FROM google_operational_calendar_reviews WHERE booking_id=${b.id}::uuid AND state='accepted' ORDER BY reviewed_at DESC,id LIMIT 20`));
  append("business_document",await query(tx,sql`SELECT DISTINCT d.id FROM business_documents d JOIN business_document_links l ON l.document_id=d.id WHERE d.lifecycle='active' AND d.review_state='accepted' AND (l.booking_id=${b.id}::uuid OR (l.booking_id IS NULL AND l.organization_id=${b.organization_id}::uuid)) LIMIT 30`));
  for(const e of snapshot.input.evidence){
   if(e.sourceRef.type==="act_source_record")refs.push({type:"act_source_version",id:e.sourceRef.revision});
   if(e.sourceRef.type==="leg_plan_mutation_receipt")refs.push({type:"leg_plan_mutation_receipt",id:e.sourceRef.id});
  }
  const sources:RepairSource[]=[];
  for(const ref of refs.filter((r,i,all)=>all.findIndex(x=>x.type===r.type&&x.id===r.id)===i)){
   try{sources.push(await this.source(tx,snapshot,ref));}catch(e){if(!(e instanceof PlanningError))throw e;}
  }
  return sources;
 }
}
