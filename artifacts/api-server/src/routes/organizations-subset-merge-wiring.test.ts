import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("organization merge route subset safety", () => {
  it("uses the selected-profile subset guard instead of the broad family proposal guard", () => {
    const source = readFileSync(new URL("./organizations.ts", import.meta.url), "utf8");

    expect(source).toContain("assertSelectedProfileSubsetMergeable");
    expect(source).toContain("assertSelectedProfileSubsetMergeable(transaction, [primaryId, ...duplicateIds])");
    expect(source).not.toContain("assertOrganizationsMergeable(transaction, [primaryId, ...duplicateIds])");
  });
});
