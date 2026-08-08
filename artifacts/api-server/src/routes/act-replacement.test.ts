import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ActReplacementStatus,
  StartActReplacementRun,
} from "@/features/act-replacement/import-types";
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

const DATABASE_KEY = "server-act-database";
const RUN_ID = "10000000-0000-4000-8000-000000000001";
const SECOND_RUN_ID = "10000000-0000-4000-8000-000000000002";
const MANIFEST_DIGEST = "a".repeat(64);

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
    sourceDatabaseKey: string;
    requestedBy: string;
  }) {
    const run = this.runs.find(
      (candidate) =>
        candidate.runId === input.runId &&
        candidate.sourceDatabaseKey === input.sourceDatabaseKey &&
        candidate.requestedBy === input.requestedBy,
    );
    return run ? { runId: run.runId } : null;
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

function testApp(
  store: MemoryControlStore,
  configured = true,
  review?: NonNullable<ActReplacementRouteDependencies["review"]>,
): ReturnType<typeof express> {
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    requireOwnerMiddleware,
    createActReplacementRouter({
      store,
      getActConfiguration: () =>
        configured
          ? { configured: true, databaseName: DATABASE_KEY }
          : { configured: false },
      now: () => new Date("2026-08-01T12:03:00.000Z"),
      ...(review ? { review } : {}),
    }),
  );
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
        canApplySafe: true,
      }),
    },
    ...overrides,
  } as unknown as NonNullable<ActReplacementRouteDependencies["review"]>;
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
  ] as const)("rejects unauthenticated %s %s", async (method, path) => {
    const response = await request(testApp(new MemoryControlStore()))[method](
      path,
    );

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
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
                { code: "ambiguous_match", reason: "private rationale" },
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
      rows: [
        {
          sourceRecordId: "source-one",
          sourceVersionId: "version-one",
          state: "awaiting_review",
          issueCodes: ["ambiguous_match"],
          operationKeys: [],
          streamType: "contact",
          display: { name: "Safe name", email: "safe@example.com" },
        },
      ],
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /password|credential|private|apiKey|candidate|warning|customScalar/i,
    );
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
    expect(response.body).toMatchObject({
      approvedOperationIds: ["organization:one"],
      manifestDigest: MANIFEST_DIGEST,
    });
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
