import { afterEach,expect,it } from "vitest";
import { BookingDateRepairService } from "./date-repair-service";
import { repairDatabase,proposal,ids,noteId } from "./date-repair-test-setup";
let fixture:Awaited<ReturnType<typeof repairDatabase>>;
afterEach(async()=>{await fixture?.pg.close();});
const setup=async()=>{fixture=await repairDatabase();return new BookingDateRepairService(fixture.db as never);};
const applyInput=(p:{id:string;fingerprint:string},requestKey:string)=>({previewId:p.id,fingerprint:p.fingerprint,requestKey});
it.each([
 ["HAFFE","The Gmail invitation says the 2026 showcase application deadline is Sept. 1. Current HAFFE information confirms the Nov. 19-21, 2026 Minot convention includes showcases and associate/vendor activity.","2026-11-19","2026-11-21"],
 ["SnowWiesn","Reviewed the full 2022 email thread before the September 1, 2026 reply. Known details: the 2026 event runs weekends August 29-October 18; the booking is Possible; proposed in 2022.","2026-08-29","2026-10-18"],
])("saves %s public proof without inventing a reservation",async(name,body,start,end)=>{
 const service=await setup(),input=proposal();
 await fixture.pg.query("UPDATE activities SET body=$1 WHERE id=$2",[body,noteId]);
 input.endpoints[0].value=start;input.endpoints[1].value=end;
 const preview=await service.preview(input as never,"owner");
 expect(preview.afterResolved.publicWindow).not.toBeNull();
 expect(preview.afterResolved.reservationWindow).toBeNull();
 await service.apply(applyInput(preview,name),"owner");
 expect((await fixture.pg.query("SELECT * FROM booking_operational_windows WHERE booking_id=$1",[ids.booking])).rows).toHaveLength(0);
},30000);
it.each([2,1])("counts proved package overlaps independently of unknown dates at capacity %s",async(capacity)=>{
 const service=await setup();
 await fixture.pg.query("UPDATE bookings SET status='contract_received',travel_leg_id=null");
 await fixture.pg.query("UPDATE bookings SET starts_at='2027-07-21T06:00:00Z',ends_at='2027-07-27T05:59:59.999Z' WHERE id=$1",[ids.otherBooking]);
 await fixture.pg.query("INSERT INTO bookings(id,name,status,organization_id) VALUES($1,'Unknown dates','contract_received',$2)",[ids.split,"10000000-0000-4000-8000-000000000002"]);
 await fixture.pg.query("INSERT INTO booking_package_selections VALUES($1,$3),($2,$3)",[ids.otherBooking,ids.split,ids.package]);
 await fixture.pg.query("UPDATE package_templates SET normal_capacity=$1",[capacity]);
 for(const [field,value] of [["public_start","2027-07-21"],["public_end","2027-07-26"]])
  await fixture.pg.query("INSERT INTO booking_date_evidence(booking_id,field,kind,value,semantics,revision,source_type,source_id,source_revision,actor) VALUES($1,$2,'verified_event',$3,'inclusive_date',1,'saved_note',$4,'fixture','owner')",[ids.otherBooking,field,value,noteId]);
 const preview=await service.preview(proposal() as never,"owner");
 expect(preview.impacts.reasons).toContain("OTHER_COMMITMENT_DATE_REVIEW_REQUIRED");
 expect(preview.impacts.blocked).toBe(capacity===1);
 if(capacity===1){
  expect(preview.impacts.reasons).toContain("PACKAGE_CAPACITY_REVIEW_REQUIRED");
  await expect(service.apply(applyInput(preview,"blocked"),"owner")).rejects.toMatchObject({status:409});
 }else{
  expect(preview.impacts.reasons).not.toContain("PACKAGE_CAPACITY_REVIEW_REQUIRED");
  await service.apply(applyInput(preview,"saved"),"owner");
 }
 expect((await fixture.pg.query<{value:any}>("SELECT booking_resolved_dates(id,starts_at,ends_at,null,null) value FROM bookings WHERE id=$1",[ids.split])).rows[0].value.publicWindow).toBeNull();
},30000);
