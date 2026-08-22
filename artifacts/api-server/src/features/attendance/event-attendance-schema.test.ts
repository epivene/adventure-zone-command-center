import { describe, expect, it } from "vitest";
import {
  attendanceImportRows,
  attendanceImportYearStatuses,
  eventAttendanceHistory,
  attendanceHistoryStatusValues,
} from "@workspace/db/event-attendance-history-schema";

describe("event attendance history schema", () => {
  it("exports staged rows, year statuses, and approved history", () => {
    expect(attendanceImportRows.sourceRowNumber).toBeDefined();
    expect(attendanceImportRows.matchState).toBeDefined();
    expect(attendanceImportYearStatuses.year).toBeDefined();
    expect(eventAttendanceHistory.organizationId).toBeDefined();
    expect(eventAttendanceHistory.organizationLocationId).toBeDefined();
  });

  it("keeps workbook blacklisted status as attendance history only", () => {
    expect(attendanceHistoryStatusValues).toEqual([
      "attended",
      "blacklisted",
      "cancelled_last_minute",
    ]);
    expect(Object.keys(eventAttendanceHistory)).not.toContain("doNotCallAt");
    expect(Object.keys(eventAttendanceHistory)).not.toContain("contactPreferenceId");
  });
});
