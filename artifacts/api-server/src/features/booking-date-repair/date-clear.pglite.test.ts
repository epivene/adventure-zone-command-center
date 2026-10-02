import { it,expect } from "vitest";
import { repairDatabase,ids } from "./date-repair-test-setup";
import { resolveBookingDates,type DateEvidenceInput } from "./date-evidence";
it("clearing the whole reservation supersedes historical proof in JavaScript and SQL",async()=>{
 const {pg}=await repairDatabase();try{
 const input:DateEvidenceInput={bookingId:ids.booking,rawPublic:{start:"2027-07-21T06:00:00.000Z",end:"2027-07-27T05:59:59.999Z"},rawReservation:{start:null,end:null},evidence:[
 {field:"public_start",kind:"verified_event",value:"2027-07-21",semantics:"inclusive_date",revision:1,sourceRef:{type:"saved_note",id:ids.booking,revision:"1"}},
 {field:"public_end",kind:"verified_event",value:"2027-07-26",semantics:"inclusive_date",revision:1,sourceRef:{type:"saved_note",id:ids.booking,revision:"1"}},
 {field:"reservation_start",kind:"verified_reservation",value:"2027-07-20",semantics:"inclusive_date",revision:1,sourceRef:{type:"saved_note",id:ids.booking,revision:"1"}},
 {field:"reservation_end",kind:"verified_reservation",value:"2027-07-27",semantics:"exclusive_date",revision:1,sourceRef:{type:"saved_note",id:ids.booking,revision:"1"}},
 {field:"reservation_start",kind:"unknown_import",value:null,semantics:"instant",revision:2,sourceRef:{type:"saved_note",id:ids.booking,revision:"2"}},
 {field:"reservation_end",kind:"unknown_import",value:null,semantics:"instant",revision:2,sourceRef:{type:"saved_note",id:ids.booking,revision:"2"}}]};
 for(const e of input.evidence)await pg.query("INSERT INTO booking_date_evidence(booking_id,field,kind,value,semantics,revision,source_type,source_id,source_revision,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'owner')",[ids.booking,e.field,e.kind,e.value,e.semantics,e.revision,e.sourceRef.type,e.sourceRef.id,e.sourceRef.revision]);
 const result=await pg.query<{value:unknown}>("SELECT booking_resolved_dates($1,$2::timestamptz,$3::timestamptz,null,null) value",[ids.booking,input.rawPublic.start,input.rawPublic.end]);
 expect(result.rows[0].value).toMatchObject({evidenceState:"verified",reviewReasons:[],reservationWindow:null});
 expect(resolveBookingDates(input)).toMatchObject({evidenceState:"verified",reviewReasons:[],reservationWindow:null});
 }finally{await pg.close();}
},30000);
