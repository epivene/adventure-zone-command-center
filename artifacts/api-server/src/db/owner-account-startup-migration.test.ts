import { describe, expect, it, vi } from "vitest";

import { ensureOwnerAccountSchema } from "./owner-account-startup-migration";

describe("ensureOwnerAccountSchema", () => {
  it("repairs columns, constraints, and indexes idempotently", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await expect(ensureOwnerAccountSchema({ query })).resolves.toBe(true);

    const migrationSql = String(query.mock.calls[1]?.[0] ?? "");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS owner_accounts");
    expect(migrationSql).toContain("ADD COLUMN IF NOT EXISTS singleton_key");
    expect(migrationSql).toContain("ALTER COLUMN session_version SET NOT NULL");
    expect(migrationSql).toContain("FROM pg_constraint");
    expect(migrationSql).toContain("owner_accounts_singleton_valid");
    expect(migrationSql).toContain("owner_accounts_role_valid");
    expect(migrationSql).toContain("owner_accounts_session_version_positive");
    expect(migrationSql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS owner_accounts_singleton_unique");
    expect(query.mock.calls.at(-1)?.[0]).toBe("RESET lock_timeout");
  });
});
