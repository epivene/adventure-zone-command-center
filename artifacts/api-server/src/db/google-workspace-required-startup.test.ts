import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ensureGoogleWorkspaceSchemaBeforeListen } from "./google-workspace-required-startup";

function fakeClient(locked = true) {
  return {
    query: vi.fn(async (sql: string) => ({
      rows: sql.includes("pg_try_advisory_lock") ? [{ locked }] : [],
    })),
    release: vi.fn(),
  };
}

describe("ensureGoogleWorkspaceSchemaBeforeListen", () => {
  it("uses a non-blocking advisory lock and always releases it", async () => {
    const client = fakeClient(true);
    const ensureSchema = vi.fn(async () => true);
    const pool = { connect: vi.fn(async () => client) };

    await expect(
      ensureGoogleWorkspaceSchemaBeforeListen({ pool, ensureSchema }),
    ).resolves.toBe(true);

    expect(client.query).toHaveBeenNthCalledWith(
      1,
      "SELECT pg_try_advisory_lock(hashtext('adventure-zone:google-workspace-schema')) AS locked",
    );
    expect(ensureSchema).toHaveBeenCalledWith(client);
    expect(client.query).toHaveBeenLastCalledWith(
      "SELECT pg_advisory_unlock(hashtext('adventure-zone:google-workspace-schema'))",
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("fails immediately when another process owns the schema lock", async () => {
    const client = fakeClient(false);
    const ensureSchema = vi.fn(async () => true);
    const pool = { connect: vi.fn(async () => client) };

    await expect(
      ensureGoogleWorkspaceSchemaBeforeListen({ pool, ensureSchema }),
    ).rejects.toThrow("GOOGLE_WORKSPACE_SCHEMA_LOCK_BUSY");
    expect(ensureSchema).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("ensures the schema before the server begins listening", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/index.ts"), "utf8");
    const ensureAt = source.indexOf('"required Google Workspace schema"');
    const listenAt = source.indexOf("const server = app.listen");

    expect(ensureAt).toBeGreaterThan(-1);
    expect(listenAt).toBeGreaterThan(-1);
    expect(ensureAt).toBeLessThan(listenAt);
  });

  it("bounds DDL lock waits and only creates Google Workspace tables", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "src/db/google-workspace-startup-migration.ts"),
      "utf8",
    );

    expect(source).toContain("SET lock_timeout = '5s'");
    expect(source).toContain("RESET lock_timeout");
    expect(source).not.toContain("ALTER TABLE organizations");
    expect(source).not.toContain("ALTER TABLE contacts");
    expect(source).not.toContain("ALTER TABLE bookings");
    expect(source).not.toContain("ALTER TABLE activities");
    expect(source).toContain("google_workspace_connections");
    expect(source).toContain("google_workspace_label_scopes");
    expect(source).toContain("google_workspace_calendar_scopes");
  });
});
