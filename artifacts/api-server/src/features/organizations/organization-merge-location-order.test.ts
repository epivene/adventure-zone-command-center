import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("duplicate organization merge location ordering", () => {
  it("moves duplicate locations to the survivor before re-parenting location-linked contacts", () => {
    const repositoryPath = fileURLToPath(new URL("./organization-repository.ts", import.meta.url));
    const source = readFileSync(repositoryPath, "utf8");
    const mergeStart = source.indexOf("async mergeOrganizations(primaryId: string");
    const mergeSource = source.slice(mergeStart);
    const locationMove = mergeSource.indexOf(".where(eq(organizationLocations.organizationId, dupId))");
    const contactMove = mergeSource.indexOf(".where(eq(contacts.organizationId, dupId))");
    expect(locationMove).toBeGreaterThanOrEqual(0);
    expect(contactMove).toBeGreaterThanOrEqual(0);
    expect(locationMove).toBeLessThan(contactMove);
  });
});
