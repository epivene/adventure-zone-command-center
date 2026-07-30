import { describe, expect, it } from "vitest";

import {
  changeBookingPlaceSchema,
  replaceBookingPeopleSchema,
} from "@/features/bookings/booking-relationship-input";

const ids = {
  booking: "11111111-1111-4111-8111-111111111111",
  place: "22222222-2222-4222-8222-222222222222",
  personOne: "33333333-3333-4333-8333-333333333333",
  personTwo: "44444444-4444-4444-8444-444444444444",
};

describe("Booking relationship input", () => {
  it("accepts one primary Booking Person", () => {
    expect(replaceBookingPeopleSchema.safeParse({
      bookingId: ids.booking,
      people: [{
        contactId: ids.personOne,
        role: "Event Director",
        isPrimary: true,
      }],
    }).success).toBe(true);
  });

  it("accepts additional involved People without a primary", () => {
    expect(replaceBookingPeopleSchema.safeParse({
      bookingId: ids.booking,
      people: [
        { contactId: ids.personOne, role: null, isPrimary: false },
        { contactId: ids.personTwo, role: "Coordinator", isPrimary: false },
      ],
    }).success).toBe(true);
  });

  it("trims roles and turns blank roles into null", () => {
    expect(replaceBookingPeopleSchema.parse({
      bookingId: ids.booking,
      people: [
        { contactId: ids.personOne, role: "  Event Director  ", isPrimary: true },
        { contactId: ids.personTwo, role: "   ", isPrimary: false },
      ],
    }).people).toEqual([
      { contactId: ids.personOne, role: "Event Director", isPrimary: true },
      { contactId: ids.personTwo, role: null, isPrimary: false },
    ]);
  });

  it("rejects duplicate Person IDs", () => {
    const result = replaceBookingPeopleSchema.safeParse({
      bookingId: ids.booking,
      people: [
        { contactId: ids.personOne, role: null, isPrimary: true },
        { contactId: ids.personOne, role: null, isPrimary: false },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: ["people"],
          message: "Select each Person once",
        }),
      ]));
    }
  });

  it("rejects more than one primary Person", () => {
    const result = replaceBookingPeopleSchema.safeParse({
      bookingId: ids.booking,
      people: [
        { contactId: ids.personOne, role: null, isPrimary: true },
        { contactId: ids.personTwo, role: null, isPrimary: true },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: ["people"],
          message: "Choose at most one primary Person",
        }),
      ]));
    }
  });

  it("rejects a Place-less Booking mutation", () => {
    expect(changeBookingPlaceSchema.safeParse({
      bookingId: ids.booking,
      organizationId: null,
    }).success).toBe(false);
  });
});
