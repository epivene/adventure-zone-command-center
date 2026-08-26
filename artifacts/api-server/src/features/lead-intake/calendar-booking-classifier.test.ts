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
      evidence: ["explicit quantity: 2 Foam Party", "explicit quantity: 1 Glow Zone"],
    });
  });
  it("does not guess package use from ambiguous notes", () => {
    expect(classifyCalendarBooking({ summary: "Adventure Zone — Johnson school event", description: "Likely foam or glow; client will decide later." }))
      .toEqual({ confidence: "ambiguous", packages: [], evidence: ["ambiguous or conditional package evidence"] });
  });
  it("ignores unrelated uncertainty outside the package clause", () => {
    expect(classifyCalendarBooking({ summary: "2 Foam Party", description: "Call the office or email the venue with setup questions." }))
      .toMatchObject({ confidence: "explicit", packages: [{ packageKey: "foam-party", quantity: 2 }] });
  });
  it.each(["-1 Foam Party", "minus 1 Foam Party", "remove 1 Foam Party", "exclude 1 Foam Party"])("treats %s as negative package evidence", (summary) => {
    expect(classifyCalendarBooking({ summary, description: "" })).toMatchObject({ confidence: "ambiguous", packages: [] });
  });


  it("fails closed when a bare Adventure Zone follows a different quantified package booking", () => {
    expect(classifyCalendarBooking({
      summary: "1 Pirate's Rebellion booking plus Adventure Zone",
      description: "",
    })).toEqual({
      confidence: "ambiguous",
      packages: [],
      evidence: ["missing explicit quantity: Adventure Zone"],
    });
  });\n});
