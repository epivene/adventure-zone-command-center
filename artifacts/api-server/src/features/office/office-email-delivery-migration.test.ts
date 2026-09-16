import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(process.cwd(), "../..");
const readRepoFile = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8").toLowerCase();

describe("profile HTML email delivery migration", () => {
  it("adds delivery data without rewriting existing draft rows", () => {
    const migration = readRepoFile("lib/db/migrations/20260912_profile_html_email_delivery.sql");

    for (const column of [
      "body_format",
      "design_project_id",
      "design_version_id",
      "scheduled_for",
      "business_time_zone",
      "gmail_draft_id",
      "gmail_message_id",
      "gmail_thread_id",
      "send_request_key",
      "schedule_request_key",
      "dispatch_lease_owner",
      "dispatch_lease_expires_at",
      "dispatch_attempt_count",
      "last_attempt_at",
      "next_attempt_at",
      "last_failure_code",
      "last_failure_message",
    ]) {
      expect(migration).toContain(`add column if not exists ${column}`);
    }

    expect(migration).toContain("office_email_drafts_design_project_fk");
    expect(migration).toContain("office_email_drafts_design_version_fk");
    expect(migration).toContain("office_email_drafts_send_request_unique");
    expect(migration).toContain("office_email_drafts_schedule_request_unique");
    expect(migration).toContain("office_email_drafts_dispatch_idx");
    expect(migration).not.toContain("update office_email_drafts");
  });

  it("keeps the Drizzle and startup-repair contracts aligned", () => {
    const schema = readRepoFile("lib/db/src/office-coordinator-schema.ts");
    const startup = readRepoFile(
      "artifacts/api-server/src/db/office-coordinator-startup-migration.ts",
    );

    for (const state of [
      "gmail_draft",
      "scheduled",
      "sending",
      "sent",
      "failed",
      "cancelled",
    ]) {
      expect(schema).toContain(`\"${state}\"`);
      expect(startup).toContain(`'${state}'`);
    }
    expect(schema).toContain('officeemailbodyformatvalues = ["plain_text", "html"]');
    expect(startup).toContain("office_email_drafts_body_format_valid");
    expect(startup).toContain("office_email_drafts_dispatch_idx");
  });

  it("registers a readiness marker for the additive migration", () => {
    const registry = readRepoFile("lib/db/src/migrations.ts");

    expect(registry).toContain("20260912_profile_html_email_delivery.sql");
    expect(registry).toContain("office_email_drafts_design_project_unique");
    expect(registry).toContain("office_email_drafts_design_version_fk");
    expect(registry).toContain("count(*) = 17");
  });
});
