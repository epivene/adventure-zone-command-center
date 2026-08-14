import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ActReplacementStatus,
  ImportWorkflow,
  StartActReplacementRun,
} from "@/features/act-replacement/import-types";
import type { ArchiveProfileImportStatus } from "@/features/act-replacement/archive-profile-import-types";
import type { ArchiveProfileImportStore } from "@/features/act-replacement/archive-profile-import-repository";
import { ActApplyService } from "@/features/act-replacement/apply-service";
import { InMemoryApplyRepository } from "@/features/act-replacement/apply-repository";
import { InMemoryApprovalRepository } from "@/features/act-replacement/approval-service";
import type { ActOrganizeManifest } from "@/features/act-replacement/manifest-builder";
import { createProductionReview } from "@/features/act-replacement/production-review";
import {
  InMemoryReviewCommandStore,
  ReviewCommandService,
} from "@/features/act-replacement/review-command-service";
import { issueToken, requireOwnerMiddleware } from "@/lib/auth";
import {
  createActReplacementRouter,
  type ActReplacementAuditRecord,
  type ActReplacementControlStore,
  type ActReplacementRouteDependencies,
} from "./act-replacement";

vi.mock("@/features/act-migration/runtime", () => ({
  createActMigrationWorkspaceReader: vi.fn(),
  createActMigrationPreviewService: vi.fn(),
  createActMigrationApplyService: vi.fn(),
}));

vi.mock("@/lib/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/env")>();
  return {
    ...original,
    parseActEnvironment: () => ({ configured: true }),
  };
});

vi.mock("@/db/client", () => {
  throw new Error("test lazy database initialization failure");
});

const DATABASE_KEY = "server-act-database";
const RUN_ID = "10000000-0000-4000-8000-000000000001";
const SECOND_RUN_ID = "10000000-0000-4000-8000-000000000002";
const ARCHIVE_PROFILE_JOB_ID = "50000000-0000-4000-8000-000000000001";
const SOURCE_RECORD_ID = "20000000-0000-4000-8000-000000000001";
const SOURCE_VERSION_ID = "30000000-0000-4000-8000-000000000001";
const TARGET_ENTITY_ID = "40000000-0000-4000-8000-000000000001";
const MANIFEST_DIGEST = "a".repeat(64);
const REVIEW_TOKEN = {
  sourceRecordId: SOURCE_RECORD_ID,
  sourceVersionId: SOURCE_VERSION_ID,
  fieldName: "phone",
  sourceValueFingerprint: "b".repeat(64),
  targetEntityType: "contact",
  targetEntityId: TARGET_ENTITY_ID,
  localValueFingerprint: "c".repeat(64),
};

function status(
  runId = RUN_ID,
  pageSize: 25 | 50 | 100 | 200 = 50,
): ActReplacementStatus & {
  safeOperationCount: number;
  reviewRequiredCount: number;
  appliedOperationCount: number;
  alreadyPresentOperationCount: number;
  blockedOperationCount: number;
  failedOperationCount: number;
  manifestDigest: string | null;
  nextApplyCursor: number;
  canOrganize: boolean;
  canReview: boolean;
  canApplySafe: boolean;
} {
  return {
    runId,
    phase: "extracting",
    previewOnly: true,
    pageSize,
    streams: [
      {
        streamType: "contact",
        state: "complete",
        completedCheckpoints: 1,
        totalCheckpoints: 1,
        queryMode: "projected",
        lastSucceededAt: "2026-08-01T12:00:00.000Z",
        error: null,
        responseRows: 8,
        observedIdentities: 8,
        archivedIdentities: 8,
        completeIdentities: 7,
        partialIdentities: 1,
        failedIdentities: 0,
        snapshotVersionsInserted: 6,
      },
      {
        streamType: "opportunity_contact",
        state: "retry_wait",
        completedCheckpoints: 2,
        totalCheckpoints: 3,
        queryMode: "plain",
        lastSucceededAt: "2026-08-01T12:01:00.000Z",
        error: {
          code: "rate_limited",
          retryable: true,
          retryAfter: "2026-08-01T12:02:00.000Z",
        },
        responseRows: 3,
        observedIdentities: 3,
        archivedIdentities: 3,
        completeIdentities: 2,
        partialIdentities: 0,
        failedIdentities: 1,
        snapshotVersionsInserted: 2,
      },
    ],
    allStreams: {
      responseRows: 11,
      observedIdentities: 11,
      archivedIdentities: 11,
      completeIdentities: 9,
      partialIdentities: 1,
      failedIdentities: 1,
      snapshotVersionsInserted: 8,
      unsupportedCapabilities: 1,
    },
    canResume: true,
    canStartOver: true,
    safeOperationCount: 0,
    reviewRequiredCount: 0,
    appliedOperationCount: 0,
    alreadyPresentOperationCount: 0,
    blockedOperationCount: 0,
    failedOperationCount: 0,
    manifestDigest: null,
    nextApplyCursor: 0,
    canOrganize: false,
    canReview: false,
    canApplySafe: false,
  };
}

type StoredRun = {
  runId: string;
  requestKey: string;
  sourceDatabaseKey: string;
  requestedBy: string;
  status: ActReplacementStatus;
};

class MemoryControlStore implements ActReplacementControlStore {
  readonly runs: StoredRun[] = [];
  readonly archiveRows = ["immutable-archive-row"];
  readonly appliedRows = ["already-applied-row"];
  nextRunId = RUN_ID;
  auditRows: Array<ActReplacementAuditRecord & Record<string, unknown>> = [];

  async createRun(input: StartActReplacementRun) {
    const replay = this.runs.find(
      (run) =>
        run.sourceDatabaseKey === input.sourceDatabaseKey &&
        run.requestKey === input.requestKey,
    );
    if (replay) return { runId: replay.runId, created: false };
    const active = this.runs.find(
      (run) =>
        run.sourceDatabaseKey === input.sourceDatabaseKey &&
        run.status.phase === "extracting",
    );
    if (active) return { runId: active.runId, created: false };
    const runId = this.nextRunId;
    this.runs.push({
      runId,
      requestKey: input.requestKey,
      sourceDatabaseKey: input.sourceDatabaseKey,
      requestedBy: input.requestedBy,
      status: status(runId, input.pageSize),
    });
    return { runId, created: true };
  }

  async findOwnedRun(input: {
    runId: string;
    sourceDatabaseKey?: string;
    requestedBy: string;
  }) {
    const run = this.runs.find(
      (candidate) =>
        candidate.runId === input.runId &&
        (input.sourceDatabaseKey === undefined ||
          candidate.sourceDatabaseKey === input.sourceDatabaseKey) &&
        candidate.requestedBy === input.requestedBy,
    );
    return run
      ? { runId: run.runId, sourceDatabaseKey: run.sourceDatabaseKey }
      : null;
  }

  async findLatestOwnedRun(input: {
    sourceDatabaseKey: string;
    requestedBy: string;
  }) {
    const run = this.runs.findLast(
      (candidate) =>
        candidate.sourceDatabaseKey === input.sourceDatabaseKey &&
        candidate.requestedBy === input.requestedBy,
    );
    return run ? { runId: run.runId } : null;
  }

  async summarize(runId: string) {
    const run = this.runs.find((candidate) => candidate.runId === runId);
    if (!run) throw new Error("not found");
    return structuredClone(run.status);
  }

  async supersedeRun(input: { runId: string; requestedBy: string; now: Date }) {
    const run = this.runs.find(
      (candidate) =>
        candidate.runId === input.runId &&
        candidate.requestedBy === input.requestedBy,
    );
    if (!run) throw new Error("not found");
    run.status.phase = "superseded";
    run.status.canResume = false;
    run.status.canStartOver = false;
  }

  async listRequestAudits(input: {
    runId: string;
    sourceDatabaseKey: string;
    requestedBy: string;
  }) {
    const run = this.runs.find(
      (candidate) =>
        candidate.runId === input.runId &&
        candidate.sourceDatabaseKey === input.sourceDatabaseKey &&
        candidate.requestedBy === input.requestedBy,
    );
    return run ? this.auditRows : [];
  }
}

function addRun(store: MemoryControlStore, input: Partial<StoredRun> = {}) {
  store.runs.push({
    runId: input.runId ?? RUN_ID,
    requestKey: input.requestKey ?? "request-one",
    sourceDatabaseKey: input.sourceDatabaseKey ?? DATABASE_KEY,
    requestedBy: input.requestedBy ?? "owner",
    status: input.status ?? status(input.runId ?? RUN_ID),
  });
}

type ArchiveProfileImportRouteStore = Pick<
  ArchiveProfileImportStore,
  "createOrGetJob" | "getStatus"
>;

function archiveProfileStatus(
  overrides: Partial<ArchiveProfileImportStatus> = {},
): ArchiveProfileImportStatus {
  return {
    jobId: ARCHIVE_PROFILE_JOB_ID,
    runId: RUN_ID,
    phase: "companies",
    active: true,
    eligibleCount: 1_432,
    processedCount: 50,
    createdCount: 31,
    linkedCount: 7,
    updatedCount: 3,
    alreadyImportedCount: 4,
    preservedCount: 3,
    retryableFailureCount: 2,
    lastErrorCode: null,
    ...overrides,
  };
}

class MemoryArchiveProfileImportRouteStore
  implements ArchiveProfileImportRouteStore
{
  status: ArchiveProfileImportStatus | null = null;
  readonly createInputs: Parameters<
    ArchiveProfileImportRouteStore["createOrGetJob"]
  >[0][] = [];
  readonly getInputs: Parameters<
    ArchiveProfileImportRouteStore["getStatus"]
  >[0][] = [];

  async createOrGetJob(
    input: Parameters<ArchiveProfileImportRouteStore["createOrGetJob"]>[0],
  ) {
    this.createInputs.push(structuredClone(input));
    this.status ??= archiveProfileStatus();
    if (this.status.phase === "failed") {
      this.status = {
        ...this.status,
        phase: "companies",
        active: true,
        lastErrorCode: null,
      };
    }
    return this.status;
  }

  async getStatus(
    input: Parameters<ArchiveProfileImportRouteStore["getStatus"]>[0],
  ) {
    this.getInputs.push(structuredClone(input));
    return this.status;
  }
}

function testApp(
  store: MemoryControlStore,
  configured = true,
  review?: NonNullable<ActReplacementRouteDependencies["review"]>,
  reportInternalError?: NonNullable<
    ActReplacementRouteDependencies["reportInternalError"]
  >,
  rejectedHandler?: (error: unknown) => void,
  archiveProfileImport: ArchiveProfileImportRouteStore =
    new MemoryArchiveProfileImportRouteStore(),
): ReturnType<typeof express> {
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    requireOwnerMiddleware,
    createActReplacementRouter({
      store,
      archiveProfileImport,
      getActConfiguration: () =>
        configured
          ? { configured: true, databaseName: DATABASE_KEY }
          : { configured: false },
      now: () => new Date("2026-08-01T12:03:00.000Z"),
      ...(review ? { review } : {}),
      ...(reportInternalError ? { reportInternalError } : {}),
    }),
  );
  if (rejectedHandler) {
    const captureError: ErrorRequestHandler = (error, _req, res, _next) => {
      rejectedHandler(error);
      if (!res.headersSent)
        res.status(500).json({ code: "test_rejected_handler" });
    };
    app.use(captureError);
  }
  return app;
}

function workflowReview(overrides: Record<string, unknown> = {}) {
  return {
    reader: {
      getManifest: vi.fn().mockResolvedValue(null),
      listSources: vi.fn().mockResolvedValue([]),
    },
    commands: {
      organize: vi.fn(),
      approveSafeDefaults: vi.fn(),
    },
    applyCoordinator: {
      applyNext: vi.fn(),
    },
    workflow: {
      summarize: vi.fn().mockResolvedValue({
        safeOperationCount: 3,
        reviewRequiredCount: 2,
        appliedOperationCount: 4,
        alreadyPresentOperationCount: 2,
        blockedOperationCount: 1,
        failedOperationCount: 0,
        manifestDigest: MANIFEST_DIGEST,
        nextApplyCursor: 4,
        canOrganize: false,
        canReview: true,
        canApplySafe: true,
      }),
    },
    ...overrides,
  } as unknown as NonNullable<ActReplacementRouteDependencies["review"]>;
}

function automaticWorkflow(
  manifestDigest = "b".repeat(64),
): ImportWorkflow {
  return {
    safeOperationCount: 2,
    autoResolvedCount: 4,
    archivedOnlyCount: 1,
    reviewRequiredCount: 1,
    appliedOperationCount: 3,
    alreadyPresentOperationCount: 2,
    blockedOperationCount: 1,
    failedOperationCount: 0,
    manifestDigest,
    nextApplyCursor: 5,
    canOrganize: false,
    canReview: true,
    canApplySafe: true,
    requiredStreams: ["contact"],
    leaseSummary: { active: 0, expired: 0 },
    operations: [
      {
        operationKey: "private-operation-key",
        sourceVersionId: "private-source-version",
        targetType: "contact",
        status: "pending",
        requiredForSourceOutcome: true,
        heldForReview: false,
        dependencyOperationKeys: ["private-dependency"],
        safeByDefault: true,
      },
    ],
    applyBatches: [{ state: "complete" }],
    durableAdapters: {
      reviewReader: true,
      commandService: true,
      applyRepository: true,
    },
  };
}

function ownerToken() {
  const issued = issueToken();
  if (!issued) throw new Error("test owner token was not issued");
  return issued.token;
}

beforeEach(() => {
  process.env.OWNER_PASSWORD = "owner-password";
  process.env.SESSION_SECRET = "route-test-session-secret";
});

describe("Act replacement owner authorization", () => {
  it.each([
    ["post", "/api/migration/act-replacement/runs"],
    ["get", "/api/migration/act-replacement/runs/latest"],
    ["get", `/api/migration/act-replacement/runs/${RUN_ID}`],
    ["get", `/api/migration/act-replacement/runs/${RUN_ID}/request-audit`],
    ["post", `/api/migration/act-replacement/runs/${RUN_ID}/resume`],
    ["post", `/api/migration/act-replacement/runs/${RUN_ID}/supersede`],
    ["post", `/api/migration/act-replacement/runs/${RUN_ID}/import-archived-profiles`],
    ["get", `/api/migration/act-replacement/runs/${RUN_ID}/import-archived-profiles`],
  ] as const)("rejects unauthenticated %s %s", async (method, path) => {
    const response = await request(testApp(new MemoryControlStore()))[method](
      path,
    );

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
  });
});

describe("archived profile import routes", () => {
  const endpoint = (runId = RUN_ID) =>
    `/api/migration/act-replacement/runs/${runId}/import-archived-profiles`;

  it.each([
    ["missing request key", {}],
    ["blank request key", { requestKey: "   " }],
    ["request key over 200 characters", { requestKey: "x".repeat(201) }],
    ["extra source database key", { requestKey: "archive-one", sourceDatabaseKey: "browser-db" }],
    ["extra requested-by value", { requestKey: "archive-one", requestedBy: "browser-owner" }],
    ["unrecognized field", { requestKey: "archive-one", extra: true }],
  ])("rejects a %s", async (_label, body) => {
    const control = new MemoryControlStore();
    const archive = new MemoryArchiveProfileImportRouteStore();
    addRun(control);
    const response = await request(testApp(control, true, undefined, undefined, undefined, archive))
      .post(endpoint()).set("Authorization", `Bearer ${ownerToken()}`).send(body);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: "invalid_request" });
    expect(archive.createInputs).toEqual([]);
  });

  it.each(["not-a-uuid", "10000000-0000-0000-0000-000000000001"])(
    "hides an invalid run id %s as not found",
    async (runId) => {
      const control = new MemoryControlStore();
      const archive = new MemoryArchiveProfileImportRouteStore();
      const app = testApp(control, true, undefined, undefined, undefined, archive);
      const post = await request(app).post(endpoint(runId))
        .set("Authorization", `Bearer ${ownerToken()}`).send({ requestKey: "archive-one" });
      const get = await request(app).get(endpoint(runId))
        .set("Authorization", `Bearer ${ownerToken()}`);
      expect(post.status).toBe(404);
      expect(post.body).toEqual({ code: "run_not_found" });
      expect(get.status).toBe(404);
      expect(get.body).toEqual({ code: "run_not_found" });
      expect(archive.createInputs).toEqual([]);
      expect(archive.getInputs).toEqual([]);
    },
  );

  it("checks owned-run access before touching the archive import store", async () => {
    const control = new MemoryControlStore();
    const archive = new MemoryArchiveProfileImportRouteStore();
    addRun(control, { requestedBy: "other-owner" });
    const app = testApp(control, true, undefined, undefined, undefined, archive);
    const authorization = `Bearer ${ownerToken()}`;
    const post = await request(app).post(endpoint()).set("Authorization", authorization)
      .send({ requestKey: "archive-one" });
    const get = await request(app).get(endpoint()).set("Authorization", authorization);
    expect(post.status).toBe(404);
    expect(post.body).toEqual({ code: "run_not_found" });
    expect(get.status).toBe(404);
    expect(get.body).toEqual({ code: "run_not_found" });
    expect(archive.createInputs).toEqual([]);
    expect(archive.getInputs).toEqual([]);
  });

  it("starts an active job with server-owned context and returns only safe status", async () => {
    const control = new MemoryControlStore();
    const archive = new MemoryArchiveProfileImportRouteStore();
    addRun(control, { status: { ...status(), phase: "extracting" } });
    archive.status = Object.assign(archiveProfileStatus(), {
      sourceDatabaseKey: "private-database-key", requestedBy: "private-owner",
      rawSnapshot: { name: "private ACT company" }, email: "private@example.com",
      phone: "555-0100", manifestDigest: "private-manifest", canOrganize: false,
      readyToApply: false,
    });
    const response = await request(testApp(control, true, undefined, undefined, undefined, archive))
      .post(endpoint()).set("Authorization", `Bearer ${ownerToken()}`)
      .send({ requestKey: "x".repeat(200) });
    expect(response.status).toBe(202);
    expect(response.body).toEqual(archiveProfileStatus());
    expect(archive.createInputs).toEqual([{
      runId: RUN_ID, sourceDatabaseKey: DATABASE_KEY, requestKey: "x".repeat(200),
      requestedBy: "owner", now: new Date("2026-08-01T12:03:00.000Z"),
    }]);
    expect(JSON.stringify(response.body)).not.toMatch(
      /sourceDatabaseKey|requestedBy|rawSnapshot|email|phone|manifestDigest|canOrganize|readyToApply|private/i,
    );
  });

  it("starts from the owned archive when ACT is unavailable", async () => {
    const control = new MemoryControlStore();
    const archive = new MemoryArchiveProfileImportRouteStore();
    addRun(control);
    const response = await request(testApp(control, false, undefined, undefined, undefined, archive))
      .post(endpoint()).set("Authorization", `Bearer ${ownerToken()}`)
      .send({ requestKey: "archive-without-act" });
    expect(response.status).toBe(202);
    expect(response.body).toEqual(archiveProfileStatus());
    expect(archive.createInputs[0]).toMatchObject({
      runId: RUN_ID,
      sourceDatabaseKey: DATABASE_KEY,
      requestedBy: "owner",
    });
  });

  it("replays duplicate completed starts idempotently with 200", async () => {
    const control = new MemoryControlStore();
    const archive = new MemoryArchiveProfileImportRouteStore();
    addRun(control);
    archive.status = archiveProfileStatus({
      phase: "complete", active: false, processedCount: 1_432, retryableFailureCount: 0,
    });
    const app = testApp(control, true, undefined, undefined, undefined, archive);
    const authorization = `Bearer ${ownerToken()}`;
    const first = await request(app).post(endpoint()).set("Authorization", authorization)
      .send({ requestKey: "same-click" });
    const replay = await request(app).post(endpoint()).set("Authorization", authorization)
      .send({ requestKey: "same-click" });
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(first.body).toEqual(archive.status);
    expect(replay.body).toEqual(first.body);
    expect(archive.createInputs).toHaveLength(2);
  });

  it("reactivates a failed durable job and preserves committed progress", async () => {
    const control = new MemoryControlStore();
    const archive = new MemoryArchiveProfileImportRouteStore();
    addRun(control);
    archive.status = archiveProfileStatus({
      phase: "failed",
      active: false,
      processedCount: 125,
      createdCount: 80,
      linkedCount: 20,
      alreadyImportedCount: 10,
      preservedCount: 12,
      retryableFailureCount: 3,
      lastErrorCode: "archive_profile_database_unavailable",
    });
    const app = testApp(control, true, undefined, undefined, undefined, archive);
    const authorization = `Bearer ${ownerToken()}`;

    const retry = await request(app).post(endpoint()).set("Authorization", authorization)
      .send({ requestKey: "retry-click" });
    const replay = await request(app).post(endpoint()).set("Authorization", authorization)
      .send({ requestKey: "retry-click" });

    expect(retry.status).toBe(202);
    expect(retry.body).toEqual(archiveProfileStatus({
      phase: "companies",
      active: true,
      processedCount: 125,
      createdCount: 80,
      linkedCount: 20,
      alreadyImportedCount: 10,
      preservedCount: 12,
      retryableFailureCount: 3,
      lastErrorCode: null,
    }));
    expect(replay.status).toBe(202);
    expect(replay.body).toEqual(retry.body);
  });

  it("returns 404 when an owned run has no archived-profile job", async () => {
    const control = new MemoryControlStore();
    const archive = new MemoryArchiveProfileImportRouteStore();
    addRun(control);
    const response = await request(testApp(control, true, undefined, undefined, undefined, archive))
      .get(endpoint()).set("Authorization", `Bearer ${ownerToken()}`);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: "archive_profile_import_not_found" });
    expect(archive.getInputs).toEqual([{
      runId: RUN_ID, sourceDatabaseKey: DATABASE_KEY, requestedBy: "owner",
    }]);
  });

  it("gets an existing job without organizer or manifest readiness", async () => {
    const control = new MemoryControlStore();
    const archive = new MemoryArchiveProfileImportRouteStore();
    addRun(control, { status: { ...status(), phase: "extracting" } });
    archive.status = archiveProfileStatus({ phase: "contacts", processedCount: 900 });
    const response = await request(testApp(control, true, undefined, undefined, undefined, archive))
      .get(endpoint()).set("Authorization", `Bearer ${ownerToken()}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(archive.status);
  });
});

describe("POST /api/migration/act-replacement/runs", () => {
  it.each([
    {},
    { requestKey: "", pageSize: 50 },
    { requestKey: "request-one", pageSize: 24 },
    { requestKey: "request-one", pageSize: 75 },
    { requestKey: "request-one", pageSize: "50" },
    {
      requestKey: "request-one",
      pageSize: 50,
      sourceDatabaseKey: "client-database",
    },
    { requestKey: "request-one", pageSize: 50, requestedBy: "admin" },
  ])("rejects a non-exact start payload %#", async (body) => {
    const response = await request(testApp(new MemoryControlStore()))
      .post("/api/migration/act-replacement/runs")
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: "invalid_request" });
  });

  it("creates a preview run with database and owner derived by the server", async () => {
    const store = new MemoryControlStore();

    const response = await request(testApp(store))
      .post("/api/migration/act-replacement/runs")
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ requestKey: "request-one", pageSize: 50 });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ created: true, run: status() });
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({
      requestKey: "request-one",
      sourceDatabaseKey: DATABASE_KEY,
      requestedBy: "owner",
    });
    expect(response.body).not.toHaveProperty("sourceDatabaseKey");
    expect(response.body).not.toHaveProperty("requestedBy");
  });

  it("replays a request and resolves a concurrent request to the active DB run", async () => {
    const store = new MemoryControlStore();
    const app = testApp(store);
    const authorization = `Bearer ${ownerToken()}`;

    const created = await request(app)
      .post("/api/migration/act-replacement/runs")
      .set("Authorization", authorization)
      .send({ requestKey: "request-one", pageSize: 100 });
    const replay = await request(app)
      .post("/api/migration/act-replacement/runs")
      .set("Authorization", authorization)
      .send({ requestKey: "request-one", pageSize: 25 });
    const concurrent = await request(app)
      .post("/api/migration/act-replacement/runs")
      .set("Authorization", authorization)
      .send({ requestKey: "request-two", pageSize: 200 });

    expect(created.body.run).toMatchObject({ runId: RUN_ID, pageSize: 100 });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ created: false, run: created.body.run });
    expect(concurrent.status).toBe(200);
    expect(concurrent.body).toEqual({ created: false, run: created.body.run });
    expect(store.runs).toHaveLength(1);
  });

  it("never exposes a database-active run owned by another principal", async () => {
    const store = new MemoryControlStore();
    addRun(store, { requestedBy: "other-owner" });

    const response = await request(testApp(store))
      .post("/api/migration/act-replacement/runs")
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ requestKey: "owner-request", pageSize: 50 });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: "run_conflict" });
    expect(JSON.stringify(response.body)).not.toContain(RUN_ID);
  });

  it("fails safely when the server Act configuration is absent", async () => {
    const response = await request(testApp(new MemoryControlStore(), false))
      .post("/api/migration/act-replacement/runs")
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ requestKey: "request-one", pageSize: 50 });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ code: "not_configured" });
  });
});

describe("durable status routes", () => {
  it("returns latest and specific status with exact DB counters and relationship errors", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    addRun(store, {
      runId: SECOND_RUN_ID,
      requestKey: "request-two",
      status: status(SECOND_RUN_ID, 200),
    });
    const app = testApp(store);
    const authorization = `Bearer ${ownerToken()}`;

    const latest = await request(app)
      .get("/api/migration/act-replacement/runs/latest")
      .set("Authorization", authorization);
    const specific = await request(app)
      .get(`/api/migration/act-replacement/runs/${RUN_ID}`)
      .set("Authorization", authorization);

    expect(latest.status).toBe(200);
    expect(latest.body).toEqual({ run: status(SECOND_RUN_ID, 200) });
    expect(specific.status).toBe(200);
    expect(specific.body).toEqual({ run: status() });
    expect(typeof specific.body.run.previewOnly).toBe("boolean");
    expect(specific.body.run.allStreams).toEqual({
      responseRows: 11,
      observedIdentities: 11,
      archivedIdentities: 11,
      completeIdentities: 9,
      partialIdentities: 1,
      failedIdentities: 1,
      snapshotVersionsInserted: 8,
      unsupportedCapabilities: 1,
    });
    expect(specific.body.run.streams[1]).toMatchObject({
      streamType: "opportunity_contact",
      error: {
        code: "rate_limited",
        retryable: true,
        retryAfter: "2026-08-01T12:02:00.000Z",
      },
    });
  });

  it("returns null for no latest run and hides foreign database or owner runs as 404", async () => {
    const store = new MemoryControlStore();
    addRun(store, { sourceDatabaseKey: "other-database" });
    addRun(store, {
      runId: SECOND_RUN_ID,
      requestedBy: "other-owner",
      status: status(SECOND_RUN_ID),
    });
    const app = testApp(store);
    const authorization = `Bearer ${ownerToken()}`;

    const latest = await request(app)
      .get("/api/migration/act-replacement/runs/latest")
      .set("Authorization", authorization);
    const foreignDatabase = await request(app)
      .get(`/api/migration/act-replacement/runs/${RUN_ID}`)
      .set("Authorization", authorization);
    const foreignOwner = await request(app)
      .get(`/api/migration/act-replacement/runs/${SECOND_RUN_ID}`)
      .set("Authorization", authorization);

    expect(latest.body).toEqual({ run: null });
    expect(foreignDatabase.status).toBe(404);
    expect(foreignDatabase.body).toEqual({ code: "run_not_found" });
    expect(foreignOwner.status).toBe(404);
    expect(foreignOwner.body).toEqual({ code: "run_not_found" });
  });
});

describe("Act replacement summary diagnostics", () => {
  it("reports the failing summary stage using only the underlying database error", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const databaseError = Object.assign(
      new Error("cannot extract elements from a scalar"),
      { name: "DatabaseError", code: "22023" },
    );
    const wrapper = Object.assign(
      new Error("Failed query containing values that must not be logged"),
      { cause: databaseError },
    );
    const reportInternalError = vi.fn();
    const review = workflowReview({
      workflow: {
        summarize: vi.fn().mockRejectedValue(wrapper),
      },
    });

    const response = await request(
      testApp(store, true, review, reportInternalError),
    )
      .get("/api/migration/act-replacement/runs/latest")
      .set("Authorization", `Bearer ${ownerToken()}`);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: "act_replacement_unavailable" });
    expect(reportInternalError).toHaveBeenCalledWith({
      stage: "review_workflow_summary",
      runId: RUN_ID,
      errorName: "DatabaseError",
      errorCode: "22023",
      errorMessage: "cannot extract elements from a scalar",
    });
    expect(JSON.stringify(reportInternalError.mock.calls)).not.toContain(
      "values that must not be logged",
    );
  });
});

describe("request audit metadata", () => {
  it("returns only safe normalized DB metadata", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    store.auditRows = [
      {
        auditId: "20000000-0000-4000-8000-000000000001",
        runId: RUN_ID,
        checkpointId: "30000000-0000-4000-8000-000000000001",
        streamType: "opportunity_contact",
        method: "GET",
        pathTemplate: "/api/opportunities/{id}/contacts",
        state: "failed",
        httpStatus: 429,
        safeErrorCode: "rate_limited",
        durationMs: 120,
        startedAt: "2026-08-01T12:00:00.000Z",
        completedAt: "2026-08-01T12:00:00.120Z",
        query: "$filter=password eq secret",
        headers: { authorization: "Bearer credential" },
        body: { password: "credential" },
        credential: "credential",
      },
    ];

    const response = await request(testApp(store))
      .get(`/api/migration/act-replacement/runs/${RUN_ID}/request-audit`)
      .set("Authorization", `Bearer ${ownerToken()}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      audits: [
        {
          auditId: "20000000-0000-4000-8000-000000000001",
          runId: RUN_ID,
          checkpointId: "30000000-0000-4000-8000-000000000001",
          streamType: "opportunity_contact",
          method: "GET",
          pathTemplate: "/api/opportunities/{id}/contacts",
          state: "failed",
          httpStatus: 429,
          safeErrorCode: "rate_limited",
          durationMs: 120,
          startedAt: "2026-08-01T12:00:00.000Z",
          completedAt: "2026-08-01T12:00:00.120Z",
        },
      ],
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toMatch(
      /query|header|body|credential|password|secret/i,
    );
  });
});

describe("resume and supersede", () => {
  it("resumes the same durable run and preserves its persisted page size", async () => {
    const store = new MemoryControlStore();
    addRun(store, { status: status(RUN_ID, 200) });

    const response = await request(testApp(store))
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/resume`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ run: status(RUN_ID, 200) });
    expect(store.runs).toHaveLength(1);
  });

  it("requires the exact start-over confirmation and preserves archive/applied data", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const app = testApp(store);
    const authorization = `Bearer ${ownerToken()}`;

    for (const body of [
      {},
      { confirm: "start over" },
      { confirm: "START OVER " },
      { confirm: "START OVER", runId: RUN_ID },
    ]) {
      const invalid = await request(app)
        .post(`/api/migration/act-replacement/runs/${RUN_ID}/supersede`)
        .set("Authorization", authorization)
        .send(body);
      expect(invalid.status).toBe(400);
      expect(invalid.body).toEqual({ code: "invalid_request" });
    }

    const superseded = await request(app)
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/supersede`)
      .set("Authorization", authorization)
      .send({ confirm: "START OVER" });

    expect(superseded.status).toBe(200);
    expect(superseded.body.run).toMatchObject({
      runId: RUN_ID,
      phase: "superseded",
    });
    expect(store.archiveRows).toEqual(["immutable-archive-row"]);
    expect(store.appliedRows).toEqual(["already-applied-row"]);
  });

  it.each(["request-audit", "resume", "supersede"])(
    "hides foreign run access on %s",
    async (operation) => {
      const store = new MemoryControlStore();
      addRun(store, { sourceDatabaseKey: "other-database" });
      const app = testApp(store);
      const authorization = `Bearer ${ownerToken()}`;
      const response =
        operation === "request-audit"
          ? await request(app)
              .get(
                `/api/migration/act-replacement/runs/${RUN_ID}/request-audit`,
              )
              .set("Authorization", authorization)
          : await request(app)
              .post(
                `/api/migration/act-replacement/runs/${RUN_ID}/${operation}`,
              )
              .set("Authorization", authorization)
              .send(operation === "supersede" ? { confirm: "START OVER" } : {});

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ code: "run_not_found" });
    },
  );
});

describe("owner import workflow", () => {
  it("organizes only an owned extract-complete run with an exact empty body", async () => {
    const store = new MemoryControlStore();
    const runStatus = status();
    runStatus.phase = "extract_complete";
    addRun(store, { status: runStatus });
    const startOrganize = vi.fn().mockResolvedValue({ status: "organizing" });
    const review = workflowReview({
      commands: { startOrganize, approveSafeDefaults: vi.fn() },
    });
    const app = testApp(store, true, review);
    const authorization = `Bearer ${ownerToken()}`;

    const invalid = await request(app)
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/organize`)
      .set("Authorization", authorization)
      .send({ runId: RUN_ID });
    const response = await request(app)
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/organize`)
      .set("Authorization", authorization)
      .send({});

    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ code: "invalid_request" });
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: "organizing" });
    expect(startOrganize).toHaveBeenCalledOnce();
    expect(startOrganize).toHaveBeenCalledWith(RUN_ID);
  });

  it("looks up ownership before organizing a run", async () => {
    const store = new MemoryControlStore();
    addRun(store, { sourceDatabaseKey: "other-database" });
    const startOrganize = vi.fn();
    const review = workflowReview({
      commands: { startOrganize, approveSafeDefaults: vi.fn() },
    });

    const response = await request(testApp(store, true, review))
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/organize`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({});

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: "run_not_found" });
    expect(startOrganize).not.toHaveBeenCalled();
  });

  it("returns workflow status derived by the durable review store", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const review = workflowReview();

    const response = await request(testApp(store, true, review))
      .get(`/api/migration/act-replacement/runs/${RUN_ID}`)
      .set("Authorization", `Bearer ${ownerToken()}`);

    expect(response.status).toBe(200);
    expect(response.body.run).toMatchObject({
      safeOperationCount: 3,
      reviewRequiredCount: 2,
      appliedOperationCount: 4,
      alreadyPresentOperationCount: 2,
      blockedOperationCount: 1,
      failedOperationCount: 0,
      manifestDigest: MANIFEST_DIGEST,
      nextApplyCursor: 4,
      canOrganize: false,
      canReview: true,
      canApplySafe: true,
      applyEnabled: false,
    });
  });

  it("returns only safe issue codes and display values from review summaries", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const review = workflowReview({
      reader: {
        getManifest: vi.fn().mockResolvedValue({
          digest: MANIFEST_DIGEST,
          diagnostics: [],
          operations: [],
          outcomes: [
            {
              sourceRecordId: "source-one",
              sourceVersionId: "version-one",
              state: "awaiting_review",
              issues: [
                {
                  code: "ambiguous_match",
                  reason: "name_only_match_requires_review",
                },
              ],
              candidates: [{ privateCandidateId: "candidate-secret" }],
              match: { localId: "private-local-id" },
              mappingWarnings: ["private warning"],
              unsupportedFieldPaths: ["private.path"],
              operationKeys: [],
            },
          ],
        }),
        listSources: vi.fn().mockResolvedValue([
          {
            sourceRecordId: "source-one",
            sourceVersionId: "version-one",
            streamType: "contact",
            display: {
              name: "Safe name",
              email: "safe@example.com",
              password: "credential",
              apiKey: "credential-api-key",
              credential: "credential-value",
              privateKey: "credential-private-key",
              customScalar: "private custom value",
              nested: { secret: "credential" },
            },
          },
        ]),
      },
    });

    const response = await request(testApp(store, true, review))
      .get(
        `/api/migration/act-replacement/runs/${RUN_ID}/issues?issue=ambiguous_match`,
      )
      .set("Authorization", `Bearer ${ownerToken()}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      page: 1,
      pageSize: 200,
      total: 1,
      manifestDigest: MANIFEST_DIGEST,
      summary: {
        decisionRequired: 0,
        archivedOnly: 1,
        issueCounts: { ambiguous_match: 1 },
        diagnosticCounts: {},
      },
      rows: [
        {
          sourceRecordId: "source-one",
          sourceVersionId: "version-one",
          state: "awaiting_review",
          issueCodes: ["ambiguous_match"],
          issues: [
            {
              code: "ambiguous_match",
              reason: "name_only_match_requires_review",
            },
          ],
          conflicts: [],
          candidates: [],
          canImportStandalone: false,
          operationKeys: [],
          streamType: "contact",
          display: { name: "Safe name", email: "safe@example.com" },
        },
      ],
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /password|credential|private|apiKey|privateCandidateId|warning|customScalar/i,
    );
  });

  it("returns bounded review summaries and sanitized actionable projections", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const review = workflowReview({
      reader: {
        getManifest: vi.fn().mockResolvedValue({
          digest: MANIFEST_DIGEST,
          diagnostics: [],
          operations: [],
          outcomes: [],
        }),
        listSources: vi.fn().mockResolvedValue([]),
        readReviewPage: vi.fn().mockResolvedValue({
          page: 1,
          pageSize: 25,
          total: 3,
          manifestDigest: MANIFEST_DIGEST,
          summary: {
            decisionRequired: 0,
            archivedOnly: 3,
            issueCounts: { field_conflict: 3 },
            diagnosticCounts: { unsupported_field: 1 },
          },
          rows: [
            {
              sourceRecordId: "source-one",
              sourceVersionId: "version-one",
              state: "awaiting_review",
              issues: [{ code: "field_conflict", reason: "phone" }],
              conflicts: [
                {
                  fieldName: "phone",
                  localValue: "555-0100",
                  sourceValue: "555-0101",
                  target: {
                    id: "contact-one",
                    entityType: "contact",
                    label: "Safe candidate",
                    detail: null,
                  },
                  reviewToken: REVIEW_TOKEN,
                },
              ],
              candidates: [
                {
                  id: "contact-one",
                  entityType: "contact",
                  label: "Safe candidate",
                  detail: null,
                  privatePayload: "never expose",
                },
              ],
              canImportStandalone: false,
              operationKeys: [],
              streamType: "contact",
              display: { name: "Safe name", password: "never expose" },
            },
          ],
        }),
      },
    });

    const response = await request(testApp(store, true, review))
      .get(
        `/api/migration/act-replacement/runs/${RUN_ID}/review?issue=field_conflict&page=1&pageSize=25`,
      )
      .set("Authorization", `Bearer ${ownerToken()}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      summary: {
        decisionRequired: 0,
        archivedOnly: 3,
        issueCounts: { field_conflict: 3 },
        diagnosticCounts: { unsupported_field: 1 },
      },
      rows: [
        {
          sourceRecordId: "source-one",
          issues: [{ code: "field_conflict", reason: "phone" }],
          conflicts: [
            {
              fieldName: "phone",
              localValue: "555-0100",
              sourceValue: "555-0101",
              target: {
                id: "contact-one",
                entityType: "contact",
                label: "Safe candidate",
                detail: null,
              },
              reviewToken: REVIEW_TOKEN,
            },
          ],
          candidates: [
            {
              id: "contact-one",
              entityType: "contact",
              label: "Safe candidate",
              detail: null,
            },
          ],
          canImportStandalone: false,
          display: { name: "Safe name" },
        },
      ],
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /password|privatePayload|never expose/i,
    );
  });

  it.each([
    [
      `/api/migration/act-replacement/runs/${RUN_ID}/review?issue=not_an_issue`,
    ],
    [
      `/api/migration/act-replacement/runs/${RUN_ID}/review?issue=field_conflict&issue=unsupported_record`,
    ],
    [
      `/api/migration/act-replacement/runs/${RUN_ID}/review?state=not_a_state`,
    ],
    [
      `/api/migration/act-replacement/runs/${RUN_ID}/review?state=ready&state=ignored`,
    ],
    [
      `/api/migration/act-replacement/runs/${RUN_ID}/issues?issue=not_an_issue`,
    ],
    [
      `/api/migration/act-replacement/runs/${RUN_ID}/issues?issue=field_conflict&issue=unsupported_record`,
    ],
  ])("rejects malformed review filters without reading %s", async (path) => {
    const store = new MemoryControlStore();
    addRun(store);
    const readReviewPage = vi.fn();
    const review = workflowReview({
      reader: {
        getManifest: vi.fn(),
        listSources: vi.fn(),
        readReviewPage,
      },
    });

    const response = await request(testApp(store, true, review))
      .get(path)
      .set("Authorization", `Bearer ${ownerToken()}`);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: "invalid_request" });
    expect(readReviewPage).not.toHaveBeenCalled();
  });

  it("bulk-decides only owned selections with strict bounded bodies and an authenticated actor", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const bulkDecide = vi.fn().mockResolvedValue({
      decisions: [{ id: "decision-one", sourceRecordId: "source-one" }],
      manifestDigest: "b".repeat(64),
      reviewedOperationIds: ["contact:source-one"],
    });
    const review = workflowReview({
      reader: {
        getManifest: vi.fn().mockResolvedValue({
          outcomes: [{ sourceRecordId: "source-one" }],
        }),
        listSources: vi.fn().mockResolvedValue([]),
      },
      commands: { bulkDecide },
    });
    const app = testApp(store, true, review);
    const authorization = `Bearer ${ownerToken()}`;
    const body = {
      expectedManifestDigest: MANIFEST_DIGEST,
      requestKey: "bulk-one",
      scope: "field_conflict",
      decision: "keep_local",
      fieldName: "phone",
      selections: [
        { sourceRecordId: "source-one", sourceVersionId: "version-one" },
      ],
    };

    const invalid = await request(app)
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/decisions/bulk`)
      .set("Authorization", authorization)
      .send({ ...body, selections: [] });
    const oversized = await request(app)
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/decisions/bulk`)
      .set("Authorization", authorization)
      .send({
        ...body,
        selections: Array.from({ length: 201 }, (_, index) => ({
          sourceRecordId: `source-${index}`,
          sourceVersionId: `version-${index}`,
        })),
      });
    const actorInjected = await request(app)
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/decisions/bulk`)
      .set("Authorization", authorization)
      .send({ ...body, requestedBy: "attacker-controlled" });
    const invalidCombination = await request(app)
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/decisions/bulk`)
      .set("Authorization", authorization)
      .send({
        ...body,
        scope: "relationship",
        decision: "keep_local",
        fieldName: null,
      });
    const response = await request(app)
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/decisions/bulk`)
      .set("Authorization", authorization)
      .send(body);

    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ code: "invalid_request" });
    expect(oversized.status).toBe(400);
    expect(oversized.body).toEqual({ code: "invalid_request" });
    expect(actorInjected.status).toBe(400);
    expect(actorInjected.body).toEqual({ code: "invalid_request" });
    expect(invalidCombination.status).toBe(400);
    expect(invalidCombination.body).toEqual({ code: "invalid_request" });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      decisions: [{ id: "decision-one", sourceRecordId: "source-one" }],
      manifestDigest: "b".repeat(64),
      reviewedOperationIds: ["contact:source-one"],
    });
    expect(bulkDecide).toHaveBeenCalledOnce();
    expect(bulkDecide).toHaveBeenCalledWith({ ...body, runId: RUN_ID, requestedBy: "owner" });
  });

  it("accepts bounded bulk context-identity decisions", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const bulkDecide = vi.fn().mockResolvedValue({ decisions: [], manifestDigest: MANIFEST_DIGEST, reviewedOperationIds: [] });
    const review = workflowReview({
      reader: { getManifest: vi.fn().mockResolvedValue({ outcomes: [{ sourceRecordId: "source-one" }] }), listSources: vi.fn().mockResolvedValue([]) },
      commands: { bulkDecide },
    });
    const body = {
      expectedManifestDigest: MANIFEST_DIGEST,
      requestKey: "bulk-context",
      scope: "duplicate_identity",
      decision: "link_existing",
      fieldName: null,
      selections: [{ sourceRecordId: "source-one", sourceVersionId: "version-one" }],
    };

    const response = await request(testApp(store, true, review))
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/decisions/bulk`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send(body);

    expect(response.status).toBe(201);
    expect(bulkDecide).toHaveBeenCalledWith({ ...body, runId: RUN_ID, requestedBy: "owner" });
  });

  it("checks bulk run ownership once without loading a manifest per selection", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const ownership = vi.spyOn(store, "findOwnedRun");
    const getManifest = vi.fn().mockResolvedValue({ outcomes: [] });
    const bulkDecide = vi.fn().mockResolvedValue({
      decisions: [],
      manifestDigest: "b".repeat(64),
      reviewedOperationIds: [],
    });
    const review = workflowReview({
      reader: { getManifest, listSources: vi.fn().mockResolvedValue([]) },
      commands: { bulkDecide },
    });
    const selections = Array.from({ length: 200 }, (_, index) => ({
      sourceRecordId: `source-${index}`,
      sourceVersionId: `version-${index}`,
    }));

    const response = await request(testApp(store, true, review))
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/decisions/bulk`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({
        expectedManifestDigest: MANIFEST_DIGEST,
        requestKey: "bounded-bulk",
        scope: "unsupported_record",
        decision: "ignore_source",
        fieldName: null,
        selections,
      });

    expect(response.status).toBe(201);
    expect(ownership).toHaveBeenCalledTimes(1);
    expect(getManifest).not.toHaveBeenCalled();
    expect(bulkDecide).toHaveBeenCalledOnce();
  });

  it("hides foreign bulk decisions and preserves stale-manifest conflicts", async () => {
    const store = new MemoryControlStore();
    addRun(store, { sourceDatabaseKey: "other-database" });
    const bulkDecide = vi.fn();
    const review = workflowReview({ commands: { bulkDecide } });
    const body = {
      expectedManifestDigest: MANIFEST_DIGEST,
      requestKey: "bulk-one",
      scope: "unsupported_record",
      decision: "ignore_source",
      fieldName: null,
      selections: [
        { sourceRecordId: "source-one", sourceVersionId: "version-one" },
      ],
    };

    const foreign = await request(testApp(store, true, review))
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/decisions/bulk`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send(body);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ code: "run_not_found" });
    expect(bulkDecide).not.toHaveBeenCalled();

    const ownedStore = new MemoryControlStore();
    addRun(ownedStore);
    const staleReview = workflowReview({
      reader: {
        getManifest: vi.fn().mockResolvedValue({
          outcomes: [{ sourceRecordId: "source-one" }],
        }),
        listSources: vi.fn().mockResolvedValue([]),
      },
      commands: {
        bulkDecide: vi.fn().mockRejectedValue({
          status: 409,
          code: "manifest_digest_mismatch",
        }),
      },
    });
    const stale = await request(testApp(ownedStore, true, staleReview))
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/decisions/bulk`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send(body);

    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({ code: "manifest_digest_mismatch" });
  });

  it("returns the atomic command's not-found result for mixed bulk selections", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const bulkDecide = vi.fn().mockRejectedValue({
      status: 404,
      code: "run_not_found",
    });
    const review = workflowReview({
      reader: {
        getManifest: vi.fn().mockResolvedValue({
          outcomes: [{ sourceRecordId: "source-one" }],
        }),
        listSources: vi.fn().mockResolvedValue([]),
      },
      commands: { bulkDecide },
    });

    const response = await request(testApp(store, true, review))
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/decisions/bulk`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({
        expectedManifestDigest: MANIFEST_DIGEST,
        requestKey: "mixed-owned-and-foreign",
        scope: "unsupported_record",
        decision: "ignore_source",
        fieldName: null,
        selections: [
          { sourceRecordId: "source-one", sourceVersionId: "version-one" },
          {
            sourceRecordId: "foreign-source",
            sourceVersionId: "foreign-version",
          },
        ],
      });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: "run_not_found" });
    expect(bulkDecide).toHaveBeenCalledOnce();
  });

  it("retires the legacy ready-outcome approval route", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const approveReady = vi.fn().mockResolvedValue({
      selectedOperationIds: ["contact:source-one"],
      approvedOperationIds: ["contact:source-one"],
      dependencyOperationIds: [],
      rejectedOperationIds: [],
      selectedCount: 1,
      dependencyCount: 0,
      rejectedCount: 0,
      manifestDigest: MANIFEST_DIGEST,
    });
    const review = workflowReview({ commands: { approveReady } });

    const response = await request(testApp(store, true, review))
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/approvals/ready`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({
        expectedManifestDigest: MANIFEST_DIGEST,
        requestKey: "ready-approval",
      });

    expect(response.status).toBe(410);
    expect(response.body).toEqual({ code: "safe_defaults_required" });
    expect(approveReady).not.toHaveBeenCalled();
  });

  it("strictly validates and owner-scopes safe-default approval", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const approveSafeDefaults = vi.fn().mockResolvedValue({
      selectedOperationIds: ["organization:one"],
      approvedOperationIds: ["organization:one"],
      dependencyOperationIds: [],
      rejectedOperationIds: [],
      selectedCount: 1,
      dependencyCount: 0,
      rejectedCount: 0,
      manifestDigest: MANIFEST_DIGEST,
    });
    const review = workflowReview({
      commands: { organize: vi.fn(), approveSafeDefaults },
    });
    const app = testApp(store, true, review);
    const authorization = `Bearer ${ownerToken()}`;

    const invalid = await request(app)
      .post(
        `/api/migration/act-replacement/runs/${RUN_ID}/approvals/safe-defaults`,
      )
      .set("Authorization", authorization)
      .send({
        expectedManifestDigest: MANIFEST_DIGEST,
        requestKey: "safe-one",
        operationIds: ["unsafe-client-selection"],
      });
    const response = await request(app)
      .post(
        `/api/migration/act-replacement/runs/${RUN_ID}/approvals/safe-defaults`,
      )
      .set("Authorization", authorization)
      .send({
        expectedManifestDigest: MANIFEST_DIGEST,
        requestKey: "safe-one",
      });

    expect(invalid.status).toBe(400);
    expect(approveSafeDefaults).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      approvedOperationCount: 1,
      manifestDigest: MANIFEST_DIGEST,
    });
  });

  it("injects the durable decision actor from the authenticated owner", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const decide = vi.fn().mockResolvedValue({ id: "decision-1" });
    const review = workflowReview({
      reader: {
        getManifest: vi.fn().mockResolvedValue({
          outcomes: [{ sourceRecordId: SOURCE_RECORD_ID }],
        }),
        listSources: vi.fn().mockResolvedValue([]),
      },
      commands: { decide },
    });

    const response = await request(testApp(store, true, review))
      .post(`/api/migration/act-replacement/source-records/${SOURCE_RECORD_ID}/decisions`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({
        runId: RUN_ID,
        sourceVersionId: SOURCE_VERSION_ID,
        scope: "field_conflict",
        decision: "keep_local",
        fieldName: "phone",
        requestKey: "decision-request",
      });

    expect(response.status).toBe(201);
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({
      decidedBy: "owner",
      sourceRecordId: SOURCE_RECORD_ID,
      sourceVersionId: SOURCE_VERSION_ID,
    }));
  });

  it("uses bounded source ownership instead of loading the full manifest", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const ownsSourceInRun = vi.fn().mockResolvedValue(true);
    const getManifest = vi.fn().mockRejectedValue(new Error("full_manifest_must_not_load"));
    const decide = vi.fn().mockResolvedValue({ id: "decision-1" });
    const review = workflowReview({
      reader: {
        ownsSourceInRun,
        getManifest,
        listSources: vi.fn().mockResolvedValue([]),
      },
      commands: { decide },
    });

    const response = await request(testApp(store, true, review))
      .post(`/api/migration/act-replacement/source-records/${SOURCE_RECORD_ID}/decisions`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({
        runId: RUN_ID,
        sourceVersionId: SOURCE_VERSION_ID,
        scope: "field_conflict",
        decision: "keep_local",
        fieldName: "phone",
        requestKey: "bounded-decision-request",
      });

    expect(response.status).toBe(201);
    expect(ownsSourceInRun).toHaveBeenCalledWith(RUN_ID, SOURCE_RECORD_ID);
    expect(getManifest).not.toHaveBeenCalled();
  });

  it("strictly rejects malformed UUIDs and unknown individual decision fields", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const decide = vi.fn().mockResolvedValue({ id: "decision-1" });
    const getManifest = vi.fn().mockResolvedValue({
      outcomes: [
        { sourceRecordId: "not-a-uuid" },
        { sourceRecordId: SOURCE_RECORD_ID },
      ],
    });
    const app = testApp(store, true, workflowReview({
      reader: { getManifest, listSources: vi.fn().mockResolvedValue([]) },
      commands: { decide },
    }));
    const body = {
      runId: RUN_ID,
      sourceVersionId: SOURCE_VERSION_ID,
      scope: "field_conflict",
      decision: "keep_local",
      fieldName: "phone",
      requestKey: "strict-decision",
    };

    const malformedPath = await request(app)
      .post("/api/migration/act-replacement/source-records/not-a-uuid/decisions")
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send(body);
    const unknownField = await request(app)
      .post(`/api/migration/act-replacement/source-records/${SOURCE_RECORD_ID}/decisions`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ ...body, decidedBy: "attacker-controlled" });

    expect(malformedPath.status).toBe(400);
    expect(unknownField.status).toBe(400);
    expect(decide).not.toHaveBeenCalled();
  });

  it("requires a reviewed conflict token and never accepts an individual overwrite target from the client", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const decide = vi.fn().mockResolvedValue({ id: "decision-1" });
    const review = workflowReview({
      reader: {
        getManifest: vi.fn().mockResolvedValue({ outcomes: [{ sourceRecordId: SOURCE_RECORD_ID }] }),
        listSources: vi.fn().mockResolvedValue([]),
      },
      commands: { decide },
    });
    const app = testApp(store, true, review);
    const body = {
      runId: RUN_ID,
      sourceVersionId: SOURCE_VERSION_ID,
      scope: "field_conflict",
      decision: "use_source",
      fieldName: "phone",
      requestKey: "individual-overwrite",
    };

    const missingToken = await request(app)
      .post(`/api/migration/act-replacement/source-records/${SOURCE_RECORD_ID}/decisions`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send(body);
    const injectedTarget = await request(app)
      .post(`/api/migration/act-replacement/source-records/${SOURCE_RECORD_ID}/decisions`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({
        ...body,
        reviewToken: REVIEW_TOKEN,
        targetEntityType: "organization",
        targetEntityId: "attacker-selected-target",
      });
    const accepted = await request(app)
      .post(`/api/migration/act-replacement/source-records/${SOURCE_RECORD_ID}/decisions`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ ...body, reviewToken: REVIEW_TOKEN });

    expect(missingToken.status).toBe(400);
    expect(injectedTarget.status).toBe(400);
    expect(accepted.status).toBe(201);
    expect(decide).toHaveBeenCalledOnce();
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({
      sourceRecordId: SOURCE_RECORD_ID,
      reviewToken: REVIEW_TOKEN,
      decidedBy: "owner",
    }));
    expect(decide.mock.calls[0]?.[0]).not.toMatchObject({
      targetEntityType: "organization",
      targetEntityId: "attacker-selected-target",
    });
  });

  it("rejects bulk use-source selections that omit their reviewed conflict token", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const bulkDecide = vi.fn();
    const review = workflowReview({
      reader: {
        getManifest: vi.fn().mockResolvedValue({ outcomes: [{ sourceRecordId: "source-one" }] }),
        listSources: vi.fn().mockResolvedValue([]),
      },
      commands: { bulkDecide },
    });

    const response = await request(testApp(store, true, review))
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/decisions/bulk`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({
        expectedManifestDigest: MANIFEST_DIGEST,
        requestKey: "bulk-overwrite",
        scope: "field_conflict",
        decision: "use_source",
        fieldName: "phone",
        selections: [{ sourceRecordId: "source-one", sourceVersionId: "version-one" }],
      });

    expect(response.status).toBe(400);
    expect(bulkDecide).not.toHaveBeenCalled();
  });

  it("rejects apply batches larger than 25 before any write", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const applyNext = vi.fn();
    const review = workflowReview({ applyCoordinator: { applyNext } });

    const response = await request(testApp(store, true, review))
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/apply-next`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({
        expectedManifestDigest: MANIFEST_DIGEST,
        approvalRequestKey: "apply-one",
        batchSize: 26,
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: "invalid_apply_batch_size" });
    expect(applyNext).not.toHaveBeenCalled();
  });

  it("continues all safe batches on the server after returning 202", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const applyNext = vi
      .fn()
      .mockResolvedValueOnce({ hasMore: true, requiresReview: false })
      .mockResolvedValueOnce({ hasMore: false, requiresReview: false });
    const review = workflowReview({ applyCoordinator: { applyNext } });
    process.env.ACT_MIGRATION_APPLY_ENABLED = "true";

    const response = await request(testApp(store, true, review))
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/apply-all`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({
        expectedManifestDigest: MANIFEST_DIGEST,
        approvalRequestKey: "apply-one",
        batchSize: 10,
      });

    delete process.env.ACT_MIGRATION_APPLY_ENABLED;
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ accepted: true, started: true });
    await vi.waitFor(() => expect(applyNext).toHaveBeenCalledTimes(2));
    expect(applyNext).toHaveBeenNthCalledWith(1, {
      runId: RUN_ID,
      expectedManifestDigest: MANIFEST_DIGEST,
      approvalRequestKey: "apply-one",
      requestedBy: "owner",
      batchSize: 10,
    });
  });

  it("reattaches repeated resume requests to the active server job", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    let finish!: (value: { hasMore: boolean; requiresReview: boolean }) => void;
    const applyNext = vi.fn(
      () =>
        new Promise<{ hasMore: boolean; requiresReview: boolean }>((resolve) => {
          finish = resolve;
        }),
    );
    const app = testApp(
      store,
      true,
      workflowReview({ applyCoordinator: { applyNext } }),
    );
    process.env.ACT_MIGRATION_APPLY_ENABLED = "true";
    const send = () =>
      request(app)
        .post(`/api/migration/act-replacement/runs/${RUN_ID}/apply-all`)
        .set("Authorization", `Bearer ${ownerToken()}`)
        .send({
          expectedManifestDigest: MANIFEST_DIGEST,
          approvalRequestKey: "apply-one",
          batchSize: 10,
        });

    const first = await send();
    const repeated = await send();
    finish({ hasMore: false, requiresReview: false });
    delete process.env.ACT_MIGRATION_APPLY_ENABLED;

    expect(first.body).toEqual({ accepted: true, started: true });
    expect(repeated.body).toEqual({ accepted: true, started: false });
    expect(applyNext).toHaveBeenCalledOnce();
  });

  it("keeps next-batch writes locked when the server apply flag is disabled", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const applyNext = vi.fn();
    const review = workflowReview({ applyCoordinator: { applyNext } });
    delete process.env.ACT_MIGRATION_APPLY_ENABLED;

    const response = await request(testApp(store, true, review))
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/apply-next`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({
        expectedManifestDigest: MANIFEST_DIGEST,
        approvalRequestKey: "apply-one",
        batchSize: 25,
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      code: "act_apply_disabled",
      previewOnly: true,
    });
    expect(applyNext).not.toHaveBeenCalled();
  });

  it("fails closed on the retired unbounded bulk apply endpoint", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const apply = vi.fn();
    const review = workflowReview({
      commands: {
        organize: vi.fn(),
        approveSafeDefaults: vi.fn(),
        apply,
      },
    });
    process.env.ACT_MIGRATION_APPLY_ENABLED = "true";

    const response = await request(testApp(store, true, review))
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/apply`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({
        approvedOperationIds: Array.from(
          { length: 26 },
          (_, index) => `operation:${index}`,
        ),
        expectedManifestDigest: MANIFEST_DIGEST,
        requestKey: "legacy-bulk",
      });

    delete process.env.ACT_MIGRATION_APPLY_ENABLED;
    expect(response.status).toBe(410);
    expect(response.body).toEqual({ code: "apply_next_required" });
    expect(apply).not.toHaveBeenCalled();
  });

  it("applies the next owned batch only when the server flag is enabled", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const applyNext = vi.fn().mockResolvedValue({
      batch: {
        batchId: "batch-one",
        runId: RUN_ID,
        manifestDigest: MANIFEST_DIGEST,
        state: "complete",
        operationCount: 1,
        completedCount: 1,
        alreadyPresentCount: 0,
        blockedCount: 0,
        failedCount: 0,
      },
      nextCursor: 1,
      hasMore: false,
      requiresReview: false,
    });
    const review = workflowReview({ applyCoordinator: { applyNext } });
    process.env.ACT_MIGRATION_APPLY_ENABLED = "true";

    const response = await request(testApp(store, true, review))
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/apply-next`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({
        expectedManifestDigest: MANIFEST_DIGEST,
        approvalRequestKey: "apply-one",
        batchSize: 25,
      });

    delete process.env.ACT_MIGRATION_APPLY_ENABLED;
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      batch: {
        batchId: "batch-one",
        runId: RUN_ID,
        manifestDigest: MANIFEST_DIGEST,
        state: "complete",
        operationCount: 1,
        completedCount: 1,
        alreadyPresentCount: 0,
        blockedCount: 0,
        failedCount: 0,
      },
      nextCursor: 1,
      hasMore: false,
      requiresReview: false,
    });
    expect(applyNext).toHaveBeenCalledWith({
      runId: RUN_ID,
      expectedManifestDigest: MANIFEST_DIGEST,
      approvalRequestKey: "apply-one",
      requestedBy: "owner",
      batchSize: 25,
    });
  });

  it("rejects client-supplied operation IDs and cursors before coordinator access", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const applyNext = vi.fn();
    const review = workflowReview({ applyCoordinator: { applyNext } });
    process.env.ACT_MIGRATION_APPLY_ENABLED = "true";

    const response = await request(testApp(store, true, review))
      .post(`/api/migration/act-replacement/runs/${RUN_ID}/apply-next`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({
        approvalRequestKey: "safe-approval",
        expectedManifestDigest: MANIFEST_DIGEST,
        batchSize: 25,
        approvedOperationIds: ["attacker:selected"],
        cursor: 500,
      });

    delete process.env.ACT_MIGRATION_APPLY_ENABLED;
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: "invalid_request" });
    expect(applyNext).not.toHaveBeenCalled();
  });
});

describe("POST /api/migration/act-replacement/runs/:runId/automatic-review", () => {
  const rebuiltDigest = "b".repeat(64);
  const endpoint = `/api/migration/act-replacement/runs/${RUN_ID}/automatic-review`;
  const body = {
    expectedManifestDigest: MANIFEST_DIGEST,
    requestKey: "automatic-review-one",
  };
  const commandResult = {
    decisions: [
      {
        id: "private-decision-id",
        sourceRecordId: "private-source-id",
        sourceVersionId: "private-source-version",
        scope: "field_conflict" as const,
        decision: "use_source" as const,
        requestKey: "private-decision-request",
        fieldName: "phone",
        targetEntityType: "contact",
        targetEntityId: "private-local-candidate",
        reviewedSourceValue: "private ACT phone",
        reviewedLocalValue: "private local phone",
        decidedBy: "owner",
        active: true,
      },
    ],
    reviewedOperationIds: ["private-operation-id"],
    manifestDigest: rebuiltDigest,
    summary: {
      linkedExisting: 2,
      importedNew: 1,
      relationshipsAssigned: 3,
      relationshipsOmitted: 1,
      actValuesSelected: 4,
      unsupportedIgnored: 1,
      manualReview: 2,
      decisionsCreatedOrReplayed: 12,
    },
  };

  function routeReview(input: {
    commandDigest?: string;
    remainingDigest?: string | null;
    workflowDigest?: string | null;
    publishedDigest?: string | null;
    commandError?: unknown;
    processing?: boolean;
    globalIssueCounts?: Record<string, number>;
    filteredIssueCounts?: Record<string, number>;
  } = {}) {
    const resolveAutomatically = input.commandError
      ? vi.fn().mockRejectedValue(input.commandError)
      : input.processing
        ? vi.fn().mockResolvedValue({ status: "processing" })
      : vi.fn().mockResolvedValue({
          status: "complete",
          ...commandResult,
          manifestDigest: input.commandDigest ?? rebuiltDigest,
        });
    const readReviewPage = vi.fn().mockResolvedValue({
      rows: [
        {
          sourceRecordId: "must-not-leak",
          sourceVersionId: "must-not-leak",
          state: "awaiting_review",
          issues: [{ code: "field_conflict", reason: "private-field" }],
          conflicts: [],
          candidates: [{ id: "private-candidate", label: "private-name" }],
          relationshipIssues: [],
          canImportStandalone: false,
          operationKeys: ["private-operation"],
        },
      ],
      page: 1,
      pageSize: 25,
      total: 2,
      manifestDigest:
        input.remainingDigest === undefined
          ? rebuiltDigest
          : input.remainingDigest,
      summary: {
        decisionRequired: 2,
        archivedOnly: 0,
        issueCounts: input.globalIssueCounts ?? {
          field_conflict: 1,
          relationship_unresolved: 1,
        },
        diagnosticCounts: { unsupported_field: 1 },
      },
      filteredIssueCounts: input.filteredIssueCounts ?? {
        field_conflict: 1,
        relationship_unresolved: 1,
      },
    });
    const workflow = automaticWorkflow(
      input.workflowDigest === undefined
        ? rebuiltDigest
        : input.workflowDigest ?? undefined,
    );
    if (input.workflowDigest === null) workflow.manifestDigest = null;
    const summarize = vi.fn().mockResolvedValue(workflow);
    const getManifest = vi.fn().mockResolvedValue(
      (input.publishedDigest === undefined
        ? rebuiltDigest
        : input.publishedDigest) === null
        ? null
        : {
            digest:
              input.publishedDigest === undefined
                ? rebuiltDigest
                : input.publishedDigest,
            diagnostics: [],
            outcomes: [],
            operations: [],
            rawSnapshot: "must-not-leak",
          },
    );
    return {
      review: workflowReview({
        reader: {
          getManifest,
          listSources: vi.fn().mockResolvedValue([]),
          readReviewPage,
        },
        commands: { resolveAutomatically },
        workflow: { summarize },
      }),
      resolveAutomatically,
      readReviewPage,
      summarize,
      getManifest,
    };
  }

  it("requires owner authentication", async () => {
    const response = await request(testApp(new MemoryControlStore()))
      .post(endpoint)
      .send(body);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
  });

  it("returns accepted without reading a second full review while recovery is processing", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const harness = routeReview({ processing: true });
    const response = await request(testApp(store, true, harness.review))
      .post(endpoint)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send(body);

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: "processing" });
    expect(harness.readReviewPage).not.toHaveBeenCalled();
    expect(harness.summarize).not.toHaveBeenCalled();
    expect(harness.getManifest).not.toHaveBeenCalled();
  });

  it.each([
    [
      "invalid run UUID",
      "/api/migration/act-replacement/runs/not-a-uuid/automatic-review",
      body,
      true,
      "owner",
      404,
      { code: "run_not_found" },
    ],
    [
      "malformed body",
      endpoint,
      { expectedManifestDigest: "not-a-digest", requestKey: "request" },
      true,
      "owner",
      400,
      { code: "invalid_request" },
    ],
    [
      "unconfigured server",
      endpoint,
      body,
      false,
      "owner",
      503,
      { code: "not_configured" },
    ],
    [
      "foreign run",
      endpoint,
      body,
      true,
      "other-owner",
      404,
      { code: "run_not_found" },
    ],
  ] as const)(
    "keeps %s precedence stable when review is unavailable",
    async (
      _label,
      path,
      payload,
      configured,
      requestedBy,
      expectedStatus,
      expectedBody,
    ) => {
      const store = new MemoryControlStore();
      addRun(store, { requestedBy });
      const rejectedHandler = vi.fn();

      const response = await request(
        testApp(store, configured, undefined, undefined, rejectedHandler),
      )
        .post(path)
        .set("Authorization", `Bearer ${ownerToken()}`)
        .send(payload);

      expect(response.status).toBe(expectedStatus);
      expect(response.body).toEqual(expectedBody);
      expect(rejectedHandler).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { expectedManifestDigest: MANIFEST_DIGEST },
    { expectedManifestDigest: "not-a-digest", requestKey: "request" },
    { expectedManifestDigest: MANIFEST_DIGEST, requestKey: "" },
    { ...body, actor: "attacker" },
    { ...body, requestedBy: "attacker" },
    { ...body, sourceRecordIds: [SOURCE_RECORD_ID] },
  ])("rejects a non-exact automatic-review payload %#", async (payload) => {
    const store = new MemoryControlStore();
    addRun(store);
    const { review, resolveAutomatically } = routeReview();

    const response = await request(testApp(store, true, review))
      .post(endpoint)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send(payload);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: "invalid_request" });
    expect(resolveAutomatically).not.toHaveBeenCalled();
  });

  it("requires server configuration and owned-run lookup before the command", async () => {
    const unconfiguredStore = new MemoryControlStore();
    addRun(unconfiguredStore);
    const unavailable = routeReview();
    const unconfigured = await request(
      testApp(unconfiguredStore, false, unavailable.review),
    )
      .post(endpoint)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send(body);

    const foreignStore = new MemoryControlStore();
    addRun(foreignStore, { requestedBy: "other-owner" });
    const foreign = routeReview();
    const notOwned = await request(testApp(foreignStore, true, foreign.review))
      .post(endpoint)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send(body);

    expect(unconfigured.status).toBe(503);
    expect(unconfigured.body).toEqual({ code: "not_configured" });
    expect(unavailable.resolveAutomatically).not.toHaveBeenCalled();
    expect(notOwned.status).toBe(404);
    expect(notOwned.body).toEqual({ code: "run_not_found" });
    expect(foreign.resolveAutomatically).not.toHaveBeenCalled();
  });

  it("derives the actor from context and returns only bounded counts and workflow status", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const ownership = vi.spyOn(store, "findOwnedRun");
    const {
      review,
      resolveAutomatically,
      readReviewPage,
      summarize,
      getManifest,
    } = routeReview();

    const response = await request(testApp(store, true, review))
      .post(endpoint)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "complete",
      summary: commandResult.summary,
      remainingReview: {
        count: 2,
        reasons: {
          field_conflict: 1,
          relationship_unresolved: 1,
        },
      },
      manifestDigest: rebuiltDigest,
      workflow: {
        safeOperationCount: 2,
        autoResolvedCount: 4,
        archivedOnlyCount: 1,
        reviewRequiredCount: 1,
        appliedOperationCount: 3,
        alreadyPresentOperationCount: 2,
        blockedOperationCount: 1,
        failedOperationCount: 0,
        nextApplyCursor: 5,
        canOrganize: false,
        canReview: true,
        canApplySafe: true,
      },
    });
    expect(resolveAutomatically).toHaveBeenCalledWith({
      runId: RUN_ID,
      expectedManifestDigest: MANIFEST_DIGEST,
      requestKey: "automatic-review-one",
      requestedBy: "owner",
    });
    expect(ownership.mock.invocationCallOrder[0]).toBeLessThan(
      resolveAutomatically.mock.invocationCallOrder[0]!,
    );
    expect(readReviewPage).toHaveBeenCalledWith({
      runId: RUN_ID,
      state: "needs_review",
      page: 1,
      pageSize: 25,
    });
    expect(summarize).toHaveBeenCalledWith(RUN_ID);
    expect(getManifest).toHaveBeenCalledWith(RUN_ID);
    expect(JSON.stringify(response.body)).not.toMatch(
      /private|decisionId|sourceRecordId|sourceVersionId|candidate|snapshot|operationKey/i,
    );
  });

  it("derives remaining reasons from the same needs-review filter as the count", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const { review } = routeReview({
      globalIssueCounts: {
        field_conflict: 1,
        unsupported_record: 7,
      },
      filteredIssueCounts: { field_conflict: 1 },
    });

    const response = await request(testApp(store, true, review))
      .post(endpoint)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.remainingReview).toEqual({
      count: 2,
      reasons: { field_conflict: 1 },
    });
  });

  it.each([
    ["command result", { commandDigest: "c".repeat(64) }],
    ["remaining review", { remainingDigest: "c".repeat(64) }],
    ["workflow", { workflowDigest: "c".repeat(64) }],
    ["published manifest", { publishedDigest: "c".repeat(64) }],
    ["missing remaining review", { remainingDigest: null }],
    ["missing workflow digest", { workflowDigest: null }],
    ["missing published manifest", { publishedDigest: null }],
  ] as const)(
    "returns one bounded conflict when the %s generation differs",
    async (_label, digests) => {
      const store = new MemoryControlStore();
      addRun(store);
      const { review } = routeReview(digests);

      const response = await request(testApp(store, true, review))
        .post(endpoint)
        .set("Authorization", `Bearer ${ownerToken()}`)
        .send(body);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ code: "review_generation_changed" });
      expect(JSON.stringify(response.body)).not.toMatch(
        /private|manifestDigest|workflow|remainingReview|summary/i,
      );
    },
  );

  it("preserves the stale-manifest domain conflict", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const { review } = routeReview({
      commandError: Object.assign(new Error("manifest_digest_mismatch"), {
        code: "manifest_digest_mismatch",
        status: 409,
      }),
    });

    const response = await request(testApp(store, true, review))
      .post(endpoint)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send(body);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: "manifest_digest_mismatch" });
  });

  it("returns the bounded unavailable code when review wiring or lazy initialization is unavailable", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const missing = await request(testApp(store))
      .post(endpoint)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send(body);
    const lazy = routeReview({
      commandError: Object.assign(new Error("database import failed"), {
        code: "review_unavailable",
        status: 503,
      }),
    });
    const failedInitialization = await request(testApp(store, true, lazy.review))
      .post(endpoint)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send(body);

    expect(missing.status).toBe(503);
    expect(missing.body).toEqual({ code: "review_unavailable" });
    expect(failedInitialization.status).toBe(503);
    expect(failedInitialization.body).toEqual({ code: "review_unavailable" });
  });

  it("maps a real production lazy-runtime initialization failure to review_unavailable", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const review = createProductionReview({
      sourceDatabaseKey: "lazy-failure-database",
      requestedBy: "owner",
    });

    const response = await request(testApp(store, true, review))
      .post(endpoint)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send(body);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ code: "review_unavailable" });
  });

  it("replays through the real in-memory command boundary without another decision or rebuild", async () => {
    const store = new MemoryControlStore();
    addRun(store);
    const initialManifest: ActOrganizeManifest = {
      digest: MANIFEST_DIGEST,
      diagnostics: [],
      outcomes: [
        {
          sourceRecordId: SOURCE_RECORD_ID,
          sourceVersionId: SOURCE_VERSION_ID,
          state: "unsupported",
          issues: [
            { code: "unsupported_record", reason: "normalization_failed" },
          ],
          candidates: [],
          match: null,
          mappingWarnings: [],
          unsupportedFieldPaths: [],
          operationKeys: [],
        },
      ],
      operations: [],
    };
    const approvals = new InMemoryApprovalRepository();
    const applyRepository = new InMemoryApplyRepository({ unsafeForTests: true });
    const commandStore = new InMemoryReviewCommandStore(
      approvals,
      new ActApplyService(applyRepository, false),
    );
    commandStore.seed(
      RUN_ID,
      initialManifest,
      {
        [SOURCE_RECORD_ID]: {
          sourceVersionId: SOURCE_VERSION_ID,
          streamType: "unsupported",
        },
      },
      "owner",
    );
    commandStore.seedAutomaticReview(RUN_ID, {
      records: [
        {
          sourceRecordId: SOURCE_RECORD_ID,
          sourceVersionId: SOURCE_VERSION_ID,
          unsupportedRecord: true,
        },
      ],
    });
    let rebuilds = 0;
    commandStore.rebuildAfterReviewChange = async () => {
      rebuilds += 1;
      commandStore.manifests.set(RUN_ID, {
        digest: rebuiltDigest,
        diagnostics: [],
        outcomes: [],
        operations: [],
      });
      return { status: "ready_to_apply" };
    };
    const commands = new ReviewCommandService(commandStore);
    const reader = {
      getManifest: async (runId: string) =>
        commandStore.manifests.get(runId) ?? null,
      listSources: async () => [
        {
          sourceRecordId: SOURCE_RECORD_ID,
          sourceVersionId: SOURCE_VERSION_ID,
          streamType: "unsupported",
          display: { secret: "never-return" },
        },
      ],
    };
    const review = workflowReview({
      reader,
      commands,
      workflow: {
        summarize: async () => automaticWorkflow(rebuiltDigest),
      },
    });
    const app = testApp(store, true, review);
    const authorization = `Bearer ${ownerToken()}`;

    const first = await request(app)
      .post(endpoint)
      .set("Authorization", authorization)
      .send(body);
    const replay = await request(app)
      .post(endpoint)
      .set("Authorization", authorization)
      .send(body);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(rebuilds).toBe(1);
    expect(
      [...commandStore.decisions.values()].flat().filter((decision) =>
        decision.active,
      ),
    ).toHaveLength(1);
  });
});

describe("legacy Act migration start", () => {
  it("returns the exact replacement-required 410 without launching a pipeline", async () => {
    const { default: legacyRouter } = await import("./act-migration");
    const app = express();
    app.use(express.json());
    app.use("/api", legacyRouter);

    const response = await request(app).post("/api/migration/act/start").send({
      baseUrl: "https://apius.act.com/act.web.api",
      databaseName: "client-database",
      username: "credential",
      password: "credential",
    });

    expect(response.status).toBe(410);
    expect(response.body).toEqual({ code: "replacement_import_required" });
    const runtime = await import("@/features/act-migration/runtime");
    expect(runtime.createActMigrationPreviewService).not.toHaveBeenCalled();
    expect(runtime.createActMigrationApplyService).not.toHaveBeenCalled();
  });
});
