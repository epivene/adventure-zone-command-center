import { it, expect } from "vitest";
import { resolveEffectiveEventDate } from "../event-date-coverage/effective-event-date";
import { applyOperationalWindowsToCalendarBookings } from "../google-workspace/calendar/calendar-operational-window-projection";
it.each([null,"9999-12-31"])("does not call an incomplete or sentinel lead booked",end=>{
 expect(resolveEffectiveEventDate({today:"2027-01-01",bookings:[{id:"lead",status:"new_lead",startsOn:"2027-04-03",endsOn:end}],facts:[]})).toBeNull();
});
it("does not project an unsupported raw operational window onto the calendar",()=>{
 const [result]=applyOperationalWindowsToCalendarBookings([{id:"lead",status:"confirmed",startsAt:null,endsAt:null,dateProvenance:{publicWindow:null,reservationWindow:null,rawPublic:{start:"2026-04-03",end:"9999-12-31"},rawReservation:{start:"2026-04-03",end:"9999-12-31"},evidenceState:"needs_review",reviewReasons:["UNVERIFIED_PUBLIC_WINDOW"]}}],[{bookingId:"lead",startsAt:new Date("2026-04-03"),endsAt:new Date("9999-12-31"),source:"app"}]);
 expect(result.startsAt).toBeNull(); expect(result.endsAt).toBeNull();
});
it("preserves reviewed timestamp reservation endpoints instead of dropping a day",()=>{
 const [result]=applyOperationalWindowsToCalendarBookings([{id:"show",startsAt:new Date("2027-04-03T12:00:00Z"),endsAt:new Date("2027-04-04T12:00:00Z")}],[{bookingId:"show",startsAt:new Date("2027-04-01T18:00:00Z"),endsAt:new Date("2027-04-05T18:00:00Z"),source:"reviewed_timestamp"}]);
 expect(result.endsAt?.toISOString()).toBe("2027-04-05T18:00:00.000Z");
});
