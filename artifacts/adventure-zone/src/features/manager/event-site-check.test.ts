import { describe, expect, it } from "vitest";
import { emptyEventSiteCheck, parseEventSiteCheck, serializeEventSiteCheck } from "./event-site-check";

describe("event site check notes", () => {
  it("round-trips checklist answers and keeps the separate rating note", () => {
    const siteCheck = {
      ...emptyEventSiteCheck(),
      contactCommunication: true,
      locationAccurate: true,
      restroomsAvailable: true,
      forkliftAvailable: true,
      eventNotes: "Setup was behind the grandstand.",
      followUpNotes: "Confirm forklift before arrival next year.",
      highlights: "Organizer communicated very well.",
      recommendReturn: "yes" as const,
    };

    const serialized = serializeEventSiteCheck(siteCheck, "Strong event overall.");
    const parsed = parseEventSiteCheck(serialized);

    expect(parsed.siteCheck).toEqual(siteCheck);
    expect(parsed.ratingNotes).toBe("Strong event overall.");
    expect(serialized).toContain("- [x] Location/address was accurate");
    expect(serialized).toContain("Return recommendation: yes");
  });

  it("treats ordinary historical rating notes as rating notes with a blank site check", () => {
    const parsed = parseEventSiteCheck("Old rating note");
    expect(parsed.siteCheck).toEqual(emptyEventSiteCheck());
    expect(parsed.ratingNotes).toBe("Old rating note");
  });
});
