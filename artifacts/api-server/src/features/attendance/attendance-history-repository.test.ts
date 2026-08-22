import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/features/attendance/attendance-history-repository.ts", "utf8");

describe("attendance history projection", () => {
  it("offers an owner scope and an Office-safe scope", () => {
    expect(source).toContain('scope: "owner" | "office"');
    expect(source).toContain("eventAttendanceHistory.status");
    expect(source).toContain('ne(eventAttendanceHistory.status, "blacklisted")');
  });

  it("returns only approved historical records rather than staged import rows", () => {
    expect(source).toContain("eventAttendanceHistory");
    expect(source).not.toContain("attendanceImportRows");
    expect(source).not.toContain("attendanceImportYearStatuses");
  });

  it("uses the profile DTO names for preserved source text", () => {
    expect(source).toContain("sourceEventName: eventAttendanceHistory.originalEventName");
    expect(source).toContain("sourceLocation: eventAttendanceHistory.originalLocation");
    expect(source).not.toContain("originalEventName: eventAttendanceHistory.originalEventName");
    expect(source).not.toContain("originalLocation: eventAttendanceHistory.originalLocation");
  });
});
