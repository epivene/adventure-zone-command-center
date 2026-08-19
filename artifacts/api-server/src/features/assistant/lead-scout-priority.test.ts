import { describe, expect, it } from "vitest";

import { classifyAttendanceScale, isAdultSpecialInterestEvent } from "./lead-scout-priority";

describe("Lead Scout Adventure Zone priority signals", () => {
  it("classifies evidence-backed attendance into useful event-size bands", () => {
    expect(classifyAttendanceScale("About 8,000 attendees last year")).toBe("large");
    expect(classifyAttendanceScale("Attendance was approximately 1,200 visitors")).toBe("medium");
    expect(classifyAttendanceScale("Roughly 250 attendees")).toBe("small");
    expect(classifyAttendanceScale("Attendance was not published")).toBe("unknown");
  });

  it("does not mistake an event year for the attendance count", () => {
    expect(classifyAttendanceScale("2026 attendance: about 250 people")).toBe("small");
    expect(classifyAttendanceScale("In 2025, the festival drew approximately 8,000 visitors")).toBe("large");
  });

  it("recognizes adult/special-interest formats that are a weak bounce-house fit", () => {
    expect(isAdultSpecialInterestEvent("Paranormal Investigation", "special-interest public event / entertainment")).toBe(true);
    expect(isAdultSpecialInterestEvent("Downtown Bar Crawl", "nightlife event")).toBe(true);
    expect(isAdultSpecialInterestEvent("County Fair", "family festival")).toBe(false);
  });
});
