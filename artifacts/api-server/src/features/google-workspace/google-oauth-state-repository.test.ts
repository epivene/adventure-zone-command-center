import { describe, expect, it } from "vitest";

import {
  PostgresGoogleOAuthStateRepository,
  hashGoogleOAuthState,
} from "./google-oauth-state-repository";

type StoredState = {
  stateHash: string;
  returnPath: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

function statefulPool() {
  const states = new Map<string, StoredState>();
  const calls: Array<{ text: string; values: unknown[] }> = [];

  return {
    states,
    calls,
    async query(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      if (text.includes("INSERT INTO google_workspace_oauth_states")) {
        states.set(String(values[0]), {
          stateHash: String(values[0]),
          returnPath: String(values[1]),
          expiresAt: values[2] as Date,
          consumedAt: null,
        });
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("UPDATE google_workspace_oauth_states")) {
        const record = states.get(String(values[0]));
        const now = values[1] as Date;
        if (!record || record.consumedAt || record.expiresAt <= now) {
          return { rows: [], rowCount: 0 };
        }
        record.consumedAt = now;
        return { rows: [{ return_path: record.returnPath }], rowCount: 1 };
      }
      if (text.includes("DELETE FROM google_workspace_oauth_states")) {
        let deleted = 0;
        for (const [key, record] of states) {
          if (record.expiresAt <= (values[0] as Date)) {
            states.delete(key);
            deleted += 1;
          }
        }
        return { rows: [{ deleted_count: deleted }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
}

describe("PostgresGoogleOAuthStateRepository", () => {
  it("stores only the SHA-256 state hash", async () => {
    const pool = statefulPool();
    const repository = new PostgresGoogleOAuthStateRepository(pool);
    const state = "raw-oauth-state-that-must-never-be-persisted";

    await repository.create({
      state,
      returnPath: "/settings/google-workspace",
      expiresAt: new Date("2026-08-22T18:10:00.000Z"),
    });

    const call = pool.calls[0];
    expect(call?.values).not.toContain(state);
    expect(call?.values[0]).toBe(hashGoogleOAuthState(state));
    expect(String(call?.values[0])).toHaveLength(64);
  });

  it("consumes valid state exactly once with one atomic update", async () => {
    const pool = statefulPool();
    const repository = new PostgresGoogleOAuthStateRepository(pool);
    const state = "single-use-state";

    await repository.create({
      state,
      returnPath: "/settings/google-workspace?connected=1",
      expiresAt: new Date("2026-08-22T18:10:00.000Z"),
    });

    await expect(
      repository.consume({
        state,
        now: new Date("2026-08-22T18:05:00.000Z"),
      }),
    ).resolves.toEqual({
      returnPath: "/settings/google-workspace?connected=1",
    });
    await expect(
      repository.consume({
        state,
        now: new Date("2026-08-22T18:06:00.000Z"),
      }),
    ).resolves.toBeNull();

    const updateSql = pool.calls.find((call) =>
      call.text.includes("UPDATE google_workspace_oauth_states"),
    )?.text;
    expect(updateSql).toContain("consumed_at IS NULL");
    expect(updateSql).toContain("expires_at > $2");
    expect(updateSql).toContain("RETURNING return_path");
  });

  it("rejects expired state", async () => {
    const pool = statefulPool();
    const repository = new PostgresGoogleOAuthStateRepository(pool);
    const state = "expired-state";

    await repository.create({
      state,
      returnPath: "/settings/google-workspace",
      expiresAt: new Date("2026-08-22T18:00:00.000Z"),
    });

    await expect(
      repository.consume({
        state,
        now: new Date("2026-08-22T18:00:00.000Z"),
      }),
    ).resolves.toBeNull();
  });

  it("deletes expired state records without touching live state", async () => {
    const pool = statefulPool();
    const repository = new PostgresGoogleOAuthStateRepository(pool);

    await repository.create({
      state: "expired",
      returnPath: "/expired",
      expiresAt: new Date("2026-08-22T18:00:00.000Z"),
    });
    await repository.create({
      state: "live",
      returnPath: "/live",
      expiresAt: new Date("2026-08-22T18:20:00.000Z"),
    });

    await expect(
      repository.deleteExpired(new Date("2026-08-22T18:10:00.000Z")),
    ).resolves.toBe(1);
    expect(pool.states.has(hashGoogleOAuthState("expired"))).toBe(false);
    expect(pool.states.has(hashGoogleOAuthState("live"))).toBe(true);
  });
});
