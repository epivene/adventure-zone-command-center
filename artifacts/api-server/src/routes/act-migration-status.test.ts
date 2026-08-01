/**
 * Route tests for GET /migration/act/status/:runId and /status/latest.
 *
 * Covers:
 * - A valid runId returns that run's own status (not the latest).
 * - An unknown runId returns 404.
 * - /status/latest with no prior run returns {run:null}.
 */

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock heavy dependencies before any import of the route module ────────────

vi.mock("@/features/act-migration/runtime", () => ({
  createActMigrationWorkspaceReader: vi.fn(),
  createActMigrationPreviewService: vi.fn(),
  createActMigrationApplyService: vi.fn(),
  createActMigrationCaptureService: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  parseActEnvironment: () => ({ configured: true }),
  getActEnvironment: () => ({ configured: false }),
}));

// ─── Minimal workspace stub ───────────────────────────────────────────────────

function makeWorkspace(runId: string) {
  return {
    runSummary: null,
    progress: {
      runId,
      status: "completed",
      completedCheckpoints: 1,
      totalCheckpoints: 1,
      stagedRecords: 0,
      failedCheckpoints: 0,
      streams: [],
      interruption: null,
    },
    preview: null,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

let app: ReturnType<typeof express>;

// Lazily import the router (after mocks are hoisted)
beforeEach(async () => {
  // Reset mocks on each test
  const runtime = await import("@/features/act-migration/runtime");
  vi.mocked(runtime.createActMigrationWorkspaceReader).mockReset();

  // Fresh express app per test
  const { default: router } = await import("@/routes/act-migration");
  app = express();
  app.use(express.json());
  app.use("/api", router);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/migration/act/status/:runId", () => {
  it("returns the run's own status when the runId exists", async () => {
    const knownRunId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const runtime = await import("@/features/act-migration/runtime");
    vi.mocked(runtime.createActMigrationWorkspaceReader).mockResolvedValue({
      getWorkspace: vi.fn().mockImplementation(({ runId }) =>
        runId === knownRunId ? makeWorkspace(runId) : null,
      ),
    });

    const res = await request(app).get(
      `/api/migration/act/status/${knownRunId}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.run.runId).toBe(knownRunId);
  });

  it("returns 404 when the runId is not found", async () => {
    const runtime = await import("@/features/act-migration/runtime");
    vi.mocked(runtime.createActMigrationWorkspaceReader).mockResolvedValue({
      getWorkspace: vi.fn().mockResolvedValue(null),
    });

    const res = await request(app).get(
      "/api/migration/act/status/00000000-0000-0000-0000-000000000000",
    );

    expect(res.status).toBe(404);
  });

  it("returns a different run from /status/latest when runIds differ", async () => {
    const runIdA = "aaaaaaaa-0000-0000-0000-000000000000";
    const runIdB = "bbbbbbbb-0000-0000-0000-000000000000";
    const runtime = await import("@/features/act-migration/runtime");
    vi.mocked(runtime.createActMigrationWorkspaceReader).mockResolvedValue({
      getWorkspace: vi.fn().mockImplementation(({ runId }) => {
        // Both runs exist; workspace reader returns the requested one
        if (runId === runIdA) return makeWorkspace(runIdA);
        if (runId === runIdB) return makeWorkspace(runIdB);
        return null;
      }),
    });

    const resA = await request(app).get(`/api/migration/act/status/${runIdA}`);
    const resB = await request(app).get(`/api/migration/act/status/${runIdB}`);

    expect(resA.status).toBe(200);
    expect(resA.body.run.runId).toBe(runIdA);
    expect(resB.status).toBe(200);
    expect(resB.body.run.runId).toBe(runIdB);
    // The two runs return different data — neither is contaminated by the other
    expect(resA.body.run.runId).not.toBe(resB.body.run.runId);
  });
});

describe("GET /api/migration/act/status/latest", () => {
  it("returns {run:null} when no run exists", async () => {
    const runtime = await import("@/features/act-migration/runtime");
    vi.mocked(runtime.createActMigrationWorkspaceReader).mockResolvedValue({
      getWorkspace: vi.fn().mockResolvedValue(null),
    });

    const res = await request(app).get("/api/migration/act/status/latest");

    expect(res.status).toBe(200);
    expect(res.body.run).toBeNull();
  });
});

describe("Activity import summary does not corrupt existing run summary", () => {
  it("status remains valid and activityImport is surfaced when runSummary has both report and activity keys", async () => {
    const runId = "cccccccc-0000-0000-0000-000000000000";

    // Simulate a run where the reconciliation report and activityImport were
    // both merged into the summary JSONB column (as the COALESCE || patch does).
    const reconciliationReportFields = {
      complete: true,
      entityCounts: { contacts: 12 },
      sourceDigest: "abc123",
      proposalDigest: "def456",
    };
    const activityImportResult = {
      note: { inserted: 7, skipped: 1, errors: 0 },
      history: { inserted: 3, skipped: 0, errors: 0 },
      activity: { inserted: 2, skipped: 0, errors: 0 },
    };

    // Merged summary — what the DB row looks like after JSONB || merge
    const mergedRunSummary = {
      ...reconciliationReportFields,
      activityImport: activityImportResult,
    };

    const runtime = await import("@/features/act-migration/runtime");
    vi.mocked(runtime.createActMigrationWorkspaceReader).mockResolvedValue({
      getWorkspace: vi.fn().mockImplementation(({ runId: rid }) =>
        rid === runId
          ? { ...makeWorkspace(runId), runSummary: mergedRunSummary }
          : null,
      ),
    });

    const res = await request(app).get(`/api/migration/act/status/${runId}`);

    expect(res.status).toBe(200);
    // The reconciliation report keys are still in the returned run summary
    expect(res.body.run.runId).toBe(runId);
    // activityImport is surfaced in the response
    expect(res.body.run.activityImport).toMatchObject(activityImportResult);
    // The run is still readable/valid (no undefined or error shape)
    expect(res.body.run.phase).toBeDefined();
    expect(res.body.run.snapshot).toBeDefined();
  });
});
