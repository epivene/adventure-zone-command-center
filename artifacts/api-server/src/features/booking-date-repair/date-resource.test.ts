import { it,expect } from "vitest";
import { detectResourceConflicts } from "../resources/resource-conflicts";
it("retains an unresolved shared resource obligation as a blocker",async()=>{
 const base={resourceId:"equipment",resourceCode:"pool",resourceName:"Pool",resourceStatus:"available" as const,countsAsAttraction:true,movable:true,setupMinutes:0,teardownMinutes:0,minimumTransferMinutes:0,location:null};
 const warnings=await detectResourceConflicts({reservations:[
 {...base,assignmentId:"unknown-assignment",bookingId:"unknown",bookingName:"Unknown committed show",startsAt:null,endsAt:null,dateProvenance:{publicWindow:null,reservationWindow:null,rawPublic:{start:"2026-01-01T00:00:00Z",end:"9999-12-31T00:00:00Z"},rawReservation:{start:null,end:null},evidenceState:"needs_review"}} as any,
 {...base,assignmentId:"target-assignment",bookingId:"target",bookingName:"Target",startsAt:new Date("2027-04-03"),endsAt:new Date("2027-04-04")},
 ],physicalAttractionTotal:null,assignedAttractionCount:1,transferTimeLookup:{estimateMinutes:async()=>null}});
 expect(warnings).toEqual(expect.arrayContaining([expect.objectContaining({code:"RESOURCE_DATE_EVIDENCE_UNRESOLVED",assignmentIds:expect.arrayContaining(["target-assignment","unknown-assignment"]),overridden:false})]));
});
