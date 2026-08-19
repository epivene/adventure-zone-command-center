import { describe, expect, it } from "vitest";

import { scoreAdventureZoneFit } from "./lead-scout-fit";

const base = {
  eventName: "Community Days",
  eventType: "community festival",
  startsAt: "2027-06-11",
  endsAt: "2027-06-13",
  applicationDeadline: "2027-05-15",
  now: new Date("2027-03-01T12:00:00Z"),
  hasPublicSource: true,
  hasFamilySignal: true,
  hasOutdoorSignal: true,
  hasVendorPath: true,
  hasEntertainmentPath: true,
  hasOrganizerContact: true,
  hasAttendanceEvidence: true,
  hasLogisticsEvidence: true,
  hasExclusiveCarnivalProvider: false,
  existenceConfidence: "high" as const,
};

describe("scoreAdventureZoneFit", () => {
  it("rewards family/outdoor/vendor/multi-day/contactable opportunities", () => {
    const result = scoreAdventureZoneFit(base);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.reasons.join(" ")).toMatch(/family/i);
    expect(result.reasons.join(" ")).toMatch(/vendor|entertainment/i);
    expect(result.cautions).toEqual([]);
  });

  it("strongly penalizes an exclusive competing carnival provider", () => {
    const result = scoreAdventureZoneFit({ ...base, hasExclusiveCarnivalProvider: true });
    expect(result.score).toBeLessThan(60);
    expect(result.cautions.join(" ")).toMatch(/exclusive|carnival/i);
  });

  it("penalizes a passed application deadline", () => {
    const result = scoreAdventureZoneFit({
      ...base,
      now: new Date("2027-06-01T12:00:00Z"),
      applicationDeadline: "2027-05-15",
    });
    expect(result.score).toBeLessThan(70);
    expect(result.cautions.join(" ")).toMatch(/deadline/i);
  });

  it("penalizes weak existence and no participation path", () => {
    const result = scoreAdventureZoneFit({
      ...base,
      existenceConfidence: "low",
      hasVendorPath: false,
      hasEntertainmentPath: false,
      hasOrganizerContact: false,
    });
    expect(result.score).toBeLessThan(50);
    expect(result.cautions.join(" ")).toMatch(/existence|participation/i);
  });
});
