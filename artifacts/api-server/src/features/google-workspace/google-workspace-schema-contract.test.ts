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
const operationalCalendarMigrationPath = path.join(
  repositoryRoot,
  "lib/db/migrations/20260828_operational_calendar_connection.sql",
);
const profileLabelMigrationPath = path.join(
  repositoryRoot,
  "lib/db/migrations/20260908_gmail_profile_label_sync.sql",
);
const renderPath = path.join(repositoryRoot, "render.yaml");

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

  it("keeps workspace and operational-calendar credentials separate for the same account", () => {
    const migration = source(operationalCalendarMigrationPath).toLowerCase();

    expect(migration).toContain("drop constraint if exists google_workspace_connections_account_email_unique");
    expect(migration).toContain("google_workspace_connections_account_email_role_unique");
    expect(migration).toContain("unique (account_email, role)");
  });


  it("enforces one stable Gmail label per profile and retryable mutations", () => {
    const schema = source(schemaPath);
    const migration = source(profileLabelMigrationPath).toLowerCase();

    expect(schema).toContain("export const googleWorkspaceProfileLabels");
    expect(schema).toContain("export const googleWorkspaceGmailMutations");
    expect(migration).toContain(
      "google_workspace_profile_labels_connection_organization_unique",
    );
    expect(migration).toContain(
      "google_workspace_profile_labels_connection_label_unique",
    );
    expect(migration).toContain(
      "google_workspace_gmail_mutations_idempotency_unique",
    );
    expect(migration).toContain("google_workspace_gmail_mutations_retry_idx");
    expect(migration).toContain("gmail_sync_state");
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

  it("keeps all Google credentials server-only and historical processing disabled", () => {
    const render = source(renderPath);

    for (const key of [
      "GOOGLE_WORKSPACE_CLIENT_ID",
      "GOOGLE_WORKSPACE_CLIENT_SECRET",
      "GOOGLE_WORKSPACE_REDIRECT_URI",
      "GOOGLE_WORKSPACE_APP_ORIGIN",
      "GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY",
    ]) {
      expect(render).toContain(`- key: ${key}\n        sync: false`);
    }
    expect(render).toContain(
      '- key: GOOGLE_WORKSPACE_SYNC_ENABLED\n        value: "false"',
    );
    expect(render).toContain(
      '- key: GOOGLE_WORKSPACE_AI_ENABLED\n        value: "true"',
    );
    expect(render).not.toContain("VITE_GOOGLE_WORKSPACE_");
  });
});
