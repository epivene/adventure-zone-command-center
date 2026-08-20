import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "../../lib/db/migrations/066_paper_notes_importer.sql");

describe("Paper Notes migration SQL", () => {
  it("quotes the reserved primary identifier for organization phones", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain('"primary" boolean not null default false');
    expect(migration).toContain('where organization_location_id is null and "primary" and status = \'active\'');
    expect(migration).toContain('where organization_location_id is not null and "primary" and status = \'active\'');
    expect(migration).not.toMatch(/\n\s*primary boolean\b/i);
  });
});
