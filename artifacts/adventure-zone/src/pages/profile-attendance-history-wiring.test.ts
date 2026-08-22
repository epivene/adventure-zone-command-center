import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ownerSource = readFileSync("src/pages/EventProfilePage.tsx", "utf8");
const officeSource = readFileSync("src/pages/OfficeProfilePage.tsx", "utf8");

describe("profile attendance history wiring", () => {
  it("uses the owner-scoped attendance panel on the owner profile", () => {
    expect(ownerSource).toContain("AttendanceHistoryPanel");
    expect(ownerSource).toContain('<AttendanceHistoryPanel mode="owner" profileId={profileId} />');
  });

  it("uses the Office-scoped attendance panel in Office Coordinator", () => {
    expect(officeSource).toContain("AttendanceHistoryPanel");
    expect(officeSource).toContain('<AttendanceHistoryPanel mode="office" profileId={profileId} />');
    expect(officeSource).not.toContain('mode="owner"');
  });
});
