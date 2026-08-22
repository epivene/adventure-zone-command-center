import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const schemaPath = path.join(
  repositoryRoot,
  "lib/db/src/google-workspace-schema.ts",
);
const migrationPath = path.join(
  repositoryRoot,
  "lib/db/migrations/20260822_google_workspace_foundation.sql",
);

function source(pathname: string) {
  return readFileSync(pathname, "utf8");
}

describe("Google Workspace foundation schema", () => {
  it("defines every durable connection and scope table", () => {
    const schema = source(schemaPath);

    for (const exportName of [
      "googleWorkspaceConnections",
      "googleWorkspaceOauthStates",
      "googleWorkspaceLabelScopes",
      "googleWorkspaceCalendarScopes",
      "googleWorkspaceAuditEvents",
    ]) {
      expect(schema).toContain(`export const ${exportName}`);
    }
  });

  it("enforces Google identity, scope, and JSON integrity", () => {
    const migration = source(migrationPath).toLowerCase();

    expect(migration).toContain("google_workspace_connections_account_email_unique");
    expect(migration).toContain("google_workspace_connections_status_valid");
    expect(migration).toContain("jsonb_typeof(encrypted_refresh_token) = 'object'");
    expect(migration).toContain("jsonb_typeof(granted_scopes) = 'array'");
    expect(migration).toContain("unique (connection_id, label_id)");
    expect(migration).toContain("unique (connection_id, calendar_id)");
    expect(migration).toContain("on delete cascade");
  });

  it("stores only encrypted credentials", () => {
    const migration = source(migrationPath).toLowerCase();

    expect(migration).toContain("encrypted_refresh_token");
    expect(migration).not.toMatch(/\brefresh_token\s+text\b/);
    expect(migration).not.toMatch(/\baccess_token\b/);
    expect(migration).not.toMatch(/\bclient_secret\b/);
  });

  it("indexes unconsumed OAuth states and selected Google scope", () => {
    const migration = source(migrationPath).toLowerCase();

    expect(migration).toContain("google_workspace_oauth_states_unconsumed_expiry_idx");
    expect(migration).toContain("google_workspace_label_scopes_selected_idx");
    expect(migration).toContain("google_workspace_calendar_scopes_selected_idx");
    expect(migration).toContain("google_workspace_audit_events_created_idx");
  });
});
