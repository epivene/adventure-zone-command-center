import { afterEach, describe, expect, it, vi } from "vitest";

import { ActApiError } from "@/features/act-sync/act-errors";
import { ActAuthorizationRequiredError } from "@/features/act-sync/act-client";
import type { ActPage } from "@/features/act-migration/migration-types";
import type { ActSourceArchiveRepository } from "./archive-repository";
import type { ActReplacementCheckpointRepository } from "./checkpoint-repository";
import {
  ActExtractionWorker,
  type ActExtractionSourceClient,
} from "./extraction-worker";
import type {
  ActRequestAuditRepository,
  BeginActRequestAudit,
  FinishActRequestAudit,
} from "./request-audit-repository";
import type { ClaimedCheckpoint } from "./import-types";
import { logger } from "@/lib/logger";

const startedAt = new Date("2026-08-04T12:00:00.000Z");
const completedAt = new Date("2026-08-04T12:00:00.025Z");

function checkpoint(
  overrides: Partial<ClaimedCheckpoint> & {
    checkpointKind?: "list" | ClaimedCheckpoint["checkpointKind"];
  } = {},
): ClaimedCheckpoint {
  return {
    id: "checkpoint-1",
    runId: "run-1",
    sourceDatabaseKey: "database-a",
    leaseOwner: "worker-a",
    attemptCount: 1,
    streamType: "company",
    checkpointKind: "list",
    partitionKey: "root:company",
    requiredness: "required",
    parentSourceRecordId: null,
    parentActRecordId: null,
    sourceRecordId: null,
    nextSkip: 0,
    pageSize: 100,
    queryMode: "projected",
    deriveDetails: true,
    ...overrides,
  } as ClaimedCheckpoint;
}

function fixture(
  input: {
    claimed?: ClaimedCheckpoint | null;
    sourceResult?: ActPage | Record<string, unknown>;
    sourceError?: unknown;
    beginError?: unknown;
    archiveError?: unknown;
    authorizationReady?: boolean;
    authorizationError?: unknown;
  } = {},
) {
  const claimed = input.claimed === undefined ? checkpoint() : input.claimed;
  const events: string[] = [];
  const checkpointEvents: Array<{ name: string; input: unknown }> = [];
  const claims: unknown[] = [];
  const checkpoints = {
    async claimNext(value: unknown) {
      events.push("claim");
      claims.push(value);
      return claimed;
    },
    async switchToPlain(value: unknown) {
      checkpointEvents.push({ name: "switchToPlain", input: value });
    },
    async releaseForAuthorization(value: unknown) {
      checkpointEvents.push({ name: "releaseForAuthorization", input: value });
    },
    async markDetailCapabilityUnavailable(value: unknown) {
      checkpointEvents.push({
        name: "markDetailCapabilityUnavailable",
        input: value,
      });
      return { fallbackCheckpointId: "fallback-1", created: true };
    },
    async scheduleRetry(value: unknown) {
      checkpointEvents.push({ name: "scheduleRetry", input: value });
    },
    async markUnsupported(value: unknown) {
      checkpointEvents.push({ name: "markUnsupported", input: value });
    },
    async markFailed(value: unknown) {
      checkpointEvents.push({ name: "markFailed", input: value });
    },
  } as unknown as ActReplacementCheckpointRepository;

  const begins: BeginActRequestAudit[] = [];
  const finishes: FinishActRequestAudit[] = [];
  const audits: ActRequestAuditRepository = {
    async begin(value) {
      events.push("audit:begin");
      begins.push(value);
      if (input.beginError) throw input.beginError;
      return { auditId: "audit-1" };
    },
    async finish(value) {
      events.push("audit:finish");
      finishes.push(value);
    },
  };

  const sourceCalls: unknown[] = [];
  const get = async (value: unknown) => {
    events.push("source:get");
    sourceCalls.push(value);
    if (input.sourceError) throw input.sourceError;
    return (
      input.sourceResult ?? {
        items: [{ id: "company-1", name: "One" }],
        nextSkip: null,
        queryMode: "projected",
      }
    );
  };
  const source = {
    listRoot: get as ActExtractionSourceClient["listRoot"],
    getDetail: get as ActExtractionSourceClient["getDetail"],
    listRelationship: get as ActExtractionSourceClient["listRelationship"],
    listContactNotes: (contactId: string, request: unknown) =>
      get({ contactId, request }),
  } as ActExtractionSourceClient & {
    listContactNotes(contactId: string, request: unknown): Promise<unknown>;
  };

  const archiveCalls: unknown[] = [];
  const archive: ActSourceArchiveRepository = {
    async archiveCheckpointPage(value) {
      events.push("archive");
      archiveCalls.push(value);
      if (input.archiveError) throw input.archiveError;
      return {
        responseRows: value.items.length,
        observedIdentities: value.items.length,
        archivedIdentities: value.items.length,
        completeIdentities: 0,
        partialIdentities: 0,
        failedIdentities: 0,
        snapshotVersionsInserted: value.items.length,
      };
    },
  };

  let authorizationReady = input.authorizationReady ?? true;
  const authorization = {
    isReady() {
      return authorizationReady;
    },
    async authorize() {
      events.push("authorization:get");
      if (input.authorizationError) throw input.authorizationError;
      authorizationReady = true;
    },
  };

  const worker = new ActExtractionWorker({
    checkpoints,
    audits,
    source,
    archive,
    authorization,
    clock: { now: () => completedAt },
  });
  return {
    worker,
    events,
    claims,
    begins,
    finishes,
    sourceCalls,
    archiveCalls,
    checkpointEvents,
  };
}

describe("ActExtractionWorker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a relationship checkpoint claim and successful archival", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => logger);
    const test = fixture({
      claimed: checkpoint({
        streamType: "company_contact",
        checkpointKind: "relationship",
        partitionKey: "company-contact:company-1",
        parentActRecordId: "company-1",
      }),
      sourceResult: {
        items: [],
        nextSkip: null,
        queryMode: "plain",
      },
    });

    await test.worker.runOne({ workerId: "worker-a", now: startedAt });

    expect(info).toHaveBeenNthCalledWith(
      1,
      {
        runId: "run-1",
        checkpointId: "checkpoint-1",
        streamType: "company_contact",
        checkpointKind: "relationship",
        attemptCount: 1,
      },
      "Act extraction relationship checkpoint claimed",
    );
    expect(info).toHaveBeenNthCalledWith(
      2,
      {
        runId: "run-1",
        checkpointId: "checkpoint-1",
        streamType: "company_contact",
        checkpointKind: "relationship",
        responseRows: 0,
        archivedIdentities: 0,
      },
      "Act extraction relationship checkpoint archived",
    );
  });

  it("claims and archives one projected page after one metadata-only audited GET", async () => {
    const test = fixture();

    const result = await test.worker.runOne({
      workerId: "worker-a",
      now: startedAt,
    });

    expect(result).toEqual({
      kind: "progress",
      runId: "run-1",
      checkpointId: "checkpoint-1",
    });
    expect(test.claims).toEqual([
      { workerId: "worker-a", now: startedAt, leaseMs: 60_000 },
    ]);
    expect(test.events).toEqual([
      "claim",
      "audit:begin",
      "source:get",
      "audit:finish",
      "archive",
    ]);
    expect(test.sourceCalls).toHaveLength(1);
    expect(test.begins).toEqual([
      {
        runId: "run-1",
        checkpointId: "checkpoint-1",
        streamType: "company",
        method: "GET",
        pathTemplate: "/api/companies",
        startedAt,
      },
    ]);
    expect(test.finishes).toEqual([
      {
        auditId: "audit-1",
        state: "succeeded",
        httpStatus: null,
        safeErrorCode: null,
        durationMs: 25,
        completedAt,
      },
    ]);
    expect(test.archiveCalls).toEqual([
      expect.objectContaining({
        runId: "run-1",
        checkpointId: "checkpoint-1",
        leaseOwner: "worker-a",
        expectedSkip: 0,
        nextSkip: null,
        queryMode: "projected",
        items: [
          expect.objectContaining({
            streamType: "company",
            sourceKey: "company-1",
            snapshotScope: "list_projected",
          }),
        ],
        derivedCheckpoints: [
          expect.objectContaining({
            streamType: "company",
            checkpointKind: "detail",
            partitionKey: "detail:company-1",
          }),
        ],
      }),
    ]);
  });

  it("returns idle without creating an audit when no checkpoint can be claimed", async () => {
    const test = fixture({ claimed: null });

    await expect(
      test.worker.runOne({ workerId: "worker-a", now: startedAt }),
    ).resolves.toEqual({ kind: "idle" });
    expect(test.events).toEqual(["claim"]);
  });

  it("does not contact Act when committing the started audit fails", async () => {
    const test = fixture({ beginError: new Error("database unavailable") });

    await expect(
      test.worker.runOne({ workerId: "worker-a", now: startedAt }),
    ).resolves.toEqual({
      kind: "progress",
      runId: "run-1",
      checkpointId: "checkpoint-1",
    });
    expect(test.events).toEqual(["claim", "audit:begin"]);
    expect(test.sourceCalls).toHaveLength(0);
  });

  it("uses a cold authorization GET as its own audited step and requeues the claim", async () => {
    const test = fixture({ authorizationReady: false });

    await test.worker.runOne({ workerId: "worker-a", now: startedAt });

    expect(test.sourceCalls).toHaveLength(0);
    expect(test.events).toEqual([
      "claim",
      "audit:begin",
      "authorization:get",
      "audit:finish",
    ]);
    expect(test.begins).toEqual([
      {
        runId: "run-1",
        checkpointId: "checkpoint-1",
        streamType: "company",
        method: "GET",
        pathTemplate: "/authorize",
        startedAt,
      },
    ]);
    expect(test.checkpointEvents).toEqual([
      {
        name: "releaseForAuthorization",
        input: {
          checkpointId: "checkpoint-1",
          leaseOwner: "worker-a",
          now: completedAt,
        },
      },
    ]);
  });

  it("audits authorization rejection and terminalizes the run without a data GET", async () => {
    const test = fixture({
      authorizationReady: false,
      authorizationError: new ActApiError("authentication_failed", false),
    });

    await test.worker.runOne({ workerId: "worker-a", now: startedAt });

    expect(test.sourceCalls).toHaveLength(0);
    expect(test.begins[0]?.pathTemplate).toBe("/authorize");
    expect(test.finishes[0]).toMatchObject({
      state: "failed",
      safeErrorCode: "authentication_failed",
    });
    expect(test.checkpointEvents[0]?.name).toBe("markFailed");
  });

  it("requeues a readiness race without a hidden authorization fetch", async () => {
    const test = fixture({
      sourceError: new ActAuthorizationRequiredError(),
    });

    await test.worker.runOne({ workerId: "worker-a", now: startedAt });

    expect(test.sourceCalls).toHaveLength(1);
    expect(test.finishes[0]).toMatchObject({
      state: "failed",
      safeErrorCode: "authentication_failed",
    });
    expect(test.checkpointEvents).toEqual([
      {
        name: "releaseForAuthorization",
        input: {
          checkpointId: "checkpoint-1",
          leaseOwner: "worker-a",
          now: completedAt,
        },
      },
    ]);
  });

  it("leaves a committed started audit observable while the GET is in flight", async () => {
    let release!: (page: ActPage) => void;
    const pending = new Promise<ActPage>((resolve) => {
      release = resolve;
    });
    const test = fixture();
    test.worker = new ActExtractionWorker({
      checkpoints: {
        claimNext: async () => checkpoint(),
      } as unknown as ActReplacementCheckpointRepository,
      audits: {
        begin: async (value) => {
          test.begins.push(value);
          return { auditId: "audit-1" };
        },
        finish: async (value) => {
          test.finishes.push(value);
        },
      },
      source: {
        listRoot: async () => pending,
        listContactNotes: async () => ({
          items: [],
          nextSkip: null,
          queryMode: "plain",
        }),
        getDetail: async () => ({ id: "unused" }),
        listRelationship: async () => ({
          items: [],
          nextSkip: null,
          queryMode: "plain",
        }),
      },
      archive: {
        archiveCheckpointPage: async () => ({
          responseRows: 0,
          observedIdentities: 0,
          archivedIdentities: 0,
          completeIdentities: 0,
          partialIdentities: 0,
          failedIdentities: 0,
          snapshotVersionsInserted: 0,
        }),
      },
      authorization: { isReady: () => true, authorize: async () => {} },
      clock: { now: () => completedAt },
    });

    const running = test.worker.runOne({
      workerId: "worker-a",
      now: startedAt,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(test.begins).toHaveLength(1);
    expect(test.finishes).toHaveLength(0);
    release({
      items: [{ id: "company-1" }],
      nextSkip: null,
      queryMode: "projected",
    });
    await running;
  });

  it("switches the first projected list checkpoint to plain without a second GET", async () => {
    const test = fixture({
      sourceResult: { items: [], nextSkip: 0, queryMode: "plain" },
    });

    await test.worker.runOne({ workerId: "worker-a", now: startedAt });

    expect(test.sourceCalls).toHaveLength(1);
    expect(test.archiveCalls).toHaveLength(0);
    expect(test.checkpointEvents).toEqual([
      {
        name: "switchToPlain",
        input: {
          checkpointId: "checkpoint-1",
          leaseOwner: "worker-a",
          now: completedAt,
        },
      },
    ]);
  });

  it("marks detail unavailable and creates the whole-stream plain fallback", async () => {
    const test = fixture({
      claimed: checkpoint({
        checkpointKind: "detail",
        parentActRecordId: "private-record-id",
        queryMode: "plain",
        deriveDetails: false,
      }),
      sourceError: new ActApiError("endpoint_unsupported", false),
    });

    await test.worker.runOne({ workerId: "worker-a", now: startedAt });

    expect(test.begins[0]?.pathTemplate).toBe("/api/companies/{id}");
    expect(JSON.stringify(test.begins)).not.toContain("private-record-id");
    expect(test.checkpointEvents).toEqual([
      {
        name: "markDetailCapabilityUnavailable",
        input: {
          runId: "run-1",
          checkpointId: "checkpoint-1",
          leaseOwner: "worker-a",
          rootStream: "company",
          now: completedAt,
        },
      },
    ]);
  });

  it("schedules a rate-limited checkpoint retry from safe error metadata", async () => {
    const test = fixture({
      sourceError: new ActApiError("rate_limited", true, "120"),
    });

    await expect(
      test.worker.runOne({ workerId: "worker-a", now: startedAt }),
    ).resolves.toEqual({
      kind: "retry_scheduled",
      runId: "run-1",
      checkpointId: "checkpoint-1",
    });
    expect(test.finishes).toEqual([
      {
        auditId: "audit-1",
        state: "failed",
        httpStatus: null,
        safeErrorCode: "rate_limited",
        durationMs: 25,
        completedAt,
      },
    ]);
    expect(test.checkpointEvents).toEqual([
      {
        name: "scheduleRetry",
        input: {
          checkpointId: "checkpoint-1",
          leaseOwner: "worker-a",
          errorCode: "rate_limited",
          retryable: true,
          retryAfter: new Date("2026-08-04T12:02:00.000Z"),
          now: completedAt,
        },
      },
    ]);
  });

  it("marks an unsupported optional relationship without exposing its parent id", async () => {
    const test = fixture({
      claimed: checkpoint({
        streamType: "activity_contact",
        checkpointKind: "relationship",
        partitionKey: "relationship:secret-parent",
        parentActRecordId: "secret-parent",
        requiredness: "optional_capability",
        queryMode: "projected",
        deriveDetails: false,
      }),
      sourceError: new ActApiError("endpoint_unsupported", false),
    });

    await test.worker.runOne({ workerId: "worker-a", now: startedAt });

    expect(test.begins[0]?.pathTemplate).toBe("/api/activities/{id}/contacts");
    expect(
      JSON.stringify({ begins: test.begins, finishes: test.finishes }),
    ).not.toContain("secret-parent");
    expect(test.checkpointEvents[0]?.name).toBe("markUnsupported");
  });

  it("archives contact-scoped notes with their exact contact relationship", async () => {
    const test = fixture({
      claimed: checkpoint({
        streamType: "note",
        checkpointKind: "relationship",
        partitionKey: "contact-notes:contact%2F1",
        parentActRecordId: "contact/1",
        requiredness: "required",
        queryMode: "plain",
        deriveDetails: false,
      }),
      sourceResult: {
        items: [
          {
            id: "note-1",
            subject: "Waiver",
            body: "Remember the waiver",
          },
        ],
        nextSkip: null,
        queryMode: "plain",
      },
    });

    await test.worker.runOne({ workerId: "worker-a", now: startedAt });

    expect(test.begins[0]?.pathTemplate).toBe("/api/contacts/{id}/notes");
    expect(test.sourceCalls).toEqual([
      {
        contactId: "contact/1",
        request: { skip: 0, top: 100, queryMode: "plain" },
      },
    ]);
    expect(test.archiveCalls).toEqual([
      expect.objectContaining({
        items: [
          expect.objectContaining({
            streamType: "note",
            sourceKey: "note-1",
            archiveCompleteness: "complete",
            relationshipEvidence: {
              source: "endpoint",
              parentKind: "note",
              parentActRecordId: "note-1",
              targetKind: "contact",
              targetActRecordId: "contact/1",
            },
          }),
        ],
        derivedCheckpoints: [],
      }),
    ]);
  });

  it("fails the run through the checkpoint repository on authentication failure", async () => {
    const test = fixture({
      sourceError: new ActApiError("authentication_failed", false),
    });

    await test.worker.runOne({ workerId: "worker-a", now: startedAt });

    expect(test.checkpointEvents).toEqual([
      {
        name: "markFailed",
        input: {
          checkpointId: "checkpoint-1",
          leaseOwner: "worker-a",
          errorCode: "authentication_failed",
          retryable: false,
          retryAfter: null,
          now: completedAt,
        },
      },
    ]);
  });

  it("audits malformed source items as invalid and fails the checkpoint", async () => {
    const test = fixture({
      sourceResult: {
        items: [null],
        nextSkip: null,
        queryMode: "projected",
      },
    });

    await test.worker.runOne({ workerId: "worker-a", now: startedAt });

    expect(test.finishes).toEqual([
      {
        auditId: "audit-1",
        state: "failed",
        httpStatus: null,
        safeErrorCode: "invalid_response",
        durationMs: 25,
        completedAt,
      },
    ]);
    expect(test.archiveCalls).toHaveLength(0);
    expect(test.checkpointEvents).toEqual([
      {
        name: "markFailed",
        input: {
          checkpointId: "checkpoint-1",
          leaseOwner: "worker-a",
          errorCode: "invalid_response",
          retryable: false,
          retryAfter: null,
          now: completedAt,
        },
      },
    ]);
  });

  it("leaves the lease recoverable when atomic archival rolls back", async () => {
    const test = fixture({
      archiveError: new Error("transaction rolled back"),
    });

    await expect(
      test.worker.runOne({ workerId: "worker-a", now: startedAt }),
    ).resolves.toEqual({
      kind: "progress",
      runId: "run-1",
      checkpointId: "checkpoint-1",
    });
    expect(test.finishes[0]).toMatchObject({
      state: "succeeded",
      safeErrorCode: null,
    });
    expect(test.checkpointEvents).toHaveLength(0);
    expect(test.archiveCalls).toHaveLength(1);
  });
});
