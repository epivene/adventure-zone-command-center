import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("organization merge route subset safety", () => {
  it("prepares the selected subset and clears stale broader proposals before merging", () => {
    const source = readFileSync(new URL("./organizations.ts", import.meta.url), "utf8");

    expect(source).toContain("prepareSelectedProfileSubsetMerge");
    expect(source).toContain("prepareSelectedProfileSubsetMerge(transaction, [primaryId, ...duplicateIds])");
    expect(source).not.toContain("assertOrganizationsMergeable(transaction, [primaryId, ...duplicateIds])");
  });
});
