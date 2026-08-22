import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ownerSource = readFileSync("src/pages/EventProfilePage.tsx", "utf8");
const officeSource = readFileSync("src/pages/OfficeProfilePage.tsx", "utf8");

describe("profile attendance history wiring", () => {
  it("uses the owner attendance endpoint on the owner profile", () => {
    expect(ownerSource).toContain("AttendanceHistoryCard");
    expect(ownerSource).toContain("/attendance-history");
    expect(ownerSource).toContain("apiGet<{ history: ProfileAttendanceHistoryItem[] }>");
  });

  it("uses only the Office-filtered attendance endpoint in Office Coordinator", () => {
    expect(officeSource).toContain("AttendanceHistoryCard");
    expect(officeSource).toContain("officeGet<{history:ProfileAttendanceHistoryItem[]}>");
    expect(officeSource).toContain("`/office/profiles/${profileId}/attendance-history`");
    expect(officeSource).not.toContain("apiGet<{ history: ProfileAttendanceHistoryItem[] }>");
  });
});
