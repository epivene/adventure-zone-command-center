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
  attendanceScale: "large" as const,
  hasAdultSpecialInterestSignal: false,
  hasLogisticsEvidence: true,
  hasExclusiveCarnivalProvider: false,
  existenceConfidence: "high" as const,
};

describe("scoreAdventureZoneFit", () => {
  it("strongly rewards child-friendly, multi-day, high-attendance opportunities", () => {
    const result = scoreAdventureZoneFit(base);
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.reasons.join(" ")).toMatch(/family|child/i);
    expect(result.reasons.join(" ")).toMatch(/multi-day/i);
    expect(result.reasons.join(" ")).toMatch(/attendance|turnout|large/i);
    expect(result.cautions).toEqual([]);
  });

  it("pushes adult special-interest and small events well below a family fair", () => {
    const weak = scoreAdventureZoneFit({
      ...base,
      eventName: "Paranormal Investigation",
      eventType: "special-interest public event / entertainment",
      startsAt: "2027-06-11",
      endsAt: "2027-06-11",
      hasFamilySignal: false,
      hasAdultSpecialInterestSignal: true,
      attendanceScale: "small",
    });
    const strong = scoreAdventureZoneFit(base);

    expect(weak.score).toBeLessThan(40);
    expect(strong.score - weak.score).toBeGreaterThanOrEqual(45);
    expect(weak.cautions.join(" ")).toMatch(/family|child/i);
    expect(weak.cautions.join(" ")).toMatch(/small|attendance|turnout/i);
    expect(weak.cautions.join(" ")).toMatch(/adult|special-interest/i);
  });

  it("penalizes unknown event scale instead of treating any attendance mention as enough", () => {
    const result = scoreAdventureZoneFit({ ...base, hasAttendanceEvidence: false, attendanceScale: "unknown" });
    expect(result.score).toBeLessThan(scoreAdventureZoneFit(base).score);
    expect(result.cautions.join(" ")).toMatch(/attendance|scale|turnout/i);
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
