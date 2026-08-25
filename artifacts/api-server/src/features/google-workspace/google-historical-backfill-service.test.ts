import { describe, expect, it, vi } from "vitest";

import type { GoogleWorkspaceReadClient } from "./google-api-types";
import { GoogleHistoricalBackfillService } from "./google-historical-backfill-service";

function message(id: string, threadId = `thread-${id}`) {
  return {
    id,
    threadId,
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

function readClient(ids: string[], nextPageToken: string | null = "older"): GoogleWorkspaceReadClient {
  return {
    authorizationUrl: () => "",
    exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
    accountIdentity: async () => ({ subject: null, email: "theadventurezone12@gmail.com" }),
    listLabels: async () => [],
    listCalendars: async () => [],
    listMessagePage: vi.fn(async ({ maxResults }) => ({
      messages: ids.slice(0, maxResults).map((id) => ({ id, threadId: `thread-${id}` })),
      nextPageToken,
    })),
    getMessageMetadata: vi.fn(async (id) => message(id)),
  };
}

function repository(input?: { firstBatchApproved?: boolean; processed?: number; status?: string }) {
  const outcomes = new Set<string>();
  return {
    getState: vi.fn(async () => ({
      status: (input?.status ?? "not_started") as "not_started",
      nextPageToken: null,
      firstBatchApproved: input?.firstBatchApproved ?? false,
      cumulative: {
        processed: input?.processed ?? 0,
        attached: 0,
        ignored: 0,
        needsReview: 0,
        failed: 0,
        skipped: 0,
      },
    })),
    beginBatch: vi.fn(async () => ({ batchId: "batch-1" })),
    hasOutcome: vi.fn(async (id: string) => outcomes.has(id)),
    recordOutcome: vi.fn(async (row: { messageId: string }) => { outcomes.add(row.messageId); }),
    finishBatch: vi.fn(async () => undefined),
    markError: vi.fn(async () => undefined),
  };
}

function validationRepository() {
  return {
    upsertRows: vi.fn(async () => undefined),
    upsertReviewItems: vi.fn(async () => undefined),
  };
}

describe("GoogleHistoricalBackfillService", () => {
  it("processes at most 250 messages and parks the first batch for approval", async () => {
    const client = readClient(Array.from({ length: 300 }, (_, index) => `m${index + 1}`));
    const repo = repository();
    const mappings = validationRepository();
    const service = new GoogleHistoricalBackfillService({
      connection: { createReadClient: async () => client },
      repository: repo,
      classifier: {
        classify: async () => ({
          outcome: "attached" as const,
          organization: { id: "org-1", name: "Known Event" },
          evidenceCodes: ["existing_thread_association"],
        }),
      },
      validationRepository: mappings,
    });

    const result = await service.runNextBatch();

    expect(client.listMessagePage).toHaveBeenCalledWith({ maxResults: 250, pageToken: null });
    expect(result.processed).toBe(250);
    expect(result.attached).toBe(250);
    expect(result.state).toBe("awaiting_approval");
    expect(repo.finishBatch).toHaveBeenCalledWith(expect.objectContaining({
      firstBatch: true,
      nextPageToken: "older",
    }));
  });

  it("blocks a second batch until the first historical batch is approved", async () => {
    const service = new GoogleHistoricalBackfillService({
      connection: { createReadClient: async () => readClient(["m1"]) },
      repository: repository({ status: "awaiting_approval", processed: 250 }),
      classifier: { classify: async () => ({ outcome: "ignored" as const, evidenceCodes: [] }) },
      validationRepository: validationRepository(),
    });

    await expect(service.runNextBatch()).rejects.toThrow(
      "GOOGLE_WORKSPACE_HISTORICAL_FIRST_BATCH_APPROVAL_REQUIRED",
    );
  });

  it("skips already durable message outcomes instead of duplicating work", async () => {
    const client = readClient(["m1", "m2"], null);
    const repo = repository({ firstBatchApproved: true, processed: 250, status: "ready" });
    repo.hasOutcome.mockImplementation(async (id: string) => id === "m1");
    const classify = vi.fn(async () => ({ outcome: "ignored" as const, evidenceCodes: [] }));
    const service = new GoogleHistoricalBackfillService({
      connection: { createReadClient: async () => client },
      repository: repo,
      classifier: { classify },
      validationRepository: validationRepository(),
    });

    const result = await service.runNextBatch();

    expect(classify).toHaveBeenCalledTimes(1);
    expect(result.skipped).toBe(1);
    expect(result.ignored).toBe(1);
    expect(result.state).toBe("complete");
  });

  it("isolates ordinary per-message failures but stops on reauthorization errors", async () => {
    const client = readClient(["bad", "auth", "never"]);
    client.getMessageMetadata = vi.fn(async (id) => {
      if (id === "bad") throw new Error("temporary metadata failure");
      if (id === "auth") {
        throw Object.assign(new Error("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED"), {
          code: "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED",
        });
      }
      return message(id);
    });
    const repo = repository({ firstBatchApproved: true, processed: 250, status: "ready" });
    const service = new GoogleHistoricalBackfillService({
      connection: { createReadClient: async () => client },
      repository: repo,
      classifier: { classify: async () => ({ outcome: "ignored" as const, evidenceCodes: [] }) },
      validationRepository: validationRepository(),
    });

    await expect(service.runNextBatch()).rejects.toThrow(
      "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED",
    );
    expect(repo.recordOutcome).toHaveBeenCalledWith(expect.objectContaining({
      messageId: "bad",
      outcome: "failed",
    }));
    expect(repo.finishBatch).not.toHaveBeenCalled();
  });
});
