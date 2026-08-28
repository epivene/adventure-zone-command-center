import { describe, expect, it } from "vitest";

import { dedupeBookingList } from "./booking-list-dedupe";

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    name: "Twin Falls County Fair - 2026",
    city: "Filer",
    region: "ID",
    startsAt: new Date("2026-09-02T12:00:00Z"),
    endsAt: new Date("2026-09-07T20:00:00Z"),
    status: "new_lead",
    probability: "possible",
    travelLeg: null,
    nextAction: { id: "follow-up-1", kind: "email", dueAt: new Date("2026-08-25T12:00:00Z") },
    ...overrides,
  } as any;
}

describe("dedupeBookingList", () => {
  it("collapses the same event even when status and leg differ", () => {
    const result = dedupeBookingList([
      booking(),
      booking({
        id: "booking-2",
        status: "contacted",
        travelLeg: { id: "kristy", name: "Kristy", color: "#f00" },
        nextAction: { id: "follow-up-2", kind: "call", dueAt: new Date("2026-08-28T12:00:00Z") },
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "booking-2", status: "contacted" });
  });

  it("prefers the live confirmed record over a stale terminal duplicate", () => {
    const result = dedupeBookingList([
      booking({ id: "confirmed", status: "confirmed" }),
      booking({ id: "retired", status: "completed" }),
      booking({ id: "declined", status: "declined" }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "confirmed", status: "confirmed" });
  });

  it("keeps different event dates separate", () => {
    const result = dedupeBookingList([
      booking(),
      booking({
        id: "booking-2027",
        startsAt: new Date("2027-09-02T12:00:00Z"),
        endsAt: new Date("2027-09-07T20:00:00Z"),
      }),
    ]);

    expect(result).toHaveLength(2);
  });

  it("does not guess duplicates when dates are missing", () => {
    const result = dedupeBookingList([
      booking({ id: "a", startsAt: null, endsAt: null }),
      booking({ id: "b", startsAt: null, endsAt: null }),
    ]);

    expect(result).toHaveLength(2);
  });
});
