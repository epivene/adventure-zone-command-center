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
  initialStatus?: string;
  recoverStale?: boolean;
}) {
  let currentState = state({ status: options?.initialStatus ?? "not_started" });
  const repository = {
    getState: vi.fn(async () => currentState),
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
    retryFailures: vi.fn(async () => ({
      attempted: 2,
      attached: 1,
      ignored: 1,
      needsReview: 0,
      failed: 0,
    })),
  };
  const lease = {
    recoverStale: vi.fn(async () => {
      if (options?.recoverStale) {
        currentState = state({ status: "error" });
        return true;
      }
      return false;
    }),
    acquire: vi.fn(async () => {
      if (currentState.status === "running") return false;
      currentState = state({ status: "running" });
      return true;
    }),
    heartbeat: vi.fn(async () => undefined),
    markErrorIfRunning: vi.fn(async () => {
      if (currentState.status === "running") currentState = state({ status: "error" });
    }),
  };
  const validation = {
    getStatus: vi.fn(async () => options?.validationStatus ?? "approved" as const),
  };
  const server = express();
  server.use(express.json());
  server.use(createGoogleWorkspaceHistoricalBackfillRouter({
    repository,
    service,
    lease,
    validation,
    syncEnabled: options?.syncEnabled ?? true,
    actorId: () => "owner",
  }));
  return { server, repository, service, lease };
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

  it("repairs a stale running state so the UI can offer a safe retry", async () => {
    const { server, lease, repository } = app({ initialStatus: "running", recoverStale: true });
    const response = await request(server).get("/google-workspace/historical-gmail");

    expect(response.status).toBe(200);
    expect(response.body.state.status).toBe("error");
    expect(lease.recoverStale).toHaveBeenCalledTimes(1);
    expect(repository.getState).toHaveBeenCalledTimes(2);
  });

  it("refuses to run while a fresh live lease is already running", async () => {
    const { server, lease, service } = app({ initialStatus: "running", recoverStale: false });
    const response = await request(server)
      .post("/google-workspace/historical-gmail/run-next")
      .send({});

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("GOOGLE_WORKSPACE_HISTORICAL_BACKFILL_ALREADY_RUNNING");
    expect(lease.recoverStale).toHaveBeenCalledTimes(1);
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
    const { server, service, lease } = app();
    const response = await request(server)
      .post("/google-workspace/historical-gmail/run-next")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.processed).toBe(250);
    expect(response.body.state).toBe("awaiting_approval");
    expect(lease.acquire).toHaveBeenCalledTimes(1);
    expect(lease.heartbeat).toHaveBeenCalled();
    expect(service.runNextBatch).toHaveBeenCalledTimes(1);
  });

  it("retries only failed message outcomes without advancing the cursor", async () => {
    const { server, service } = app();
    const response = await request(server)
      .post("/google-workspace/historical-gmail/retry-failures")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      attempted: 2,
      attached: 1,
      ignored: 1,
      needsReview: 0,
      failed: 0,
    });
    expect(service.retryFailures).toHaveBeenCalledWith(250);
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
