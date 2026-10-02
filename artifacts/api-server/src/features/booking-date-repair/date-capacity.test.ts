import {it,expect} from "vitest";
import {targetForBooking,projectReservations,capacityDecision,type AllocationFacts,type AllocationTarget} from "../outreach-planner/outreach-capacity-evidence";
it("blocks definitive capacity when a committed booking has unresolved date evidence",()=>{
  const facts = {generation:0,bookings:[{id:"unknown",name:"Unknown committed fair",status:"confirmed",probability:"definite",travel_leg_id:"leg",starts_at:"2027-04-03T12:00:00Z",ends_at:"2027-04-04T12:00:00Z",latitude:40,longitude:-111,date_provenance:{publicWindow:null,reservationWindow:null,evidenceState:"needs_review",reviewReasons:["INCOMPLETE_PUBLIC_WINDOW"]}}],
    windows:[],selections:[],assignments:[],packages:[],resources:[],legs:[],mirrors:[],calendars:[],demands:[],holds:[]} as unknown as AllocationFacts;
  expect(targetForBooking(facts,"unknown").reasons).toContain("Booking date evidence is unresolved.");
  const target = {bookingId:"new",eventStartsOn:"2027-07-01",eventEndsOn:"2027-07-02",startsOn:"2027-06-29",endsOn:"2027-07-03",legId:"leg",quantities:{},resourceIds:[],location:{latitude:40,longitude:-111},demandFingerprint:"verified"} as AllocationTarget;
  const projection = projectReservations(facts,target,new Date("2026-10-01T12:00:00Z"));
  expect(projection.reasons.some(r=>r.includes("Booking date evidence is unresolved."))).toBe(true);
  expect(capacityDecision(target,projection,[]).status).toBe("needs_review");
});
