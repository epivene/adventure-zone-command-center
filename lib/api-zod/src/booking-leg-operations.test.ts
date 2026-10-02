import { expect, it } from "vitest";
import {
  bookingLegOperationsSchema,
  operationsHistoryItemSchema,
  operationsBookingOptionSchema,
} from "./booking-leg-operations";

it("rejects executable and protocol-relative history source links", () => {
  const row = {
    bookingId: "a",
    profileId: "p",
    name: "Fair",
    seasonYear: 2026,
    relation: "same_profile",
    leg: null,
    packageNames: [],
    startsAt: null,
    endsAt: null,
  };
  for (const href of ["javascript:alert(1)", "//evil.test", "/\\evil.test"]) {
    expect(
      operationsHistoryItemSchema.safeParse({
        ...row,
        sources: [{ label: "Source", href }],
      }).success,
    ).toBe(false);
  }
  expect(
    operationsHistoryItemSchema.safeParse({
      ...row,
      sources: [{ label: "Booking", href: "/bookings/a" }],
    }).success,
  ).toBe(true);
});
it("keeps an undated booking season unknown", () => {
  const option = operationsBookingOptionSchema.parse({
    id: "b",
    name: "Fair",
    status: "confirmed",
    seasonYear: null,
    startsAt: null,
    endsAt: null,
  });
  expect(option.seasonYear).toBeNull();
});
it("accepts legacy summaries and isolates an unavailable planning section", () => {
  const empty = { state: "not_recorded", message: "Not recorded" };
  const legacy = {
    bookingId: "b",
    profileId: null,
    seasonYear: null,
    bookingStatus: "confirmed",
    assignment: empty,
    history: empty,
    dates: empty,
    resources: empty,
    route: empty,
    crew: empty,
    lodging: empty,
    work: empty,
    calendar: empty,
  };
  expect(bookingLegOperationsSchema.parse(legacy).planning).toBeUndefined();
  expect(
    bookingLegOperationsSchema.parse({
      ...legacy,
      planning: { state: "unavailable", message: "Retry planning" },
    }).bookingStatus,
  ).toBe("confirmed");
  expect(
    bookingLegOperationsSchema.safeParse({
      ...legacy,
      planning: {
        state: "loaded",
        data: { readiness: { overall: "verified_plan" } },
      },
    }).success,
  ).toBe(false);
});
