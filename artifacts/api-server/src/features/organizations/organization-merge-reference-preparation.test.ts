import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("organization merge dependent reference preparation", () => {
  it("reparents activity associations before deleting redundant duplicate associations", () => {
    const path = fileURLToPath(new URL("./organization-merge-reference-preparation.ts", import.meta.url));
    const source = readFileSync(path, "utf8");

    const activityUpdate = source.indexOf("UPDATE activity_associations AS duplicate_association");
    const duplicateAssociationDelete = source.indexOf("DELETE FROM activity_associations");

    expect(activityUpdate).toBeGreaterThanOrEqual(0);
    expect(source).toContain("surviving_association.activity_id = duplicate_association.activity_id");
    expect(source).toContain("surviving_association.organization_id = ${primaryId}");
    expect(duplicateAssociationDelete).toBeGreaterThan(activityUpdate);
  });

  it("preserves other organization references that can otherwise block or orphan a merge", () => {
    const path = fileURLToPath(new URL("./organization-merge-reference-preparation.ts", import.meta.url));
    const source = readFileSync(path, "utf8");

    expect(source).toContain("UPDATE ai_booking_suggestions");
    expect(source).toContain("UPDATE event_family_members");
    expect(source).toContain("parent_organization_id = ${primaryId}");
  });

  it("runs merge preparation before the repository deletes duplicate organizations", () => {
    const routePath = fileURLToPath(new URL("../../routes/organizations.ts", import.meta.url));
    const source = readFileSync(routePath, "utf8");
    const transaction = source.indexOf("await db.transaction(async (transaction)");
    const prepare = source.indexOf("prepareOrganizationMergeReferences(transaction, primaryId, duplicateIds)");
    const merge = source.indexOf("orgRepo().mergeOrganizations(primaryId, duplicateIds, transaction)");

    expect(transaction).toBeGreaterThanOrEqual(0);
    expect(prepare).toBeGreaterThanOrEqual(0);
    expect(merge).toBeGreaterThan(prepare);
  });
});
