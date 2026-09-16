import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(process.cwd(), "../..");
const officeSchemaPath = path.join(repoRoot, "lib/db/src/office-coordinator-schema.ts");
const migrationPath = path.join(repoRoot, "lib/db/migrations/20260821_office_coordinator_workspace.sql");
const dbIndexPath = path.join(repoRoot, "lib/db/src/index.ts");
const dbPackagePath = path.join(repoRoot, "lib/db/package.json");
const apiSchemaPath = path.join(repoRoot, "artifacts/api-server/src/db/schema.ts");

describe("Office Coordinator database contract", () => {
  it("defines durable office tables and constrained workflow values", () => {
    expect(existsSync(officeSchemaPath)).toBe(true);
    if (!existsSync(officeSchemaPath)) return;

    const source = readFileSync(officeSchemaPath, "utf8");
    for (const table of [
      "office_accounts",
      "office_tasks",
      "office_mail_activity",
      "office_email_drafts",
      "office_messages",
    ]) {
      expect(source).toContain(`\"${table}\"`);
    }
    expect(source).toContain('officeRoleValues = ["office_coordinator"]');
    expect(source).toContain('"contact_verification"');
    expect(source).toContain('"mail_brochure"');
    expect(source).toContain('"draft_email"');
    expect(source).toContain('"cancelled"');
    expect(source).toContain('"gmail_draft"');
    expect(source).toContain('"scheduled"');
    expect(source).toContain('"failed"');
    expect(source).toContain('"sending"');
    expect(source).toContain('officeEmailBodyFormatValues = ["plain_text", "html"]');
    expect(source).toContain('officeAccountId: uuid("office_account_id")');
    expect(source).toContain('ownerSortOrder: bigint("owner_sort_order"');
  });

  it("creates the SQL constraints and indexes needed by the office queue", () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migration = readFileSync(migrationPath, "utf8").toLowerCase();
    expect(migration).toContain("create table if not exists office_accounts");
    expect(migration).toContain("create unique index");
    expect(migration).toContain("lower(login_name)");
    expect(migration).toContain("office_tasks_account_status_order_idx");
    expect(migration).toContain("office_tasks_needs_help_idx");
    expect(migration).toContain("office_email_drafts_state_submitted_idx");
    expect(migration).toContain("office_mail_activity_profile_mailed_idx");
    expect(migration).toContain("office_messages_account_created_idx");
    expect(migration).toContain("alter table organizations add column if not exists description text");
  });

  it("exports the office schema through the database and API packages", () => {
    const dbIndex = readFileSync(dbIndexPath, "utf8");
    const dbPackage = readFileSync(dbPackagePath, "utf8");
    const apiSchema = readFileSync(apiSchemaPath, "utf8");

    expect(dbIndex).toContain('from "./office-coordinator-schema"');
    expect(dbIndex).toContain('export * from "./office-coordinator-schema"');
    expect(dbPackage).toContain('"./office-coordinator-schema"');
    expect(apiSchema).toContain('@workspace/db/office-coordinator-schema');
  });
});
