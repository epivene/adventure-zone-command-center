import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import {
  createActRecoveryRouter,
  type ActRecoveryRouteService,
} from "./act-recovery";

const RUN_ID = "10000000-0000-4000-8000-000000000001";
const SOURCE_ID = "20000000-0000-4000-8000-000000000001";
const VERSION_ID = "30000000-0000-4000-8000-000000000001";
const TARGET_ID = "40000000-0000-4000-8000-000000000001";

function status() {
  return {
    runId: RUN_ID,
    sourceDatabaseKey: "archive-db",
    state: "running" as const,
    candidateCount: 7,
    checkedCount: 5,
    pending: 1,
    leased: 0,
    alreadyPresent: 1,
    recovered: 3,
    needsReview: 1,
    droppedUnusable: 0,
    retryableFailed: 1,
    complete: false,
    byStreamType: {
      history: { candidateCount: 5, recovered: 3, needsReview: 1, alreadyPresent: 1, droppedUnusable: 0, retryableFailed: 0, pending: 0, leased: 0 },
    },
  };
}

function service(): ActRecoveryRouteService {
  return {
    startRun: vi.fn(async () => status()),
    status: vi.fn(async () => status()),
    reviewPage: vi.fn(async () => ({
      page: 1,
      pageSize: 50,
      items: [{
        itemId: "50000000-0000-4000-8000-000000000001",
        runId: RUN_ID,
        sourceRecordId: SOURCE_ID,
        sourceVersionId: VERSION_ID,
        streamType: "history",
        actRecordId: "history-1",
        rawSnapshot: { regarding: "E-mail sent", details: "Proposal package sent" },
        relationshipEvidence: {},
        targetSummary: { reason: "timeline_parent_unresolved" },
      }],
    })),
    assign: vi.fn(async () => ({ ok: true as const })),
    drop: vi.fn(async () => ({ ok: true as const })),
    retry: vi.fn(async () => ({ ok: true as const })),
  };
}

function app(service: ActRecoveryRouteService) {
  const app = express();
  app.use(express.json());
  app.use(createActRecoveryRouter({ service }));
  return app;
}

describe("ACT recovery routes", () => {
  it("starts a recovery idempotently and exposes reconciled status", async () => {
    const recovery = service();
    const server = app(recovery);

    const start = await request(server)
      .post("/act-recovery/runs")
      .send({ requestKey: "archive-recovery-2026-08-16", sourceDatabaseKey: "archive-db" });
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ runId: RUN_ID, recovered: 3, needsReview: 1, complete: false });
    expect(recovery.startRun).toHaveBeenCalledWith({
      requestKey: "archive-recovery-2026-08-16",
      requestedBy: "owner",
      sourceDatabaseKey: "archive-db",
    });

    const current = await request(server).get("/act-recovery/status");
    expect(current.status).toBe(200);
    expect(current.body).toMatchObject({ candidateCount: 7, checkedCount: 5, retryableFailed: 1 });
  });

  it("returns original archive content in the paged review queue", async () => {
    const recovery = service();
    const response = await request(app(recovery)).get("/act-recovery/review?page=1");

    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({
      sourceRecordId: SOURCE_ID,
      sourceVersionId: VERSION_ID,
      streamType: "history",
      rawSnapshot: { regarding: "E-mail sent", details: "Proposal package sent" },
    });
    expect(recovery.reviewPage).toHaveBeenCalledWith({ page: 1, pageSize: 50 });
  });

  it("validates assignment targets and forwards an explicit owner decision", async () => {
    const recovery = service();
    const server = app(recovery);

    const invalid = await request(server)
      .post(`/act-recovery/review/${SOURCE_ID}/assign`)
      .send({ sourceVersionId: VERSION_ID, targetEntityType: "mystery", targetEntityId: TARGET_ID });
    expect(invalid.status).toBe(400);
    expect(recovery.assign).not.toHaveBeenCalled();

    const valid = await request(server)
      .post(`/act-recovery/review/${SOURCE_ID}/assign`)
      .send({ sourceVersionId: VERSION_ID, targetEntityType: "organization", targetEntityId: TARGET_ID });
    expect(valid.status).toBe(200);
    expect(recovery.assign).toHaveBeenCalledWith({
      sourceRecordId: SOURCE_ID,
      sourceVersionId: VERSION_ID,
      targetEntityType: "organization",
      targetEntityId: TARGET_ID,
      decidedBy: "owner",
    });
  });

  it("maps stale review decisions to 409 instead of silently applying them", async () => {
    const recovery = service();
    recovery.assign = vi.fn(async () => {
      throw Object.assign(new Error("stale"), { status: 409, code: "act_recovery_source_version_stale" });
    });

    const response = await request(app(recovery))
      .post(`/act-recovery/review/${SOURCE_ID}/assign`)
      .send({ sourceVersionId: VERSION_ID, targetEntityType: "contact", targetEntityId: TARGET_ID });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "act_recovery_source_version_stale" });
  });

  it("requires source-version proof for drop and retry decisions", async () => {
    const recovery = service();
    const server = app(recovery);

    expect((await request(server).post(`/act-recovery/review/${SOURCE_ID}/drop`).send({})).status).toBe(400);
    expect((await request(server).post(`/act-recovery/review/${SOURCE_ID}/retry`).send({})).status).toBe(400);

    expect((await request(server).post(`/act-recovery/review/${SOURCE_ID}/drop`).send({ sourceVersionId: VERSION_ID })).status).toBe(200);
    expect((await request(server).post(`/act-recovery/review/${SOURCE_ID}/retry`).send({ sourceVersionId: VERSION_ID })).status).toBe(200);
    expect(recovery.drop).toHaveBeenCalledWith({ sourceRecordId: SOURCE_ID, sourceVersionId: VERSION_ID, decidedBy: "owner" });
    expect(recovery.retry).toHaveBeenCalledWith({ sourceRecordId: SOURCE_ID, sourceVersionId: VERSION_ID, decidedBy: "owner" });
  });
});
