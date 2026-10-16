import { describe, expect, it } from "vitest";
import { addDays, validDay, reviewedDays, eventIdentity, sameEvent } from "./calendar-preview-model";
import { resolveBookingDates, dateEndpointInstant, type EndpointEvidence } from "../../booking-date-repair/date-evidence";

describe("profile calendar dates and retry identity", () => {
  it("handles leap days and year boundaries without server-local time", () => {
    expect(addDays("2028-03-01", -2)).toBe("2028-02-28");
    expect(addDays("2027-12-31", 1)).toBe("2028-01-01");
    expect(validDay("2027-02-29")).toBe(false);
    expect(validDay("2028-02-29")).toBe(true);
  });
  it("keeps inclusive date evidence on its Denver calendar date", () => {
    const evidence: EndpointEvidence[] = [
      { field: "public_start", value: "2027-07-21", kind: "verified_event", semantics: "inclusive_date", revision: 1, sourceRef: {type:"saved_note",id:"note",revision:"v1"} },
      { field: "public_end", value: "2027-07-26", kind: "verified_event", semantics: "inclusive_date", revision: 1, sourceRef: {type:"saved_note",id:"note",revision:"v1"} },
    ];
    const dates = resolveBookingDates({bookingId:"b",rawPublic:{
      start:dateEndpointInstant(evidence[0].value,evidence[0].semantics,evidence[0].field),
      end:dateEndpointInstant(evidence[1].value,evidence[1].semantics,evidence[1].field)},
      rawReservation:{start:null,end:null},evidence});
    expect(reviewedDays(dates)).toEqual({startsOn:"2027-07-21",endsOn:"2027-07-26",setupOn:null,teardownOn:null});
    expect(reviewedDays({...dates,publicWindow:{start:"2027-07-21T06:00:00Z",end:"2027-07-27T06:00:00Z"},publicEndExclusive:true}).endsOn).toBe("2027-07-26");
  });
  it("does not turn raw unsupported dates into verified dates", () => {
    const dates=resolveBookingDates({bookingId:"b",rawPublic:{start:"2027-07-21T00:00:00Z",end:"2027-07-26T00:00:00Z"},rawReservation:{start:null,end:null},evidence:[]});
    expect(reviewedDays(dates).startsOn).toBeNull();
  });
  it("uses a stable Google-compatible identity per booking/package", () => {
    expect(eventIdentity("b","zone")).toMatch(/^[0-9a-f]{64}$/);
    expect(eventIdentity("b","zone")).toBe(eventIdentity("b","zone"));
    expect(eventIdentity("b","zone")).not.toBe(eventIdentity("b","pirates"));
  });
  it("requires exact public fields and an active event for readback", () => {
    const input={summary:"Fair",description:"EVENT DATES: 2027-07-21",startDate:"2027-07-19",endDateExclusive:"2027-07-23"};
    const event={...input,id:"id",etag:"v1",updated:null,status:"confirmed",eventKind:"all_day" as const};
    expect(sameEvent(event,input)).toBe(true);
    expect(sameEvent({...event,eventKind:"timed"},input)).toBe(false);
    expect(sameEvent({...event,eventKind:undefined},input)).toBe(false);
    expect(sameEvent({...event,description:"different"},input)).toBe(false);
    expect(sameEvent({...event,status:"cancelled"},input)).toBe(false);
    expect(sameEvent(null,input)).toBe(false);
  });
});
