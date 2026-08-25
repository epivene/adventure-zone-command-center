import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createGoogleWorkspaceHistoricalBackfillRouter } from "./google-workspace-historical-backfill";

function state(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function app(options?: {
  syncEnabled?: boolean;
  validationStatus?: "not_started" | "ready_for_review" | "approved" | "rejected";
}) {
  const repository = {
    getState: vi.fn(async () => state()),
    approveFirstBatch: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
  };
  const service = {
    runNextBatch: vi.fn(async () => ({
      batchId: "batch-1",
      processed: 250,
      attached: 180,
      ignored: 60,
      needsReview: 8,
      failed: 2,
      skipped: 0,
      nextPageAvailable: true,
      state: "awaiting_approval" as const,
    })),
  };
  const validation = {
    getStatus: vi.fn(async () => options?.validationStatus ?? "approved" as const),
  };
  const server = express();
  server.use(express.json());
  server.use(createGoogleWorkspaceHistoricalBackfillRouter({
    repository,
    service,
    validation,
    syncEnabled: options?.syncEnabled ?? true,
    actorId: () => "owner",
  }));
  return { server, repository, service };
}

describe("Google Workspace historical Gmail backfill routes", () => {
  it("returns status without starting historical work", async () => {
    const { server, service } = app({ syncEnabled: false });
    const response = await request(server).get("/google-workspace/historical-gmail");

    expect(response.status).toBe(200);
    expect(response.body.syncEnabled).toBe(false);
    expect(response.body.state.status).toBe("not_started");
    expect(service.runNextBatch).not.toHaveBeenCalled();
  });

  it("refuses to run while the production sync gate is disabled", async () => {
    const { server } = app({ syncEnabled: false });
    const response = await request(server)
      .post("/google-workspace/historical-gmail/run-next")
      .send({});

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("GOOGLE_WORKSPACE_HISTORICAL_SYNC_DISABLED");
  });

  it("requires the recent validation sample to be approved", async () => {
    const { server } = app({ validationStatus: "ready_for_review" });
    const response = await request(server)
      .post("/google-workspace/historical-gmail/run-next")
      .send({});

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("GOOGLE_WORKSPACE_HISTORICAL_VALIDATION_APPROVAL_REQUIRED");
  });

  it("runs exactly one batch when both safety gates are satisfied", async () => {
    const { server, service } = app();
    const response = await request(server)
      .post("/google-workspace/historical-gmail/run-next")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.processed).toBe(250);
    expect(response.body.state).toBe("awaiting_approval");
    expect(service.runNextBatch).toHaveBeenCalledTimes(1);
  });

  it("approves the first historical batch explicitly", async () => {
    const { server, repository } = app();
    const response = await request(server)
      .post("/google-workspace/historical-gmail/approve-first-batch")
      .send({});

    expect(response.status).toBe(200);
    expect(repository.approveFirstBatch).toHaveBeenCalledWith("owner");
  });
});
