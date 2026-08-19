import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve(__dirname, "source-scout-bulk-intake.tsx"), "utf8");

describe("SourceScoutBulkIntake", () => {
  it("selects only new prospects and requires shared first follow-up defaults", () => {
    expect(source).toContain("Select all new");
    expect(source).toContain("Create selected leads");
    expect(source).toContain("First action");
    expect(source).toContain("First follow-up date");
    expect(source).toContain('event.crmMatch?.status === "new_prospect"');
    expect(source).toContain('/profile-research/bulk-intake');
  });

  it("keeps existing and possible matches review-only", () => {
    expect(source).toContain("Already in Command Center");
    expect(source).toContain("Possible match");
    expect(source).toContain("Review possible match");
  });
});
