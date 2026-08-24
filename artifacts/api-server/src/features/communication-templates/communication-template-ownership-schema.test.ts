import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { communicationTemplates } from "@workspace/db";

const migrationRunner = readFileSync("../../../lib/db/src/business-drive-migrations.ts", "utf8");

describe("communication template ownership schema", () => {
  it("exports ownership and provenance columns", () => {
    expect(communicationTemplates.ownerKind).toBeDefined();
    expect(communicationTemplates.ownerOfficeAccountId).toBeDefined();
    expect(communicationTemplates.createdByKind).toBeDefined();
    expect(communicationTemplates.createdById).toBeDefined();
    expect(communicationTemplates.sourceTemplateId).toBeDefined();
  });

  it("registers the ownership migration with the production migration runner", () => {
    expect(migrationRunner).toContain('name: "20260824_office_template_ownership.sql"');
    expect(migrationRunner).toContain("owner_kind");
  });
});
