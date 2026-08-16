import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../../../../../", import.meta.url);

async function read(path: string) {
  return readFile(new URL(path, root), "utf8");
}

describe("manual organization membership schema", () => {
  it("defines a non-destructive parent organization reference and registered migration", async () => {
    const [schema, migration, registry] = await Promise.all([
      read("lib/db/src/schema/index.ts"),
      read("lib/db/migrations/042_manual_organization_membership.sql"),
      read("lib/db/src/migrations.ts"),
    ]);

    expect(schema).toContain('parentOrganizationId: uuid("parent_organization_id").references(');
    expect(schema).toContain('index("organizations_parent_organization_id_idx").on(table.parentOrganizationId)');
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS parent_organization_id uuid");
    expect(migration).toContain("organizations_parent_organization_id_fkey");
    expect(migration).toContain("REFERENCES organizations(id) ON DELETE RESTRICT");
    expect(migration).toContain("organizations_parent_organization_id_idx");
    expect(registry).toContain('name: "042_manual_organization_membership.sql"');
    expect(registry).toContain("parent_organization_id");
  });
});
