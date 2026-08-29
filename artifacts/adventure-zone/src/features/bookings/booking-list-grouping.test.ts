import { describe, expect, it } from "vitest";

import { groupBookingsByProfile } from "./booking-list-grouping";

describe("groupBookingsByProfile", () => {
  it("keeps separate booking records under one owning event profile", () => {
    const profile = { id: "portfest", name: "Portfest" };
    const groups = groupBookingsByProfile([
      { id: "booking-2026", name: "Portfest 2026", organization: profile },
      { id: "booking-2025", name: "Portfest 2025", organization: profile },
    ]);

    expect(groups).toEqual([{
      key: "profile:portfest",
      profile,
      bookings: [
        { id: "booking-2026", name: "Portfest 2026", organization: profile },
        { id: "booking-2025", name: "Portfest 2025", organization: profile },
      ],
    }]);
  });

  it("does not combine records owned by different profiles with the same name", () => {
    const groups = groupBookingsByProfile([
      { id: "booking-a", name: "Summer Festival", organization: { id: "profile-a", name: "Summer Festival" } },
      { id: "booking-b", name: "Summer Festival", organization: { id: "profile-b", name: "Summer Festival" } },
    ]);

    expect(groups).toHaveLength(2);
  });

  it("keeps unowned legacy bookings in separate groups", () => {
    const groups = groupBookingsByProfile([
      { id: "booking-a", name: "Legacy event", organization: null },
      { id: "booking-b", name: "Legacy event", organization: null },
    ]);

    expect(groups).toHaveLength(2);
  });
});