import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/routes/communication-templates.ts", "utf8");

describe("owner communication template administration", () => {
  it("returns template ownership and coordinator display provenance", () => {
    expect(source).toContain("ownerKind");
    expect(source).toContain("creatorDisplayName");
    expect(source).toContain("officeAccounts.displayName");
    expect(source).not.toContain("passwordHash");
    expect(source).not.toContain("passwordSalt");
  });

  it("provides an owner-only promotion endpoint", () => {
    expect(source).toContain('router.post("/communication-templates/:templateId/promote-shared"');
    expect(source).toContain("promoteToShared");
  });
});
