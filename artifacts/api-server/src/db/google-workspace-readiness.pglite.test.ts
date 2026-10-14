import { PGlite } from "@electric-sql/pglite";
import { it, expect, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: {} }));
import { ensureGoogleWorkspaceSchemaBeforeListen } from "./google-workspace-required-startup";
import {
  isGoogleWorkspaceSchemaReady,
  isOperationalCalendarSchemaReady,
} from "./google-workspace-schema-readiness";
it("installs both schemas, skips installed work, and repairs missing review columns", async () => {
  const db = new PGlite();
  const statements: string[] = [];
  const client = {
    query: async (sql: string) => {
      statements.push(sql);
      const r = await db.exec(
        sql.replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""),
      );
      return { rows: (r.at(-1)?.rows ?? []) as Array<Record<string, unknown>> };
    },
    release: vi.fn(),
  };
  const run = () =>
    ensureGoogleWorkspaceSchemaBeforeListen({
      pool: { connect: async () => client },
    });
  try {
    await db.exec(
      "CREATE TABLE organizations(id uuid PRIMARY KEY); CREATE TABLE contacts(id uuid PRIMARY KEY); CREATE TABLE bookings(id uuid PRIMARY KEY);",
    );
    await run();
    expect(await isGoogleWorkspaceSchemaReady(client)).toBe(true);
    expect(await isOperationalCalendarSchemaReady(client)).toBe(true);
    const indexes = await db.query(
      "SELECT oid FROM pg_class WHERE relname='google_workspace_connections_active_role_unique'",
    );
    statements.length = 0;
    await run();
    expect(
      statements.some((s) => /ALTER TABLE|CREATE TABLE|advisory/.test(s)),
    ).toBe(false);
    expect(
      await db.query(
        "SELECT oid FROM pg_class WHERE relname='google_workspace_connections_active_role_unique'",
      ),
    ).toEqual(indexes);
    await db.exec(
      "ALTER TABLE google_workspace_validation_review_items DROP COLUMN reviewed_by",
    );
    expect(await isGoogleWorkspaceSchemaReady(client)).toBe(false);
    await run();
    expect(await isGoogleWorkspaceSchemaReady(client)).toBe(true);
    await db.exec("DROP INDEX google_workspace_connections_active_role_unique");
    expect(await isOperationalCalendarSchemaReady(client)).toBe(false);
    await run();
    expect(await isOperationalCalendarSchemaReady(client)).toBe(true);
  } finally {
    await db.close();
  }
});
