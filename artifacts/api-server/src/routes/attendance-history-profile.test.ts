import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const owner = readFileSync("src/routes/attendance-history-profile.ts", "utf8");
const office = readFileSync("src/routes/office-attendance-history.ts", "utf8");

describe("profile attendance history routes", () => {
  it("exposes all approved history to owner profiles", () => {
    expect(owner).toContain('/event-profiles/:id/attendance-history');
    expect(owner).toContain('listForOrganization(id, "owner")');
  });

  it("uses server-side Office-safe history filtering", () => {
    expect(office).toContain('/office/profiles/:profileId/attendance-history');
    expect(office).toContain('listForOrganization(profileId, "office")');
    expect(office).toContain("requireOffice");
  });
});
