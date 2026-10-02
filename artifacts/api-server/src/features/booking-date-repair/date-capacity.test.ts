import {it,expect} from "vitest";
import {fingerprint,bookingDemandFacts,targetForBooking,projectReservations,capacityDecision,type AllocationFacts,type AllocationTarget} from "../outreach-planner/outreach-capacity-evidence";
it("blocks definitive capacity when a committed booking has unresolved date evidence",()=>{
  const facts = {generation:0,bookings:[{id:"unknown",name:"Unknown committed fair",status:"confirmed",probability:"definite",travel_leg_id:"leg",starts_at:"2027-04-03T12:00:00Z",ends_at:"2027-04-04T12:00:00Z",latitude:40,longitude:-111,date_provenance:{publicWindow:null,reservationWindow:null,evidenceState:"needs_review",reviewReasons:["INCOMPLETE_PUBLIC_WINDOW"]}}],
    windows:[],selections:[],assignments:[],packages:[],resources:[],legs:[],mirrors:[],calendars:[],demands:[],holds:[]} as unknown as AllocationFacts;
  expect(targetForBooking(facts,"unknown").reasons).toContain("Booking date evidence is unresolved.");
  const target = {bookingId:"new",eventStartsOn:"2027-07-01",eventEndsOn:"2027-07-02",startsOn:"2027-06-29",endsOn:"2027-07-03",legId:"leg",quantities:{},resourceIds:[],location:{latitude:40,longitude:-111},demandFingerprint:"verified"} as AllocationTarget;
  const projection = projectReservations(facts,target,new Date("2026-10-01T12:00:00Z"));
  expect(projection.reasons.some(r=>r.includes("Booking date evidence is unresolved."))).toBe(true);
  expect(capacityDecision(target,projection,[]).status).toBe("needs_review");
});


it("uses complete verified public dates without inventing setup days and preserves reviewed exclusive reservation boundaries",()=>{
 const dates={rawPublic:{start:"2027-07-21T06:00:00.000Z",end:"2027-07-27T05:59:59.999Z"},rawReservation:{start:null,end:null},publicWindow:{start:"2027-07-21T06:00:00.000Z",end:"2027-07-27T05:59:59.999Z"},reservationWindow:null,publicEndExclusive:false,reservationEndExclusive:false,evidenceState:"verified",reviewReasons:[],endpointEvidence:[]};
 const facts={generation:0,bookings:[{id:"target",name:"Proved event",status:"new_lead",probability:"possible",travel_leg_id:"leg",starts_at:dates.publicWindow.start,ends_at:dates.publicWindow.end,latitude:40,longitude:-111,date_provenance:dates}],
 windows:[],selections:[{booking_id:"target",package_template_id:"package"}],assignments:[],packages:[{id:"package",code:"adventure_zone",normal_capacity:1,temporary_unavailable_quantity:0,active:true}],resources:[{id:"resource",name:"Item",status:"available"}],legs:[{id:"leg",archived_at:null}],mirrors:[],calendars:[],demands:[{booking_id:"target",quantities:{adventure_zone:1},resource_ids:["resource"],facts_fingerprint:""}],holds:[]} as unknown as AllocationFacts;
 const b=facts.bookings[0];facts.demands[0].facts_fingerprint=fingerprint(bookingDemandFacts(facts,b));
 expect(targetForBooking(facts,"target").target).toMatchObject({eventStartsOn:"2027-07-21",eventEndsOn:"2027-07-26",startsOn:"2027-07-21",endsOn:"2027-07-26"});
 b.date_provenance={...dates,rawReservation:{start:"2027-07-20T06:00:00.000Z",end:"2027-07-28T06:00:00.000Z"},reservationWindow:{start:"2027-07-20T06:00:00.000Z",end:"2027-07-28T06:00:00.000Z"},reservationEndExclusive:true} as never;
 facts.windows=[{booking_id:"target",starts_at:"2027-07-20T06:00:00.000Z",ends_at:"2027-07-28T06:00:00.000Z",source:"reviewed_timestamp"}];
 facts.demands[0].facts_fingerprint=fingerprint(bookingDemandFacts(facts,b));
 expect(targetForBooking(facts,"target").target).toMatchObject({startsOn:"2027-07-20",endsOn:"2027-07-27"});
});
