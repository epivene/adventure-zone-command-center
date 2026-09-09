import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/routes/communication-templates.ts", "utf8");

describe("owner communication template administration", () => {
  it("creates real templates as owner-managed drafts", () => {
    expect(source).toContain('router.post("/communication-templates"');
    expect(source).toContain('state: "draft"');
    expect(source).toContain('ownerKind: "company"');
    expect(source).toContain("communicationTemplateWriteSchema.safeParse");
  });

  it("returns template ownership and coordinator display provenance", () => {
    expect(source).toContain("ownerKind");
    expect(source).toContain("creatorDisplayName");
    expect(source).toContain("officeAccounts.displayName");
    expect(source).not.toContain("passwordHash");
    expect(source).not.toContain("passwordSalt");
  });

  it("requires Dave approval instead of direct company-template activation", () => {
    expect(source).toContain('router.post("/communication-templates/:templateId/request-dave-approval"');
    expect(source).toContain("Approval activates the exact reviewed revision automatically");
    expect(source).toContain("templateFingerprint");
  });

  it("provides an owner-only promotion endpoint", () => {
    expect(source).toContain('router.post("/communication-templates/:templateId/promote-shared"');
    expect(source).toContain("promoteToShared");
  });
});
