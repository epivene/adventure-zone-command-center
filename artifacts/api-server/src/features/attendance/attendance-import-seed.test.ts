import { describe, expect, it } from "vitest";

import { attendanceSourceCounts } from "./attendance-source-fixture";
import { normalizeAttendanceText } from "./attendance-matcher";

describe("attendance import seed contract", () => {
  it("stages the complete corrected workbook counts", () => {
    expect(attendanceSourceCounts()).toEqual({
      rows: 110,
      statuses: 198,
      attended: 189,
      blacklisted: 1,
      cancelledLastMinute: 8,
    });
  });

  it("normalizes only for matching while source text remains untouched", () => {
    expect(normalizeAttendanceText("  Beaverhead County Fair ")).toBe("beaverhead county fair");
    expect(normalizeAttendanceText("Cripple Creek CO")).toBe("cripple creek co");
  });
});
