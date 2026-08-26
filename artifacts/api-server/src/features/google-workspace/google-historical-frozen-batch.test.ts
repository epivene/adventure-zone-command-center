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

function repository(input?: {
  status?: "ready" | "error";
  firstBatchApproved?: boolean;
  processed?: number;
  nextPageToken?: string | null;
}) {
  return {
    getState: async () => ({
      status: input?.status ?? "ready" as const,
      nextPageToken: input?.nextPageToken === undefined ? "page-a" : input.nextPageToken,
      firstBatchApproved: input?.firstBatchApproved ?? true,
      cumulative: {
        processed: input?.processed ?? 250,
        attached: 200,
        ignored: 40,
        needsReview: 10,
        failed: 0,
        skipped: 0,
      },
    }),
    beginBatch: vi.fn(async () => ({ batchId: "batch-2" })),
    hasOutcome: vi.fn(async () => false),
    recordOutcome: vi.fn(async () => undefined),
    finishBatch: vi.fn(async () => undefined),
    markError: vi.fn(async () => undefined),
  };
}

describe("historical Gmail frozen batch membership", () => {
  it("freezes a newly discovered Gmail page before processing it", async () => {
    const readClient = client(["m1", "m2"]);
    const backfillRepository = repository();
    const batchStore = {
      load: vi.fn(async () => null),
      freeze: vi.fn(async () => undefined),
    };
    const service = new GoogleHistoricalBackfillService({
      connection: { createReadClient: async () => readClient },
      repository: backfillRepository,
      batchStore,
      classifier: {
        classify: async () => ({ outcome: "ignored" as const, evidenceCodes: [] }),
      },
      validationRepository: {
        upsertRows: async () => undefined,
        upsertReviewItems: async () => undefined,
      },
    });

    await service.runNextBatch();

    expect(readClient.listMessagePage).toHaveBeenCalledTimes(1);
    expect(batchStore.freeze).toHaveBeenCalledWith({
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
    const backfillRepository = repository({ status: "error" });
    const batchStore = {
      load: vi.fn(async () => ({
        batchId: "batch-2",
        nextPageToken: "older-page",
        messages: [
          { id: "m1", threadId: "thread-m1" },
          { id: "m2", threadId: "thread-m2" },
        ],
      })),
      freeze: vi.fn(async () => undefined),
    };
    const service = new GoogleHistoricalBackfillService({
      connection: { createReadClient: async () => readClient },
      repository: backfillRepository,
      batchStore,
      classifier: {
        classify: async () => ({ outcome: "ignored" as const, evidenceCodes: [] }),
      },
      validationRepository: {
        upsertRows: async () => undefined,
        upsertReviewItems: async () => undefined,
      },
    });

    const result = await service.runNextBatch();

    expect(readClient.listMessagePage).not.toHaveBeenCalled();
    expect(backfillRepository.beginBatch).not.toHaveBeenCalled();
    expect(batchStore.freeze).not.toHaveBeenCalled();
    expect(readClient.getMessageMetadata).toHaveBeenCalledWith("m1");
    expect(readClient.getMessageMetadata).toHaveBeenCalledWith("m2");
    expect(result.processed).toBe(2);
    expect(result.nextPageAvailable).toBe(true);
  });

  it("allows an interrupted unapproved first batch to retry its frozen membership", async () => {
    const readClient = client(["new-arrival"]);
    const backfillRepository = repository({
      status: "error",
      firstBatchApproved: false,
      processed: 150,
      nextPageToken: null,
    });
    const batchStore = {
      load: vi.fn(async () => ({
        batchId: "first-batch",
        nextPageToken: "older-page",
        messages: [{ id: "original-message", threadId: "original-thread" }],
      })),
      freeze: vi.fn(async () => undefined),
    };
    const service = new GoogleHistoricalBackfillService({
      connection: { createReadClient: async () => readClient },
      repository: backfillRepository,
      batchStore,
      classifier: {
        classify: async () => ({ outcome: "ignored" as const, evidenceCodes: [] }),
      },
      validationRepository: {
        upsertRows: async () => undefined,
        upsertReviewItems: async () => undefined,
      },
    });

    const result = await service.runNextBatch();

    expect(readClient.listMessagePage).not.toHaveBeenCalled();
    expect(readClient.getMessageMetadata).toHaveBeenCalledWith("original-message");
    expect(result.state).toBe("awaiting_approval");
  });
});
