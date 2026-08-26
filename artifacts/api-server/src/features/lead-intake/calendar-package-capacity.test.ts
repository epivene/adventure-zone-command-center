import { describe, expect, it } from "vitest";

import { classifyCalendarBooking } from "./calendar-booking-classifier";

describe("Calendar package capacity classifications", () => {
  it("emits canonical Adventure, Pirate, Warrior, and Mini package keys", () => {
    expect(classifyCalendarBooking({
      summary: "2 Adventure Zone + 1 Pirate's Rebellion",
      description: "1 Warrior's Playground and 1 Mini Zone",
    })).toMatchObject({
      confidence: "explicit",
      packages: expect.arrayContaining([
        { packageKey: "adventure_zone", quantity: 2 },
        { packageKey: "pirates_rebellion", quantity: 1 },
        { packageKey: "weekend_warriors", quantity: 1 },
        { packageKey: "mini_zone", quantity: 1 },
      ]),
    });
  });

  it("keeps Foam Party and Glow Zone explicit but unmapped so availability fails closed", () => {
    expect(classifyCalendarBooking({
      summary: "2 Foam Party",
      description: "1 Glow Zone",
    })).toMatchObject({
      confidence: "explicit",
      packages: expect.arrayContaining([
        { packageKey: "foam-party", quantity: 2 },
        { packageKey: "glow-zone", quantity: 1 },
      ]),
    });
  });
});
