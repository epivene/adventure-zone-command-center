import { describe, expect, it } from "vitest";

import { resolveProfileEffectiveEventDate } from "./event-profile-repository";

const facts = {
  confirmed: {
    id: "confirmed",
    organizationId: "org",
    startsOn: "2027-10-01",
    endsOn: null,
    status: "confirmed" as const,
    active: true,
  },
  expected: {
    id: "expected",
    organizationId: "org",
    startsOn: "2027-09-01",
    endsOn: null,
    status: "expected" as const,
    active: true,
  },
};

describe("resolveProfileEffectiveEventDate", () => {
  it("returns booked, confirmed, expected, then null by precedence", () => {
    expect(resolveProfileEffectiveEventDate({
      today: "2027-01-01",
      bookings: [{
        id: "booking",
        startsAt: new Date("2027-11-03T18:00:00Z"),
        endsAt: new Date("2027-11-05T18:00:00Z"),
        status: "confirmed",
      }],
      facts: [facts.expected, facts.confirmed],
    })?.displayStatus).toBe("booked");
    expect(resolveProfileEffectiveEventDate({
      today: "2027-01-01",
      bookings: [],
      facts: [facts.expected, facts.confirmed],
    })?.displayStatus).toBe("confirmed");
    expect(resolveProfileEffectiveEventDate({
      today: "2027-01-01",
      bookings: [],
      facts: [facts.expected],
    })?.displayStatus).toBe("expected");
    expect(resolveProfileEffectiveEventDate({
      today: "2027-01-01",
      bookings: [],
      facts: [],
    })).toBeNull();
  });
});
