import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/routes/resource-source-candidates.ts", "utf8");

describe("resource source candidate owner routes", () => {
  it("supports review, explicit linking, and reasoned ignore only", () => {
    expect(source).toContain('router.get("/settings/resource-source-candidates"');
    expect(source).toContain('/settings/resource-source-candidates/:candidateId/link');
    expect(source).toContain('/settings/resource-source-candidates/:candidateId/ignore');
    expect(source).toContain("canApplySourceIdentity");
    expect(source).toContain("409");
    expect(source).toContain("reason");
    expect(source).not.toContain("create-resource");
  });

  it("does not allow source identity to be linked to archived equipment", () => {
    expect(source).toContain('resource.status === "archived"');
    expect(source).toContain("Archived resources cannot receive imported asset identity");
  });
});
