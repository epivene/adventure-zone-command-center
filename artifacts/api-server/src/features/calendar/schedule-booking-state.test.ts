import { describe, expect, it } from "vitest";

import { isBookedForSchedule, scheduleBookingState } from "./schedule-booking-state";

describe("Schedule booking state", () => {
  it("treats Contract Received and definite records as operationally booked", () => {
    expect(isBookedForSchedule({ status: "contract_received", probability: "definite" })).toBe(true);
    expect(isBookedForSchedule({ status: "pending_contract", probability: "definite" })).toBe(true);
    expect(scheduleBookingState({ status: "confirmed", probability: "possible" })).toBe("booked");
  });

  it("keeps ordinary possibilities out of the booked route", () => {
    expect(isBookedForSchedule({ status: "possible", probability: "possible" })).toBe(false);
    expect(scheduleBookingState({ status: "possible", probability: "likely" })).toBe("potential");
  });

  it("never treats cancelled or declined records as booked", () => {
    expect(isBookedForSchedule({ status: "cancelled", probability: "definite" })).toBe(false);
    expect(isBookedForSchedule({ status: "declined", probability: "definite" })).toBe(false);
  });
});
