import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as workspaceDb from "@workspace/db";

describe("event family website/contact schema", () => {
  it("defines family website, family-contact relationship, migration, and startup registry", () => {
    const familyColumns = getTableColumns(workspaceDb.eventFamilies);
    expect(familyColumns).toHaveProperty("website");
    expect(workspaceDb).toHaveProperty("eventFamilyContacts");

    const migrationPath = resolve(process.cwd(), "../../lib/db/migrations/043_event_family_website_contacts.sql");
    expect(existsSync(migrationPath)).toBe(true);
    if (existsSync(migrationPath)) {
      const sql = readFileSync(migrationPath, "utf8");
      const normalizedSql = sql.replace(/\s+/g, " ");
      expect(normalizedSql).toContain("ALTER TABLE event_families ADD COLUMN IF NOT EXISTS website text");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS event_family_contacts");
      expect(sql).toContain("UNIQUE (family_id, contact_id)");
      expect(sql).toContain("event_family_contacts_one_primary_per_family");
      expect(normalizedSql).toContain("WHERE is_primary = true");
    }

    const registry = readFileSync(resolve(process.cwd(), "../../lib/db/src/migrations.ts"), "utf8");
    expect(registry).toContain('name: "043_event_family_website_contacts.sql"');
  });
});
