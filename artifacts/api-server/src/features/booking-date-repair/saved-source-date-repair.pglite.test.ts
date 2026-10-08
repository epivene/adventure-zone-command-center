import { it,expect } from "vitest";
import { BookingDateRepairService } from "./date-repair-service";
import { repairDatabase,proposal,ids,noteId } from "./date-repair-test-setup";

const summary="2026-D • NFR Open • July 14–18, Norris Penrose\n\n- Access July 12–19; onsite camping only.\n- Follow separate directions for 2027.";
const pikesProposal=()=>({...proposal(),reason:"Reviewed Pikes Peak 2026 agreement summary",
 endpoints:proposal().endpoints.map(e=>({...e,value:e.field==="public_start"?"2026-07-14":"2026-07-18"}))});
it("previews and applies the saved human-readable range without rewriting notes or inferring an access window",async()=>{
 const {pg,db}=await repairDatabase();
 try{
  await pg.query("UPDATE activities SET body=$1 WHERE id=$2",[summary,noteId]);
  const service=new BookingDateRepairService(db as never);
  const preview=await service.preview(pikesProposal() as never,"owner");
  expect(preview.afterResolved.publicWindow).not.toBeNull();
  expect(preview.afterResolved.endpointEvidence).toEqual(expect.arrayContaining([
   expect.objectContaining({field:"public_start",value:"2026-07-14",sourceRef:expect.objectContaining({type:"saved_note",id:noteId})}),
   expect.objectContaining({field:"public_end",value:"2026-07-18"}),
  ]));
  expect(preview.afterResolved.reservationWindow).toBeNull();
  const receipt=await service.apply({previewId:preview.id,fingerprint:preview.fingerprint,requestKey:"pikes-saved-summary"},"owner");
  expect(receipt.bookingId).toBe(ids.booking);
  expect((await pg.query("SELECT body FROM activities WHERE id=$1",[noteId])).rows[0].body).toBe(summary);
  expect((await pg.query("SELECT value,source_revision FROM booking_date_evidence WHERE booking_id=$1 ORDER BY field",[ids.booking])).rows).toHaveLength(2);
 }finally{await pg.close();}
},30000);
it("still rejects source edits between preview and apply",async()=>{
 const {pg,db}=await repairDatabase();
 try{
  await pg.query("UPDATE activities SET body=$1 WHERE id=$2",[summary,noteId]);
  const service=new BookingDateRepairService(db as never);
  const preview=await service.preview(pikesProposal() as never,"owner");
  await pg.query("UPDATE activities SET body='2026-D • Event July 15–18' WHERE id=$1",[noteId]);
  await expect(service.apply({previewId:preview.id,fingerprint:preview.fingerprint,requestKey:"pikes-stale"},"owner")).rejects.toMatchObject({status:409});
  expect((await pg.query("SELECT * FROM booking_date_repair_receipts")).rows).toHaveLength(0);
 }finally{await pg.close();}
},30000);
