import { describe, expect, it, vi } from "vitest";

import { GoogleHistoricalBackfillRepository } from "./google-historical-backfill-repository";

function fakePool() {
  const state = {
    status: "not_started",
    next_page_token: null as string | null,
    first_batch_approved: false,
    processed_count: 0,
    attached_count: 0,
    ignored_count: 0,
    needs_review_count: 0,
    failed_count: 0,
    skipped_count: 0,
  };
  const outcomes = new Set<string>();
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    if (text.includes("FROM google_workspace_connections")) {
      return { rows: [{ id: "connection-id" }] };
    }
    if (text.includes("SELECT status") && text.includes("historical_gmail_backfill_state")) {
      return { rows: [state] };
    }
    if (text.includes("INSERT INTO google_workspace_historical_gmail_batches") && text.includes("RETURNING id")) {
      return { rows: [{ id: "batch-id" }] };
    }
    if (text.includes("SELECT 1") && text.includes("historical_gmail_outcomes")) {
      return { rows: outcomes.has(String(values?.[1])) ? [{ one: 1 }] : [] };
    }
    if (text.includes("INSERT INTO google_workspace_historical_gmail_outcomes")) {
      outcomes.add(String(values?.[2]));
      return { rows: [] };
    }
    if (text.includes("UPDATE google_workspace_historical_gmail_backfill_state") && text.includes("status = $2")) {
      state.status = String(values?.[1]);
      state.next_page_token = values?.[2] == null ? null : String(values?.[2]);
      return { rows: [] };
    }
    if (text.includes("first_batch_approved = true")) {
      state.first_batch_approved = true;
      state.status = "ready";
      return { rows: [] };
    }
    return { rows: [] };
  });
  return { query, state, outcomes };
}

describe("GoogleHistoricalBackfillRepository", () => {
  it("starts with a safe not-started state", async () => {
    const pool = fakePool();
    const repository = new GoogleHistoricalBackfillRepository(pool);

    await expect(repository.getState()).resolves.toMatchObject({
      status: "not_started",
      nextPageToken: null,
      firstBatchApproved: false,
      cumulative: {
        processed: 0,
        attached: 0,
        ignored: 0,
        needsReview: 0,
        failed: 0,
        skipped: 0,
      },
    });
  });

  it("records one outcome idempotently by message id", async () => {
    const pool = fakePool();
    const repository = new GoogleHistoricalBackfillRepository(pool);

    expect(await repository.hasOutcome("message-1")).toBe(false);
    await repository.recordOutcome({
      batchId: "batch-id",
      messageId: "message-1",
      threadId: "thread-1",
      outcome: "ignored",
    });
    expect(await repository.hasOutcome("message-1")).toBe(true);
  });

  it("parks the first completed batch for explicit approval", async () => {
    const pool = fakePool();
    const repository = new GoogleHistoricalBackfillRepository(pool);

    await repository.finishBatch({
      batchId: "batch-id",
      nextPageToken: "older-page",
      firstBatch: true,
    });

    expect(pool.state.status).toBe("awaiting_approval");
    expect(pool.state.next_page_token).toBe("older-page");
  });

  it("moves an approved first batch to ready without changing the cursor", async () => {
    const pool = fakePool();
    pool.state.status = "awaiting_approval";
    pool.state.next_page_token = "older-page";
    const repository = new GoogleHistoricalBackfillRepository(pool);

    await repository.approveFirstBatch("owner");

    expect(pool.state.first_batch_approved).toBe(true);
    expect(pool.state.status).toBe("ready");
    expect(pool.state.next_page_token).toBe("older-page");
  });
});
