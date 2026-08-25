import { describe, expect, it, vi } from "vitest";

import { GoogleHistoricalRunLease } from "./google-historical-run-lease";

function fakePool(updatedAt: Date) {
  const state = {
    status: "running",
    next_page_token: "same-page-token",
    processed_count: 0,
    updated_at: updatedAt,
  };
  let batchStatus = "running";
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    if (text.includes("FROM google_workspace_connections")) {
      return { rows: [{ id: "connection-id" }] };
    }
    if (
      text.includes("UPDATE google_workspace_historical_gmail_backfill_state") &&
      text.includes("status = 'error'") &&
      text.includes("RETURNING connection_id")
    ) {
      const staleMs = Number(values?.[1] ?? 0);
      if (state.status === "running" && Date.now() - state.updated_at.getTime() > staleMs) {
        state.status = "error";
        return { rows: [{ connection_id: "connection-id" }] };
      }
      return { rows: [] };
    }
    if (
      text.includes("UPDATE google_workspace_historical_gmail_batches") &&
      text.includes("status = 'error'")
    ) {
      if (batchStatus === "running") batchStatus = "error";
      return { rows: [] };
    }
    if (
      text.includes("UPDATE google_workspace_historical_gmail_backfill_state") &&
      text.includes("SET status = 'running'") &&
      text.includes("RETURNING connection_id")
    ) {
      if (state.status === "running") return { rows: [] };
      state.status = "running";
      state.updated_at = new Date();
      return { rows: [{ connection_id: "connection-id" }] };
    }
    if (
      text.includes("UPDATE google_workspace_historical_gmail_backfill_state") &&
      text.includes("SET updated_at = now()") &&
      text.includes("status = 'running'")
    ) {
      if (state.status === "running") state.updated_at = new Date();
      return { rows: [] };
    }
    return { rows: [] };
  });
  return { query, state, get batchStatus() { return batchStatus; } };
}

describe("GoogleHistoricalRunLease", () => {
  it("turns a stale running lease into retryable error without moving the Gmail cursor", async () => {
    const pool = fakePool(new Date(Date.now() - 10 * 60_000));
    const lease = new GoogleHistoricalRunLease(pool, { staleAfterMs: 120_000 });

    const recovered = await lease.recoverStale();

    expect(recovered).toBe(true);
    expect(pool.state.status).toBe("error");
    expect(pool.state.next_page_token).toBe("same-page-token");
    expect(pool.state.processed_count).toBe(0);
    expect(pool.batchStatus).toBe("error");
  });

  it("leaves a fresh running lease alone", async () => {
    const pool = fakePool(new Date());
    const lease = new GoogleHistoricalRunLease(pool, { staleAfterMs: 120_000 });

    await expect(lease.recoverStale()).resolves.toBe(false);
    expect(pool.state.status).toBe("running");
    expect(pool.batchStatus).toBe("running");
  });

  it("atomically refuses a second live run and refreshes the heartbeat for the owner request", async () => {
    const pool = fakePool(new Date(Date.now() - 10 * 60_000));
    pool.state.status = "error";
    const lease = new GoogleHistoricalRunLease(pool, { staleAfterMs: 120_000 });

    await expect(lease.acquire()).resolves.toBe(true);
    await expect(lease.acquire()).resolves.toBe(false);

    const before = pool.state.updated_at.getTime();
    await new Promise((resolve) => setTimeout(resolve, 2));
    await lease.heartbeat();
    expect(pool.state.updated_at.getTime()).toBeGreaterThanOrEqual(before);
  });
});
