import { describe, expect, it } from "vitest";

import { ensureGoogleWorkspaceSchema } from "./google-workspace-startup-migration";

describe("ensureGoogleWorkspaceSchema review upgrades", () => {
  it("adds review audit columns for an already-existing validation review table", async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        return { rows: [] };
      },
    };

    await ensureGoogleWorkspaceSchema(client);

    const ddl = queries.join("\n");
    expect(ddl).toContain(
      "ALTER TABLE google_workspace_validation_review_items ADD COLUMN IF NOT EXISTS reviewed_by text",
    );
    expect(ddl).toContain(
      "ALTER TABLE google_workspace_validation_review_items ADD COLUMN IF NOT EXISTS reviewed_at timestamptz",
    );
  });

  it("does not recreate the legacy single-active index before role upgrade runs", async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        return { rows: [] };
      },
    };

    await ensureGoogleWorkspaceSchema(client);

    expect(queries.join("\n")).not.toContain(
      "google_workspace_connections_single_active_unique",
    );
  });
});
