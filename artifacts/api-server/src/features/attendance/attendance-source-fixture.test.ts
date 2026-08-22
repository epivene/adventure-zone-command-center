import { describe, expect, it } from "vitest";

import {
  attendanceSourceCounts,
  attendanceSourceFixture,
} from "./attendance-source-fixture";

describe("attended calendar normalized source fixture", () => {
  it("preserves the complete workbook rather than the earlier truncated preview", () => {
    expect(attendanceSourceFixture.sourceFile).toBe("Adventure Zone Attended Calendar.xlsx");
    expect(attendanceSourceFixture.sheet).toBe("Sheet1");
    expect(attendanceSourceFixture.range).toBe("A1:N129");
    expect(attendanceSourceCounts()).toEqual({
      rows: 110,
      statuses: 198,
      attended: 189,
      blacklisted: 1,
      cancelledLastMinute: 8,
    });
  });

  it("preserves repeated event/month occurrences as separate source rows", () => {
    const wyo = attendanceSourceFixture.rows.filter((row) => row.eventName === "WYO Bounce Lab");
    expect(wyo.map((row) => row.month)).toEqual(["JANUARY", "FEBRUARY", "MARCH"]);

    const beaverhead = attendanceSourceFixture.rows.filter((row) => row.eventName.trim() === "Beaverhead County Fair");
    expect(beaverhead.map((row) => row.month.trim())).toEqual(["AUGUST", "SEPTEMBER"]);

    const donkey = attendanceSourceFixture.rows.filter((row) => row.eventName === "Donkey Derby Days");
    expect(donkey.map((row) => row.month)).toEqual(["JUNE", "AUGUST"]);
  });

  it("preserves blank-status source rows and exact source strings", () => {
    expect(attendanceSourceFixture.rows.find((row) => row.sourceRowNumber === 66)).toEqual({
      sourceRowNumber: 66,
      month: "JULY",
      eventName: "Pioneer Days - Logan",
      location: "Logan UT",
      statuses: [],
    });

    expect(attendanceSourceFixture.rows.find((row) => row.sourceRowNumber === 127)).toEqual({
      sourceRowNumber: 127,
      month: "OCTOBER ",
      eventName: "Summit Games ",
      location: "Herriman UT",
      statuses: [{ year: 2024, status: "attended" }],
    });
    expect(attendanceSourceFixture.rows.find((row) => row.sourceRowNumber === 128)?.statuses).toHaveLength(2);
    expect(attendanceSourceFixture.rows.find((row) => row.sourceRowNumber === 129)?.statuses).toHaveLength(2);
  });

  it("preserves the source legend exactly", () => {
    expect(attendanceSourceFixture.legend).toEqual({
      X: "attended",
      B: "blacklisted",
      C: "cancelled_last_minute",
    });
  });
});
