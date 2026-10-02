import { describe, expect, it } from "vitest";
import { isBookingCurrentOrFuture, normalizedBookingEnd } from "./booking-list-visibility";

describe("booking list visibility", () => {
  const now = new Date("2026-08-17T18:00:00-06:00");

  it("hides a booking whose event dates are already past", () => {
    expect(isBookingCurrentOrFuture({
      startsAt: new Date("2026-01-12T12:00:00Z"),
      endsAt: new Date("2026-02-02T12:00:00Z"),
    }, now)).toBe(false);
  });

  it("treats year-9999 ACT end dates as missing instead of keeping old events alive forever", () => {
    const sentinel = new Date("9999-12-30T00:00:00Z");
    expect(normalizedBookingEnd(sentinel)).toBeNull();
    expect(isBookingCurrentOrFuture({
      startsAt: new Date("2026-01-05T12:00:00Z"),
      endsAt: sentinel,
    }, now)).toBe(false);
  });

  it("keeps upcoming bookings visible", () => {
    expect(isBookingCurrentOrFuture({
      startsAt: new Date("2026-09-05T12:00:00Z"),
      endsAt: new Date("2026-09-07T12:00:00Z"),
    }, now)).toBe(true);
  });
});

it("keeps a legacy booking available for review when backend evidence is unresolved",()=>{
 expect(isBookingCurrentOrFuture({startsAt:new Date("2026-01-01"),endsAt:new Date("2026-02-01"),dateProvenance:{publicWindow:null,reservationWindow:null,evidenceState:"needs_review"}},new Date("2027-01-01"))).toBe(true);
});
it("uses an evidenced public end rather than a stale raw sentinel",()=>{
 expect(isBookingCurrentOrFuture({startsAt:new Date("2026-01-01"),endsAt:new Date("9999-12-31"),dateProvenance:{publicWindow:{start:"2027-01-03T12:00:00Z",end:"2027-01-04T12:00:00Z"},reservationWindow:null,evidenceState:"verified"}},new Date("2027-01-01"))).toBe(true);
});
