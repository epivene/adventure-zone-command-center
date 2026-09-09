import { describe, expect, it } from "vitest";

import { bookingEditInputSchema } from "./booking-input";

const baseEdit = {
  name: "Mapped Event",
  venueName: "City Park",
  address1: "100 Main St",
  city: "Boise",
  region: "ID",
  postalCode: "83702",
  startsAt: "2026-06-01",
  endsAt: "2026-06-02",
  probability: "possible",
  travelLegId: "",
  notes: "",
};

describe("confirmed booking location requirements", () => {
  it("rejects a confirmed booking without both map coordinates", () => {
    const result = bookingEditInputSchema.safeParse({
      ...baseEdit,
      status: "confirmed",
      latitude: "",
      longitude: "",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.flatten().fieldErrors.latitude).toContain(
      "Map this confirmed event before saving",
    );
  });

  it("allows an unconfirmed lead to remain in Needs mapping", () => {
    const result = bookingEditInputSchema.safeParse({
      ...baseEdit,
      status: "possible",
      latitude: "",
      longitude: "",
    });

    expect(result.success).toBe(true);
  });

  it("accepts a confirmed booking with a complete coordinate pair", () => {
    const result = bookingEditInputSchema.safeParse({
      ...baseEdit,
      status: "confirmed",
      latitude: "43.615",
      longitude: "-116.202",
    });

    expect(result.success).toBe(true);
  });
});
