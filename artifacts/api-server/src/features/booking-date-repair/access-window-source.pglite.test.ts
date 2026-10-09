import { it,expect } from "vitest";
import { BookingDateRepairService } from "./date-repair-service";
import { repairDatabase,proposal,ids,noteId } from "./date-repair-test-setup";
import { applyOperationalWindowsToCalendarBookings } from "../google-workspace/calendar/calendar-operational-window-projection";

const summary="2026-D • NFR Open • July 14–18, Norris Penrose\n\n- Access July 12–19; onsite camping only.";
const accessProposal=()=>({
 ...proposal(),reason:"Reviewed Pikes Peak 2026 public and access dates",
 endpoints:[
  {field:"public_start",kind:"verified_event",value:"2026-07-14",semantics:"inclusive_date",sourceRef:{type:"saved_note",id:noteId}},
  {field:"public_end",kind:"verified_event",value:"2026-07-18",semantics:"inclusive_date",sourceRef:{type:"saved_note",id:noteId}},
  {field:"reservation_start",kind:"verified_reservation",value:"2026-07-12",semantics:"inclusive_date",sourceRef:{type:"saved_note",id:noteId}},
  {field:"reservation_end",kind:"verified_reservation",value:"2026-07-19",semantics:"inclusive_date",sourceRef:{type:"saved_note",id:noteId}},
 ],
});
it("enforces the production source check rather than accepting virtual projection tags",async()=>{
 const {pg}=await repairDatabase();
 try{
  await expect(pg.query("INSERT INTO booking_operational_windows(booking_id,starts_at,ends_at,source) VALUES($1,'2026-07-12','2026-07-20','reviewed_timestamp')",[ids.booking])).rejects.toMatchObject({code:"23514"});
  expect((await pg.query("SELECT * FROM booking_operational_windows")).rows).toHaveLength(0);
 }finally{await pg.close();}
},30000);
it.each(["insert","update"])("saves July 12–19 access via %s with production constraints and preserves inclusive endpoints",async mode=>{
 const {pg,db}=await repairDatabase();
 try{
  await pg.query("UPDATE activities SET body=$1 WHERE id=$2",[summary,noteId]);
  if(mode==="update")await pg.query("INSERT INTO booking_operational_windows(booking_id,starts_at,ends_at,source) VALUES($1,'2026-07-10','2026-07-21','google_calendar')",[ids.booking]);
  const before=(await pg.query("SELECT * FROM bookings WHERE id=$1",[ids.booking])).rows[0];
  const service=new BookingDateRepairService(db as never);
  const preview=await service.preview(accessProposal() as never,"owner");
  expect(preview.impacts.blocked).toBe(false);
  expect(preview.after.rawReservation).toEqual({start:"2026-07-12T06:00:00.000Z",end:"2026-07-20T05:59:59.999Z"});
  const input={previewId:preview.id,fingerprint:preview.fingerprint,requestKey:"pikes-access-"+mode};
  const receipt=await service.apply(input,"owner");
  expect(await service.apply(input,"owner")).toEqual(receipt);
  const rows=(await pg.query("SELECT * FROM booking_operational_windows WHERE booking_id=$1",[ids.booking])).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({source:"manual",starts_at:new Date(preview.after.rawReservation.start!),ends_at:new Date(preview.after.rawReservation.end!)});
  const value=(await pg.query<{value:any}>("SELECT booking_resolved_dates(b.id,b.starts_at,b.ends_at,w.starts_at,w.ends_at) AS value FROM bookings b JOIN booking_operational_windows w ON w.booking_id=b.id WHERE b.id=$1",[ids.booking])).rows[0].value;
  expect(value.reservationWindow).toEqual(preview.afterResolved.reservationWindow);
  expect(value.publicWindow).toEqual(preview.afterResolved.publicWindow);
  expect(value.reservationEndExclusive).toBe(false);
  // Display semantics come from saved endpoint evidence, not the storage tag.
  const [calendar]=applyOperationalWindowsToCalendarBookings([{id:ids.booking,startsAt:null,endsAt:null,dateProvenance:value}],[]);
  expect(calendar.endsAt?.toISOString()).toBe("2026-07-20T05:59:59.999Z");
  expect(calendar.actualEndsAt?.toISOString()).toBe("2026-07-19T05:59:59.999Z");
  expect((await pg.query("SELECT body FROM activities WHERE id=$1",[noteId])).rows[0].body).toBe(summary);
  expect((await pg.query("SELECT status,notes FROM bookings WHERE id=$1",[ids.booking])).rows[0]).toMatchObject({status:before.status,notes:before.notes});
  expect((await pg.query("SELECT * FROM booking_date_repair_receipts")).rows).toHaveLength(1);
  expect((await pg.query("SELECT * FROM booking_date_evidence WHERE booking_id=$1",[ids.booking])).rows).toHaveLength(4);
 }finally{await pg.close();}
},30000);
it("rolls the access window and evidence back when the repair audit cannot save",async()=>{
 const {pg,db}=await repairDatabase();
 try{
  await pg.query("UPDATE activities SET body=$1 WHERE id=$2",[summary,noteId]);
  const service=new BookingDateRepairService(db as never);
  const preview=await service.preview(accessProposal() as never,"owner");
  await pg.exec("ALTER TABLE audit_entries ADD CONSTRAINT reject_access_audit CHECK(false)");
  await expect(service.apply({previewId:preview.id,fingerprint:preview.fingerprint,requestKey:"failed-access"},"owner")).rejects.toThrow();
  for(const table of ["booking_operational_windows","booking_date_evidence","booking_date_repair_receipts"])
   expect((await pg.query("SELECT * FROM "+table)).rows).toHaveLength(0);
 }finally{await pg.close();}
},30000);
