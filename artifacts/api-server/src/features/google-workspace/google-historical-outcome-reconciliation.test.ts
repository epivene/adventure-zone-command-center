import { describe, expect, it, vi } from "vitest";

import { GoogleHistoricalBackfillRepository } from "./google-historical-backfill-repository";
import { GoogleHistoricalBackfillService } from "./google-historical-backfill-service";
import type { GoogleWorkspaceReadClient } from "./google-api-types";

function readClient(): GoogleWorkspaceReadClient {
  return {
    authorizationUrl: () => "",
    exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
    accountIdentity: async () => ({ subject: null, email: "theadventurezone12@gmail.com" }),
    listLabels: async () => [],
    listCalendars: async () => [],
    listMessagePage: async () => ({
      messages: [
        { id: "old-attached", threadId: "t1" },
        { id: "old-ignored", threadId: "t2" },
        { id: "new", threadId: "t3" },
      ],
      nextPageToken: "older",
    }),
    getMessageMetadata: async (id) => ({
      id,
      threadId: `thread-${id}`,
      labelIds: ["INBOX"],
      internalDateMs: 1,
      snippet: "",
      headers: { from: "outside@example.com", to: "TheAdventureZone12@gmail.com", cc: "", subject: "", date: "" },
      hasAttachments: false,
    }),
  };
}

describe("historical Gmail outcome reconciliation", () => {
  it("counts durable outcomes in their real buckets when retrying an interrupted page", async () => {
    const repository = {
      getState: async () => ({
        status: "error" as const,
        nextPageToken: null,
        firstBatchApproved: false,
        cumulative: { processed: 0, attached: 0, ignored: 0, needsReview: 0, failed: 0, skipped: 0 },
      }),
      beginBatch: async () => ({ batchId: "batch-retry" }),
      getOutcome: vi.fn(async (messageId: string) =>
        messageId === "old-attached" ? "attached" as const :
        messageId === "old-ignored" ? "ignored" as const : null),
      recordOutcome: vi.fn(async () => undefined),
      finishBatch: vi.fn(async () => undefined),
      markError: vi.fn(async () => undefined),
    };
    const service = new GoogleHistoricalBackfillService({
      connection: { createReadClient: async () => readClient() },
      repository,
      classifier: { classify: async () => ({ outcome: "ignored" as const, evidenceCodes: [] }) },
      validationRepository: { upsertRows: async () => undefined, upsertReviewItems: async () => undefined },
    });

    const result = await service.runNextBatch();

    expect(result).toMatchObject({
      processed: 3,
      attached: 1,
      ignored: 2,
      needsReview: 0,
      failed: 0,
      skipped: 0,
    });
  });

  it("rebuilds cumulative counters from durable message outcomes", async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes("FROM google_workspace_connections")) return { rows: [{ id: "connection-id" }] };
      if (text.includes("GROUP BY outcome")) {
        return { rows: [
          { outcome: "attached", count: "187" },
          { outcome: "ignored", count: "51" },
          { outcome: "needs_review", count: "10" },
          { outcome: "failed", count: "2" },
        ] };
      }
      return { rows: [] };
    });
    const repository = new GoogleHistoricalBackfillRepository({ query });

    const counts = await repository.reconcileOutcomeCounts();

    expect(counts).toEqual({
      processed: 250,
      attached: 187,
      ignored: 51,
      needsReview: 10,
      failed: 2,
      skipped: 0,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("processed_count = $2"), [
      "connection-id", 250, 187, 51, 10, 2, 0,
    ]);
  });
});
