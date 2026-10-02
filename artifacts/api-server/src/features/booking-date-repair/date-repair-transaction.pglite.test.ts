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
