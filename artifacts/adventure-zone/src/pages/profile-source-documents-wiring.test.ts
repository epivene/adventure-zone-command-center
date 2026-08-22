import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const owner = readFileSync("src/pages/EventProfilePage.tsx", "utf8");
const office = readFileSync("src/pages/OfficeProfilePage.tsx", "utf8");

describe("profile source document wiring", () => {
  it("renders owner source documents with owner scope", () => {
    expect(owner).toContain("ProfileSourceDocuments");
    expect(owner).toContain('<ProfileSourceDocuments mode="owner" profileId={profileId} />');
  });

  it("renders only Office-scoped source documents in Office Coordinator", () => {
    expect(office).toContain("ProfileSourceDocuments");
    expect(office).toContain('<ProfileSourceDocuments mode="office" profileId={profileId} />');
    expect(office).not.toContain('ProfileSourceDocuments mode="owner"');
  });
});
