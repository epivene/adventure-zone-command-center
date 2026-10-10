import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const office = readFileSync("src/pages/OfficeProfilePage.tsx", "utf8");
const boss = readFileSync("src/components/profiles/simple-full-profile.tsx", "utf8");
const officeEmail = readFileSync("src/components/profiles/office-profile-latest-email.tsx", "utf8");

describe("role-specific profile highlights", () => {
  it("puts the latest Office note and account-scoped email draft in the shared highlight layout", () => {
    expect(office).toContain("<ProfileLatestNote");
    expect(office).toContain("<OfficeProfileLatestEmail");
    expect(office).toContain('officeGet<{drafts:OfficeEmailDraft[]}>("/office/email-drafts")');
    expect(office).toContain("draft.organizationId===profileId");
    expect(officeEmail).toContain("/office/emails?");
    expect(officeEmail).not.toContain('href={`/emails?');
  });

  it("keeps Boss email previews read-only and uses Boss-authorized reads and navigation", () => {
    expect(boss).toContain("readOnly={boss}");
    expect(boss).toContain("getThread={boss ? getBossThread : undefined}");
    expect(boss).toContain("getBossProfileEmails");
    expect(boss).toContain("/boss/profiles/${encodeURIComponent(profile.id)}?section=emails");
    expect(boss).toContain("editActivity={boss ? undefined");
  });

  it("preserves Office contract, email, profile-edit, and note actions", () => {
    for (const action of ["Create Contract", "Draft Email", "Edit Profile", "Add Note"]) {
      expect(office).toContain(action);
    }
  });
});
