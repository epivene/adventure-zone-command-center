import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/AttendanceHistoryImportPage.tsx", "utf8");

describe("attendance history import page", () => {
  it("shows source statuses, confidence, match controls, and profile creation path", () => {
    for (const text of [
      "Attendance history import",
      "Attended",
      "Blacklisted history",
      "Cancelled last minute",
      "Match reason",
      "Search / Change Match",
      "Approve",
      "Reject",
      "Rematch",
      "Create normal profile",
    ]) {
      expect(source).toContain(text);
    }
  });

  it("explains that blacklisted history does not set Do Not Call", () => {
    expect(source).toContain("does not automatically mark a contact or phone Do Not Call");
  });
});
