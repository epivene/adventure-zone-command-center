import { describe, expect, it } from "vitest";
import { classifyCalendarBooking } from "./calendar-booking-classifier";

describe("classifyCalendarBooking", () => {
  it("returns explicit multiple package quantities from title and description evidence", () => {
    expect(classifyCalendarBooking({
      summary: "Adventure Zone booking — 2 Foam Party + 1 Glow Zone",
      description: "Confirmed: 2 Foam Party packages and 1 Glow Zone package.",
    })).toEqual({
      confidence: "explicit",
      packages: [{ packageKey: "foam-party", quantity: 2 }, { packageKey: "glow-zone", quantity: 1 }],
      evidence: ["title: 2 Foam Party", "title: 1 Glow Zone"],
    });
  });
  it("does not guess package use from ambiguous notes", () => {
    expect(classifyCalendarBooking({ summary: "Adventure Zone — Johnson school event", description: "Likely foam or glow; client will decide later." }))
      .toEqual({ confidence: "ambiguous", packages: [], evidence: ["ambiguous package reference: foam or glow"] });
  });
});