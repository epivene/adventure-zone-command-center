import { describe, expect, it } from "vitest";

import { operationalCalendarReviewReason } from "./operational-calendar-import-service";
import { parseDavidOperationalCalendarEvent } from "./david-calendar-parser";

describe("operational calendar import policy", () => {
  it.each(["ANGEL", "DAVE", "HULK", "KRISTY"] as const)(
    "accepts a complete confirmed %s row when its manager leg exists",
    (managerToken) => {
      const parsed = parseDavidOperationalCalendarEvent({
        summary: `${managerToken} County Fair - Delta UT (Zone)`,
      });
      expect(operationalCalendarReviewReason({ parsed, hasManagerLeg: true })).toBeNull();
    },
  );

  it.each([
    ["PLACEHOLDER County Fair - Delta UT (Zone)", "placeholder"],
    ["CANCELLED County Fair - Delta UT (Zone)", "cancelled"],
    ["NEED CONTACT County Fair - Delta UT (Zone)", "action required"],
  ] as const)("routes %s to review without promoting it to a booking", (summary, state) => {
    const parsed = parseDavidOperationalCalendarEvent({ summary });
    expect(operationalCalendarReviewReason({ parsed, hasManagerLeg: false })).toContain(state);
  });

  it("routes incomplete and unrecognized-manager rows to review", () => {
    const incomplete = parseDavidOperationalCalendarEvent({ summary: "ANGEL County Fair - Delta UT" });
    expect(operationalCalendarReviewReason({ parsed: incomplete, hasManagerLeg: true }))
      .toBe("Calendar row needs manual matching");

    const unknownManager = parseDavidOperationalCalendarEvent({
      summary: "UNKNOWN County Fair - Delta UT (Zone)",
    });
    expect(operationalCalendarReviewReason({ parsed: unknownManager, hasManagerLeg: false }))
      .toBe("Calendar row needs a recognized manager leg");
  });

  it("does not promote personal reminders to confirmed bookings", () => {
    const parsed = parseDavidOperationalCalendarEvent({
      summary: "PERSONAL Dentist appointment",
    });
    expect(operationalCalendarReviewReason({ parsed, hasManagerLeg: false }))
      .toBe("Calendar row is non event and needs review");
  });

  it("routes a linked package change to review instead of accumulating package selections", () => {
    const parsed = parseDavidOperationalCalendarEvent({
      summary: "ANGEL County Fair - Delta UT (Pirates)",
    });
    expect(operationalCalendarReviewReason({
      parsed,
      hasManagerLeg: true,
      linkedPackageKey: "zone",
    })).toBe("Calendar row changed package and needs review");
  });
});