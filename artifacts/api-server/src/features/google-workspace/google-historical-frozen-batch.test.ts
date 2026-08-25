import { describe, expect, it, vi } from "vitest";

import type { GoogleWorkspaceReadClient } from "./google-api-types";
import { GoogleHistoricalBackfillService } from "./google-historical-backfill-service";

function message(id: string) {
  return {
    id,
    threadId: `thread-${id}`,
    labelIds: ["INBOX"],
    internalDateMs: 1,
    snippet: "",
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

function client(listIds: string[]): GoogleWorkspaceReadClient {
  return {
    authorizationUrl: () => "",
    exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
    accountIdentity: async () => ({ subject: null, email: "theadventurezone12@gmail.com" }),
    listLabels: async () => [],
    listCalendars: async () => [],
    listMessagePage: vi.fn(async () => ({
      messages: listIds.map((id) => ({ id, threadId: `thread-${id}` })),
      nextPageToken: "older-page",
    })),
    getMessageMetadata: vi.fn(async (id) => message(id)),
  };
}

describe("historical Gmail frozen batch membership", () => {
  it("freezes a newly discovered Gmail page before processing it", async () => {
    const readClient = client(["m1", "m2"]);
    const repository = {
      getState: async () => ({
        status: "ready" as const,
        nextPageToken: "page-a",
        firstBatchApproved: true,
        cumulative: { processed: 250, attached: 200, ignored: 40, needsReview: 10, failed: 0, skipped: 0 },
      }),
      loadFrozenBatch: vi.fn(async () => null),
      beginBatch: vi.fn(async () => ({ batchId: "batch-2" })),
      freezeBatch: vi.fn(async () => undefined),
      hasOutcome: vi.fn(async () => false),
      recordOutcome: vi.fn(async () => undefined),
      finishBatch: vi.fn(async () => undefined),
      markError: vi.fn(async () => undefined),
    };
    const service = new GoogleHistoricalBackfillService({
      connection: { createReadClient: async () => readClient },
      repository,
      classifier: { classify: async () => ({ outcome: "ignored" as const, evidenceCodes: [] }) },
      validationRepository: { upsertRows: async () => undefined, upsertReviewItems: async () => undefined },
    });

    await service.runNextBatch();

    expect(readClient.listMessagePage).toHaveBeenCalledTimes(1);
    expect(repository.freezeBatch).toHaveBeenCalledWith({
      batchId: "batch-2",
      nextPageToken: "older-page",
      messages: [
        { id: "m1", threadId: "thread-m1" },
        { id: "m2", threadId: "thread-m2" },
      ],
    });
  });

  it("reuses frozen message ids on retry instead of querying the newest Gmail page again", async () => {
    const readClient = client(["new-arrival", "different-message"]);
    const repository = {
      getState: async () => ({
        status: "error" as const,
        nextPageToken: "page-a",
        firstBatchApproved: true,
        cumulative: { processed: 250, attached: 200, ignored: 40, needsReview: 10, failed: 0, skipped: 0 },
      }),
      loadFrozenBatch: vi.fn(async () => ({
        batchId: "batch-2",
        nextPageToken: "older-page",
        messages: [
          { id: "m1", threadId: "thread-m1" },
          { id: "m2", threadId: "thread-m2" },
        ],
      })),
      beginBatch: vi.fn(async () => ({ batchId: "should-not-be-created" })),
      freezeBatch: vi.fn(async () => undefined),
      hasOutcome: vi.fn(async () => false),
      recordOutcome: vi.fn(async () => undefined),
      finishBatch: vi.fn(async () => undefined),
      markError: vi.fn(async () => undefined),
    };
    const service = new GoogleHistoricalBackfillService({
      connection: { createReadClient: async () => readClient },
      repository,
      classifier: { classify: async () => ({ outcome: "ignored" as const, evidenceCodes: [] }) },
      validationRepository: { upsertRows: async () => undefined, upsertReviewItems: async () => undefined },
    });

    const result = await service.runNextBatch();

    expect(readClient.listMessagePage).not.toHaveBeenCalled();
    expect(repository.beginBatch).not.toHaveBeenCalled();
    expect(repository.freezeBatch).not.toHaveBeenCalled();
    expect(readClient.getMessageMetadata).toHaveBeenCalledWith("m1");
    expect(readClient.getMessageMetadata).toHaveBeenCalledWith("m2");
    expect(result.processed).toBe(2);
    expect(result.nextPageAvailable).toBe(true);
  });
});
