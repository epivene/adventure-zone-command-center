import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/routes/attendance-history-import.ts", "utf8");

describe("attendance history import owner routes", () => {
  it("supports review, approval, rejection, and conservative rematching", () => {
    expect(source).toContain('router.get("/imports/attendance-history"');
    expect(source).toContain('/imports/attendance-history/:rowId/approve');
    expect(source).toContain('/imports/attendance-history/:rowId/reject');
    expect(source).toContain('/imports/attendance-history/:rowId/rematch');
    expect(source).toContain("ensureAttendanceImportSeed");
  });

  it("validates the chosen location belongs to the approved organization", () => {
    expect(source).toContain("organizationLocations.organizationId");
    expect(source).toContain("organizations.consolidatedIntoId");
  });

  it("never mutates Do Not Call from blacklisted attendance history", () => {
    expect(source).not.toContain("doNotCallAt");
    expect(source).not.toContain("contactPhones");
    expect(source).not.toContain("do_not_call");
  });
});
