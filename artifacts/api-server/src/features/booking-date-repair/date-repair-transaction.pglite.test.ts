import { draft } from "../leg-planning/planning-fixtures";
import { afterEach,expect,it,vi } from "vitest";
import { BookingDateRepairService } from "./date-repair-service";
import { repairDatabase,proposal,ids,noteId } from "./date-repair-test-setup";
let fixture:Awaited<ReturnType<typeof repairDatabase>>;
afterEach(async()=>{await fixture?.pg.close();vi.unstubAllEnvs();vi.useRealTimers();});
const setup=async()=>{fixture=await repairDatabase();return new BookingDateRepairService(fixture.db as never);};
const applyInput=(p:{id:string;fingerprint:string},key="repair-one")=>({previewId:p.id,fingerprint:p.fingerprint,requestKey:key});
it("previews without changing dates and atomically applies exact source proof, preserving siblings/history/status/packages",async()=>{
 const service=await setup();const before=(await fixture.pg.query("SELECT * FROM bookings ORDER BY id")).rows;
 const packages=(await fixture.pg.query("SELECT * FROM booking_package_selections")).rows;
 const p=await service.preview(proposal() as never,"owner");
 expect((await fixture.pg.query("SELECT * FROM bookings ORDER BY id")).rows).toEqual(before);
 expect(p.after.rawPublic.start).toBe("2027-07-21T06:00:00.000Z");expect(p.impacts.blocked).toBe(false);
 const receipt=await service.apply(applyInput(p),"owner");
 expect(await service.apply(applyInput(p),"owner")).toEqual(receipt);
 const rows=await fixture.pg.query<{id:string;status:string;notes:string}>("SELECT * FROM bookings ORDER BY id");
 expect(rows.rows.find(r=>r.id===ids.otherBooking)).toEqual(before.find((r:any)=>r.id===ids.otherBooking));
 expect(rows.rows.find(r=>r.id===ids.booking)).toMatchObject({status:"lead",notes:"Keep history"});
 expect((await fixture.pg.query("SELECT * FROM booking_package_selections")).rows).toEqual(packages);
 expect((await fixture.pg.query<{n:number}>("SELECT count(*)::int n FROM booking_date_repair_receipts")).rows[0].n).toBe(1);
 expect((await fixture.pg.query<{n:number}>("SELECT count(*)::int n FROM audit_entries")).rows[0].n).toBe(1);
 await expect(service.apply({...applyInput(p),fingerprint:"different"},"owner")).rejects.toMatchObject({status:409});
},30000);
it.each([
 ["booking","UPDATE bookings SET name='changed' WHERE id='"+ids.booking+"'"],
 ["window","INSERT INTO booking_operational_windows VALUES('"+ids.booking+"','2027-07-20','2027-07-27','manual',now())"],
 ["source_revision","UPDATE activities SET updated_at=updated_at+interval '1 second' WHERE id='"+noteId+"'"],
 ["source","UPDATE activities SET body=body || ' changed' WHERE id='"+noteId+"'"],
 ["assignment","INSERT INTO booking_resource_assignments(booking_id,resource_id) VALUES('"+ids.booking+"','"+ids.resource+"')"],
 ["hold","INSERT INTO outreach_holds VALUES('"+ids.split+"','"+ids.booking+"','"+ids.leg+"','2027-07-20','2027-07-27','[]','{}','active','2030-01-01')"],
 ["plan","INSERT INTO leg_event_plans(booking_id,leg_id,draft) VALUES('"+ids.booking+"','"+ids.leg+"','"+JSON.stringify(draft())+"')"],
])("rejects stale %s without writes",async(_kind,mutation)=>{
 const service=await setup();const p=await service.preview(proposal() as never,"owner");await fixture.pg.exec(mutation);
 await expect(service.apply(applyInput(p),"owner")).rejects.toMatchObject({status:409});
 expect((await fixture.pg.query<{n:number}>("SELECT count(*)::int n FROM booking_date_repair_receipts")).rows[0].n).toBe(0);
},30000);
it("rejects a different actor and expiry, and replays even after expiry",async()=>{
 const service=await setup();const p=await service.preview(proposal() as never,"owner");
 await expect(service.apply(applyInput(p),"other")).rejects.toMatchObject({status:403});
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(p.expiresAt).getTime()+1);
 await expect(service.apply(applyInput(p),"owner")).rejects.toMatchObject({status:409});vi.useRealTimers();
 const fresh=await service.preview(proposal() as never,"owner");const receipt=await service.apply(applyInput(fresh),"owner");
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(fresh.expiresAt).getTime()+1);
 expect(await service.apply(applyInput(fresh),"owner")).toEqual(receipt);vi.useRealTimers();
},30000);
it("rolls all date/evidence/receipt writes back when audit persistence fails",async()=>{
 const service=await setup();const p=await service.preview(proposal() as never,"owner");
 await fixture.pg.exec("ALTER TABLE audit_entries ADD CONSTRAINT reject_audit CHECK(false)");
 await expect(service.apply(applyInput(p),"owner")).rejects.toThrow();
 expect((await fixture.pg.query("SELECT starts_at FROM bookings WHERE id='"+ids.booking+"'")).rows[0]).toEqual({starts_at:new Date("2026-01-01")});
 expect((await fixture.pg.query<{n:number}>("SELECT count(*)::int n FROM booking_date_evidence")).rows[0].n).toBe(0);
 expect((await fixture.pg.query<{n:number}>("SELECT count(*)::int n FROM booking_date_repair_receipts")).rows[0].n).toBe(0);
},30000);
it("blocks material changes while an active hold exists and refuses half a reservation clear",async()=>{
 const service=await setup();
 await fixture.pg.exec("INSERT INTO outreach_holds VALUES('"+ids.split+"','"+ids.booking+"','"+ids.leg+"','2026-01-01','2026-01-02','[]','{}','active','2030-01-01')");
 const p=await service.preview(proposal() as never,"owner");expect(p.impacts.blocked).toBe(true);
 await expect(service.apply(applyInput(p),"owner")).rejects.toMatchObject({status:409});
 await expect(service.preview({...proposal(),clearFields:["reservation_start"]} as never,"owner")).rejects.toMatchObject({status:400});
},30000);
it("rejects a sibling-only saved source and date values absent from selected evidence",async()=>{
 const service=await setup();
 await fixture.pg.exec("UPDATE activities SET booking_id='"+ids.otherBooking+"' WHERE id='"+noteId+"'");
 await expect(service.preview(proposal() as never,"owner")).rejects.toMatchObject({status:422});
 await fixture.pg.exec("UPDATE activities SET booking_id='"+ids.booking+"',body='Close date only' WHERE id='"+noteId+"'");
 await expect(service.preview(proposal() as never,"owner")).rejects.toMatchObject({status:422});
},30000);

it("filters a bounded review queue by independently proved season and reason",async()=>{
 const service=await setup();
 await fixture.pg.query("UPDATE bookings SET starts_at='2027-07-21T06:00:00Z' WHERE id=$1",[ids.booking]);
 await fixture.pg.query("INSERT INTO booking_date_evidence(booking_id,field,kind,value,semantics,revision,source_type,source_id,source_revision,actor) VALUES($1,'public_start','verified_event','2027-07-21','inclusive_date',1,'saved_note',$2,'1','owner')",[ids.booking,noteId]);
 const result=await service.queue({season:2027,reason:"INCOMPLETE_PUBLIC_WINDOW",limit:1} as never);
 expect(result.records.map(r=>r.bookingId)).toEqual([ids.booking]);expect(result.nextCursor).toBeNull();
},30000);


it("requires a fresh preview when the active-hold set changes through expiry",async()=>{
 const service=await setup(),start=Date.now();
 await fixture.pg.query("INSERT INTO outreach_holds VALUES($1,$2,$3,'2026-01-01','2026-01-02','[]','{}','active',$4::timestamptz)",[ids.split,ids.booking,ids.leg,new Date(start+60000).toISOString()]);
 const p=await service.preview(proposal() as never,"owner");expect(p.impacts.blocked).toBe(true);
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(start+120000);
 await expect(service.apply(applyInput(p),"owner")).rejects.toMatchObject({status:409});
},30000);


it("cannot bypass a verified signed-window obligation by first changing raw dates through a legacy writer",async()=>{
 const service=await setup(),first=await service.preview(proposal() as never,"owner");
 await service.apply(applyInput(first),"owner");
 await fixture.pg.query("UPDATE bookings SET status='contract_received',starts_at='2027-07-22T06:00:00Z' WHERE id=$1",[ids.booking]);
 await fixture.pg.query("UPDATE activities SET body=body || ' Proposed changed start 2027-07-22' WHERE id=$1",[noteId]);
 const changed=proposal();changed.endpoints[0].value="2027-07-22";
 const p=await service.preview(changed as never,"owner");expect(p.impacts.blocked).toBe(true);
 await expect(service.apply(applyInput(p,"legacy-bypass"),"owner")).rejects.toMatchObject({status:409});
},30000);

it("allows source confirmation and canonical encoding normalization without moving an assigned signed window",async()=>{
 const service=await setup(),first=await service.preview(proposal() as never,"owner");await service.apply(applyInput(first),"owner");
 await fixture.pg.query("UPDATE bookings SET status='contract_received',starts_at='2027-07-21T00:00:00Z',ends_at='2027-07-26T00:00:00Z' WHERE id=$1",[ids.booking]);
 await fixture.pg.query("INSERT INTO booking_resource_assignments(booking_id,resource_id) VALUES($1,$2)",[ids.booking,ids.resource]);
 const preview=await service.preview(proposal() as never,"owner");expect(preview.impacts.blocked).toBe(false);
 await service.apply(applyInput(preview,"same-window-confirmation"),"owner");
 expect((await fixture.pg.query<{status:string}>("SELECT status FROM bookings WHERE id=$1",[ids.booking])).rows[0].status).toBe("contract_received");
},30000);
it("applies and explicitly clears the whole reservation while retaining public proof and append-only history",async()=>{
 const service=await setup(),input=proposal();
 input.endpoints.push({field:"reservation_start",kind:"verified_reservation",value:"2027-07-20",semantics:"inclusive_date",sourceRef:{type:"saved_note",id:noteId}} as never,{field:"reservation_end",kind:"verified_reservation",value:"2027-07-27",semantics:"exclusive_date",sourceRef:{type:"saved_note",id:noteId}} as never);
 const p=await service.preview(input as never,"owner");await service.apply(applyInput(p),"owner");
 const clearing=proposal();clearing.endpoints=([{field:"reservation_start",kind:"unknown_import",value:null,semantics:"instant",sourceRef:{type:"saved_note",id:noteId}},{field:"reservation_end",kind:"unknown_import",value:null,semantics:"instant",sourceRef:{type:"saved_note",id:noteId}}] as never);clearing.clearFields=["reservation_start","reservation_end"] as never;
 const q=await service.preview(clearing as never,"owner");await service.apply(applyInput(q,"whole-reservation-clear"),"owner");
 const resolved=(await fixture.pg.query<{value:any}>("SELECT booking_resolved_dates(id,starts_at,ends_at,null,null) value FROM bookings WHERE id=$1",[ids.booking])).rows[0].value;
 expect(resolved.evidenceState).toBe("verified");expect(resolved.publicWindow).not.toBeNull();expect(resolved.reservationWindow).toBeNull();
 expect((await fixture.pg.query("SELECT * FROM booking_operational_windows WHERE booking_id=$1",[ids.booking])).rows).toHaveLength(0);
 expect((await fixture.pg.query("SELECT * FROM booking_date_evidence WHERE booking_id=$1 AND field LIKE 'reservation_%'",[ids.booking])).rows).toHaveLength(4);
},30000);

it("requires a separate record for a different independently verified event season",async()=>{
 const service=await setup(),first=await service.preview(proposal() as never,"owner");await service.apply(applyInput(first),"owner");
 await fixture.pg.query("UPDATE activities SET body=body || ' Next event 2028-07-21 through 2028-07-26' WHERE id=$1",[noteId]);
 const next=proposal();next.endpoints[0].value="2028-07-21";next.endpoints[1].value="2028-07-26";
 const p=await service.preview(next as never,"owner");expect(p.impacts.reasons).toContain("SEPARATE_SEASON_REQUIRES_NEW_BOOKING");expect(p.impacts.blocked).toBe(true);
},30000);

it.each(["contract_received","confirmed","completed","definite"])("records source proof while retaining unresolved-capacity warnings when the selected booking is %s",async(state)=>{
 const service=await setup();
 await fixture.pg.exec("ALTER TABLE bookings ADD COLUMN probability text");
 await fixture.pg.query("UPDATE bookings SET status=$1,probability=$2 WHERE id=$3",[state==="definite"?"new_lead":state,state==="definite"?"definite":"possible",ids.booking]);
 await fixture.pg.query("UPDATE bookings SET status='contract_received' WHERE id=$1",[ids.otherBooking]);
 const p=await service.preview(proposal() as never,"owner");
 expect(p.impacts.reasons).toContain("OTHER_COMMITMENT_DATE_REVIEW_REQUIRED");expect(p.impacts.blocked).toBe(false);
 await service.apply(applyInput(p),"owner");
},30000);

it("repairs two unresolved commitments sequentially while planning still reports the remaining unknown window",async()=>{
 const service=await setup();
 await fixture.pg.query("UPDATE bookings SET status='contract_received',starts_at=null,ends_at=null");
 const first=await service.preview(proposal() as never,"owner");
 expect(first.impacts.reasons).toContain("OTHER_COMMITMENT_DATE_REVIEW_REQUIRED");
 expect(first.impacts.blocked).toBe(false);
 await service.apply(applyInput(first,"first-commitment"),"owner");
 const unknown=(await fixture.pg.query<{value:any}>("SELECT booking_resolved_dates(id,starts_at,ends_at,null,null) value FROM bookings WHERE id=$1",[ids.otherBooking])).rows[0].value;
 expect(unknown.publicWindow).toBeNull();expect(unknown.evidenceState).toBe("needs_review");
 await fixture.pg.query("UPDATE activities SET booking_id=null,body=body || ' Second event 2027-08-01 through 2027-08-03' WHERE id=$1",[noteId]);
 const second=proposal();second.bookingId=ids.otherBooking;second.endpoints[0].value="2027-08-01";second.endpoints[1].value="2027-08-03";
 const p=await service.preview(second as never,"owner");expect(p.impacts.blocked).toBe(false);
 await service.apply(applyInput(p,"second-commitment"),"owner");
 expect((await fixture.pg.query<{n:number}>("SELECT count(*)::int n FROM bookings WHERE status='contract_received' AND booking_resolved_dates(id,starts_at,ends_at,null,null)->>'evidenceState'='verified'")).rows[0].n).toBe(2);
},30000);

it("explicitly reconciles a signed correction only after assignments are resolved and rejects changed sources",async()=>{
 const service=await setup(),first=await service.preview(proposal() as never,"owner");await service.apply(applyInput(first),"owner");
 await fixture.pg.query("UPDATE bookings SET status='contract_received' WHERE id=$1",[ids.booking]);
 await fixture.pg.query("UPDATE activities SET body=body || ' Corrected event start 2027-07-22' WHERE id=$1",[noteId]);
 const changed={...proposal(),reconcileConfirmedWindow:true};changed.endpoints[0].value="2027-07-22";
 await fixture.pg.query("INSERT INTO booking_resource_assignments(booking_id,resource_id) VALUES($1,$2)",[ids.booking,ids.resource]);
 const assigned=await service.preview(changed as never,"owner");expect(assigned.impacts.blocked).toBe(true);
 await fixture.pg.query("DELETE FROM booking_resource_assignments WHERE booking_id=$1",[ids.booking]);
 const ordinary=await service.preview({...changed,reconcileConfirmedWindow:false} as never,"owner");expect(ordinary.impacts.blocked).toBe(true);
 const reconciled=await service.preview(changed as never,"owner");expect(reconciled.impacts.blocked).toBe(false);
 expect((reconciled.impacts as any).confirmedWindowReview.before.publicWindow.start).toBe("2027-07-21T06:00:00.000Z");
 await fixture.pg.query("UPDATE activities SET body=body || ' revised' WHERE id=$1",[noteId]);
 await expect(service.apply(applyInput(reconciled,"stale-reconcile"),"owner")).rejects.toMatchObject({status:409});
 const fresh=await service.preview(changed as never,"owner");await service.apply(applyInput(fresh,"fresh-reconcile"),"owner");
 expect((await fixture.pg.query<{status:string}>("SELECT status FROM bookings WHERE id=$1",[ids.booking])).rows[0].status).toBe("contract_received");
},30000);

it("discovers exact legacy ACT source snapshots without endpoint evidence and excludes sibling snapshots",async()=>{
 const service=await setup(),source=ids.split,version=ids.resource,siblingVersion=ids.leg;
 await fixture.pg.exec("CREATE TABLE act_source_record_versions(id uuid PRIMARY KEY,source_record_id uuid,source_database_key text,raw_snapshot jsonb); CREATE TABLE act_external_links(entity_type text,entity_id uuid,source_record_id uuid,source_database_key text); CREATE TABLE act_imported_field_origins(entity_type text,entity_id uuid,source_record_id uuid,source_version_id uuid)");
 await fixture.pg.query("INSERT INTO act_source_record_versions VALUES($1,$2,'exact-db','{\"estimatedCloseDate\":\"2026-01-01\"}'),($3,$3,'sibling-db','{}')",[version,source,siblingVersion]);
 await fixture.pg.query("INSERT INTO act_external_links VALUES('booking',$1,$2,'exact-db'),('booking',$3,$4,'sibling-db')",[ids.booking,source,ids.otherBooking,siblingVersion]);
 const queue=await service.queue({bookingId:ids.booking});
 expect(queue.records[0].sources.some(s=>s.type==="act_source_version"&&s.id===version)).toBe(true);
 expect(queue.records[0].sources.some(s=>s.id===siblingVersion)).toBe(false);
 const classify={...proposal(),endpoints:[{field:"public_start",kind:"sales_milestone",value:"2026-01-01T00:00:00.000Z",semantics:"instant",sourceRef:{type:"act_source_version",id:version}}]};
 const p=await service.preview(classify as never,"owner");await service.apply(applyInput(p,"legacy-classify"),"owner");
 await expect(service.preview({...classify,endpoints:[{...classify.endpoints[0],sourceRef:{type:"act_source_version",id:siblingVersion}}]} as never,"owner")).rejects.toMatchObject({status:422});
},30000);

it("rejects unsupported instant offsets before applying a source-proved date",async()=>{
 const service=await setup(),input=proposal();input.endpoints[0].value="2027-07-21T12:00:00+16:00";input.endpoints[0].semantics="instant";
 await fixture.pg.query("UPDATE activities SET body=body || ' 2027-07-21T12:00:00+16:00' WHERE id=$1",[noteId]);
 await expect(service.preview(input as never,"owner")).rejects.toMatchObject({status:422});
},30000);
