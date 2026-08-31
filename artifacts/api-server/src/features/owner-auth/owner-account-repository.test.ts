import { describe, expect, it, vi } from "vitest";

import { PostgresOwnerAccountRepository } from "./owner-account-repository";

const ownerRow = {
  id: "30000000-0000-4000-8000-000000000001",
  login_name: "desiree",
  display_name: "Desiree",
  role: "owner",
  password_hash: "hash",
  password_salt: "salt",
  enabled: true,
  session_version: "1",
};

describe("PostgresOwnerAccountRepository", () => {
  it("creates the singleton owner transactionally and adopts only compatible legacy actor rows", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("FROM owner_accounts") && sql.includes("FOR UPDATE")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO owner_accounts")) {
        return { rows: [ownerRow] };
      }
      if (sql.includes("information_schema.columns")) {
        return { rows: [{ has_actor_id: values?.[0] !== "assistant_jobs" }] };
      }
      return { rows: [] };
    });
    const release = vi.fn();
    const pool = {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue({ query, release }),
    };

    const owner = await new PostgresOwnerAccountRepository(pool as never).createPrimary({
      loginName: " desiree ",
      displayName: " Desiree ",
      passwordHash: "hash",
      passwordSalt: "salt",
    });

    expect(owner).toMatchObject({
      id: ownerRow.id,
      loginName: "desiree",
      displayName: "Desiree",
      role: "owner",
      sessionVersion: 1,
    });
    expect(query.mock.calls[0]?.[0]).toBe("BEGIN");
    expect(query.mock.calls.some(([sql]) => String(sql).includes("pg_advisory_xact_lock"))).toBe(true);
    expect(query.mock.calls.some(([sql, values]) =>
      String(sql).includes("UPDATE assistant_conversations") && values?.[0] === ownerRow.id,
    )).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("UPDATE assistant_jobs"))).toBe(false);
    expect(query.mock.calls.some(([sql, values]) =>
      String(sql).includes("UPDATE lead_scout_runs") && values?.[0] === ownerRow.id,
    )).toBe(true);
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("returns the existing primary owner instead of inserting a second account", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM owner_accounts") && sql.includes("FOR UPDATE")) {
        return { rows: [ownerRow] };
      }
      return { rows: [] };
    });
    const release = vi.fn();
    const pool = {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue({ query, release }),
    };

    const owner = await new PostgresOwnerAccountRepository(pool as never).createPrimary({
      loginName: "other",
      displayName: "Other",
      passwordHash: "other-hash",
      passwordSalt: "other-salt",
    });

    expect(owner.id).toBe(ownerRow.id);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO owner_accounts"))).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });
});
