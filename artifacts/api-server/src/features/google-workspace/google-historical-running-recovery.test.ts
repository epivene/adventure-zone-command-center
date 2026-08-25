import { describe, expect, it, vi } from "vitest";

import type { GoogleWorkspaceReadClient } from "./google-api-types";
import { GoogleHistoricalBackfillRepository } from "./google-historical-backfill-repository";
import { GoogleHistoricalBackfillService } from "./google-historical-backfill-service";

function recoveryPool(updatedAt: Date) {
  const state = {
    status: "running",
    next_page_token: "same-page-token",
    first_batch_approved: false,
    processed_count: 0,
    attached_count: 0,
    ignored_count: 0,
    needs_review_count: 0,
    failed_count: 0,
    skipped_count: 0,
    updated_at: updatedAt,
  };
  const query = vi.fn(async (text: string) => {
    if (text.includes("FROM google_workspace_connections")) {
      return { rows: [{ id: "connection-id" }] };
    }
    if (
      text.includes("UPDATE google_workspace_historical_gmail_backfill_state") &&
      text.includes("status = 'error'") &&
      text.includes("status = 'running'")
    ) {
      if (Date.now() - state.updated_at.getTime() > 120_000) {
        state.status = "error";
      }
      return { rows: [] };
    }
    if (text.includes("UPDATE google_workspace_historical_gmail_batches") && text.includes("status = 'error'")) {
      return { rows: [] };
    }
    if (text.includes("SELECT status") && text.includes("historical_gmail_backfill_state")) {
      return { rows: [state] };
    }
    return { rows: [] };
  });
  return { query, state };
}

function message(id: string) {
  return {
    id,
    threadId: `thread-${id}`,
    labelIds: ["INBOX"],
    internalDateMs: 1,
    snippet: "hello",
    headers: {
      from: "outside@example.com",
      to: "TheAdventureZone12@gmail.com",
      cc: "",
      subject: "Hello",
      date: "",
    },
    hasAttachments: false,
  };
}

describe("historical Gmail interrupted-run recovery", () => {
  it("turns a stale running heartbeat into a retryable error without moving the cursor or counts", async () => {
    const pool = recoveryPool(new Date(Date.now() - 10 * 60_000));
    const repository = new GoogleHistoricalBackfillRepository(pool);

    const state = await repository.getState();

    expect(state.status).toBe("error");
    expect(state.nextPageToken).toBe("same-page-token");
    expect(state.cumulative.processed).toBe(0);
    expect(state.firstBatchApproved).toBe(false);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'running'"), expect.anything());
  });

  it("leaves a fresh running heartbeat alone", async () => {
    const pool = recoveryPool(new Date());
    const repository = new GoogleHistoricalBackfillRepository(pool);

    const state = await repository.getState();

    expect(state.status).toBe("running");
    expect(state.nextPageToken).toBe("same-page-token");
  });

  it("refreshes the running heartbeat while a real batch request is processing", async () => {
    const client: GoogleWorkspaceReadClient = {
      authorizationUrl: () => "",
      exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
      accountIdentity: async () => ({ subject: null, email: "theadventurezone12@gmail.com" }),
      listLabels: async () => [],
      listCalendars: async () => [],
      listMessagePage: async () => ({
        messages: [
          { id: "m1", threadId: "thread-m1" },
          { id: "m2", threadId: "thread-m2" },
        ],
        nextPageToken: "older",
      }),
      getMessageMetadata: async (id) => message(id),
    };
    const heartbeat = vi.fn(async () => undefined);
    const repository = {
      getState: async () => ({
        status: "not_started" as const,
        nextPageToken: null,
        firstBatchApproved: false,
        cumulative: { processed: 0, attached: 0, ignored: 0, needsReview: 0, failed: 0, skipped: 0 },
      }),
      beginBatch: async () => ({ batchId: "batch-1" }),
      heartbeat,
      hasOutcome: async () => false,
      recordOutcome: async () => undefined,
      finishBatch: async () => undefined,
      markError: async () => undefined,
    };
    const service = new GoogleHistoricalBackfillService({
      connection: { createReadClient: async () => client },
      repository,
      classifier: { classify: async () => ({ outcome: "ignored" as const, evidenceCodes: [] }) },
      validationRepository: {
        upsertRows: async () => undefined,
        upsertReviewItems: async () => undefined,
      },
    });

    await service.runNextBatch();

    expect(heartbeat).toHaveBeenCalledWith("batch-1");
    expect(heartbeat.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
