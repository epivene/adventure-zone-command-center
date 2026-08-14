import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";
import type { AiCompletionClient } from "../ai-suggestions/ai-client";
import type {
  ArchiveProfileImportStore,
  ClaimedArchiveProfileJob,
} from "./archive-profile-import-repository";
import type {
  ArchiveProfileImportStatus,
  ArchiveProfileSourceContext,
} from "./archive-profile-import-types";
import { ArchiveProfileImportWorker } from "./archive-profile-import-worker";

const now = new Date("2026-08-14T12:00:00.000Z");
const claim: ClaimedArchiveProfileJob = {
  jobId: "job-1",
  runId: "run-1",
  sourceDatabaseKey: "archive-a",
  phase: "companies",
  cursorSourceRecordId: null,
  leaseToken: "lease-1",
};
const status: ArchiveProfileImportStatus = {
  jobId: claim.jobId,
  runId: claim.runId,
  phase: "companies",
  active: true,
  eligibleCount: 1,
  processedCount: 1,
  createdCount: 1,
  linkedCount: 0,
  updatedCount: 0,
  alreadyImportedCount: 0,
  preservedCount: 0,
  retryableFailureCount: 0,
  lastErrorCode: null,
};

function companyContext(index = 1): ArchiveProfileSourceContext {
  return {
    source: {
      sourceRecordId: `company-source-${index}`,
      sourceVersionId: `company-version-${index}`,
      streamType: "company",
      actRecordId: `act-company-${index}`,
      rawSnapshot: { Name: `Company ${index}` },
      relationshipEvidence: {},
    },
    candidates: [],
    linkedTarget: null,
  };
}

function needsAiContact(index: number): ArchiveProfileSourceContext {
  return {
    source: {
      sourceRecordId: `contact-source-${index}`,
      sourceVersionId: `contact-version-${index}`,
      streamType: "contact",
      actRecordId: `act-contact-${index}`,
      rawSnapshot: { FirstName: `Contact ${index}` },
      relationshipEvidence: {},
    },
    candidates: [],
    linkedTarget: null,
  };
}

function ambiguousIdentityIncompleteContext(
  streamType: "company" | "contact",
): ArchiveProfileSourceContext {
  if (streamType === "company") {
    return {
      source: {
        sourceRecordId: "ambiguous-company-source",
        sourceVersionId: "ambiguous-company-version",
        streamType,
        actRecordId: "ambiguous-company-act",
        rawSnapshot: { Phone: "512-555-0100" },
        relationshipEvidence: {},
      },
      candidates: [1, 2].map((index) => ({
        id: `organization-${index}`,
        entityType: "organization" as const,
        exactSignals: ["company_name_and_location" as const],
        values: { name: `Organization ${index}`, phone: "512-555-0100" },
      })),
      linkedTarget: null,
    };
  }
  return {
    source: {
      sourceRecordId: "ambiguous-contact-source",
      sourceVersionId: "ambiguous-contact-version",
      streamType,
      actRecordId: "ambiguous-contact-act",
      rawSnapshot: { FirstName: "Casey", EmailAddress: "casey@example.com" },
      relationshipEvidence: {},
    },
    candidates: ["Jones", "Smith"].map((lastName, index) => ({
      id: `contact-${index + 1}`,
      entityType: "contact" as const,
      exactSignals: ["email" as const],
      values: { firstName: "Casey", lastName, email: "casey@example.com" },
    })),
    linkedTarget: null,
  };
}

function makeStore(overrides: Partial<ArchiveProfileImportStore> = {}) {
  const store: ArchiveProfileImportStore = {
    createOrGetJob: vi.fn(),
    getStatus: vi.fn(),
    claimNext: vi.fn(async () => claim),
    loadBatch: vi.fn(async () => [companyContext()]),
    commitBatch: vi.fn(async () => ({ status, phaseAdvanced: false })),
    failBatch: vi.fn(async () => undefined),
    ...overrides,
  };
  return store;
}

function clientReturningDecisions(batchSizes: number[]): AiCompletionClient {
  return {
    providerName: "test-provider",
    async complete(prompt) {
      const marker = "Input:\n";
      const payload = JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length)) as Array<{
        sourceRecordId: string;
      }>;
      batchSizes.push(payload.length);
      return JSON.stringify({
        decisions: payload.map(({ sourceRecordId }) => ({
          sourceRecordId,
          action: "preserve_for_later",
          confidence: "high",
        })),
      });
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ArchiveProfileImportWorker", () => {
  it("returns idle without loading or committing when no job is claimable", async () => {
    const store = makeStore({ claimNext: vi.fn(async () => null) });
    const worker = new ArchiveProfileImportWorker({
      store,
      createAiClient: vi.fn(),
      clock: { now: () => now },
    });

    await expect(worker.runOne({ workerId: "worker-1", now })).resolves.toEqual({ kind: "idle" });
    expect(store.loadBatch).not.toHaveBeenCalled();
    expect(store.commitBatch).not.toHaveBeenCalled();
  });

  it("resolves one deterministic batch and commits it once without creating an AI client", async () => {
    const store = makeStore();
    const createAiClient = vi.fn();
    const worker = new ArchiveProfileImportWorker({
      store,
      createAiClient,
      clock: { now: () => now },
    });

    await expect(worker.runOne({ workerId: "worker-1", now })).resolves.toEqual({ kind: "progress" });
    expect(store.loadBatch).toHaveBeenCalledWith({ ...claim, limit: 50 });
    expect(createAiClient).not.toHaveBeenCalled();
    expect(store.commitBatch).toHaveBeenCalledTimes(1);
    expect(store.commitBatch).toHaveBeenCalledWith({
      ...claim,
      records: [{
        source: companyContext().source,
        resolution: {
          action: "create_profile",
          targetEntityType: "organization",
          values: {
            name: "Company 1",
            phone: null,
            website: null,
            industry: null,
            address1: null,
            address2: null,
            city: null,
            region: null,
            postalCode: null,
          },
          evidenceLabels: ["no_exact_match"],
        },
      }],
      now,
    });
  });

  it("preserves a null-ID source and still resolves later records in the batch", async () => {
    const missingId = {
      ...companyContext(1),
      source: { ...companyContext(1).source, actRecordId: null },
    };
    const later = companyContext(2);
    const store = makeStore({ loadBatch: vi.fn(async () => [missingId, later]) });
    const createAiClient = vi.fn();
    const worker = new ArchiveProfileImportWorker({
      store,
      createAiClient,
      clock: { now: () => now },
    });

    await expect(worker.runOne({ workerId: "worker-1", now })).resolves.toEqual({ kind: "progress" });
    expect(createAiClient).not.toHaveBeenCalled();
    expect(store.commitBatch).toHaveBeenCalledWith({
      ...claim,
      records: [
        {
          source: missingId.source,
          resolution: {
            action: "preserve",
            reasonCode: "missing_act_record_id",
            evidenceLabels: ["missing_act_record_id"],
          },
        },
        expect.objectContaining({
          source: later.source,
          resolution: expect.objectContaining({ action: "create_profile" }),
        }),
      ],
      now,
    });
  });

  it("sends only needs-ai projections in slices of 20, 20, and the remainder", async () => {
    const contexts = [companyContext(), ...Array.from({ length: 45 }, (_, index) => needsAiContact(index + 1))];
    const store = makeStore({ loadBatch: vi.fn(async () => contexts) });
    const batchSizes: number[] = [];
    const createAiClient = vi.fn(async () => clientReturningDecisions(batchSizes));
    const worker = new ArchiveProfileImportWorker({
      store,
      createAiClient,
      clock: { now: () => now },
    });

    await worker.runOne({ workerId: "worker-1", now });

    expect(batchSizes).toEqual([20, 20, 5]);
    expect(createAiClient).toHaveBeenCalledTimes(1);
    expect(store.commitBatch).toHaveBeenCalledTimes(1);
    const committed = vi.mocked(store.commitBatch).mock.calls[0]![0].records;
    expect(committed).toHaveLength(46);
    expect(committed[0]).toMatchObject({
      source: { sourceRecordId: "company-source-1" },
      resolution: { action: "create_profile" },
    });
    expect(committed.slice(1)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: expect.objectContaining({ sourceRecordId: "contact-source-45" }),
        resolution: expect.objectContaining({
          action: "preserve",
          provenance: {
            resolutionPolicyVersion: "archive-profile-ai-v1",
            aiProvider: "test-provider",
            aiConfidence: "high",
          },
        }),
      }),
    ]));
  });

  it("commits deterministic results when AI provider creation fails", async () => {
    const store = makeStore({
      loadBatch: vi.fn(async () => [companyContext(), needsAiContact(1), needsAiContact(2)]),
    });
    const unavailable = Object.assign(new Error("provider secret"), {
      code: "NO_AI_PROVIDER_CONFIGURED",
    });
    const createAiClient = vi.fn(async () => { throw unavailable; });
    const worker = new ArchiveProfileImportWorker({
      store,
      createAiClient,
      clock: { now: () => now },
    });

    await expect(worker.runOne({ workerId: "worker-1", now })).resolves.toEqual({ kind: "progress" });

    const records = vi.mocked(store.commitBatch).mock.calls[0]![0].records;
    expect(createAiClient).toHaveBeenCalledTimes(1);
    expect(records).toMatchObject([
      { resolution: { action: "create_profile" } },
      { resolution: {
        action: "retry_later",
        reasonCode: "ai_unavailable",
        provenance: {
          resolutionPolicyVersion: "archive-profile-ai-v1",
          aiProvider: null,
          aiConfidence: null,
        },
      } },
      { resolution: { action: "retry_later", reasonCode: "ai_unavailable" } },
    ]);
  });

  it("sends real resolver ambiguity for identity-incomplete companies and contacts to AI preserve", async () => {
    const contexts = [
      ambiguousIdentityIncompleteContext("company"),
      ambiguousIdentityIncompleteContext("contact"),
    ];
    const store = makeStore({ loadBatch: vi.fn(async () => contexts) });
    const batchSizes: number[] = [];
    const worker = new ArchiveProfileImportWorker({
      store,
      createAiClient: vi.fn(async () => clientReturningDecisions(batchSizes)),
      clock: { now: () => now },
    });

    await expect(worker.runOne({ workerId: "worker-1", now })).resolves.toEqual({ kind: "progress" });

    expect(batchSizes).toEqual([2]);
    const records = vi.mocked(store.commitBatch).mock.calls[0]![0].records;
    expect(records).toHaveLength(2);
    expect(records.every(({ resolution }) =>
      resolution.action === "preserve" &&
      resolution.evidenceLabels.includes("ambiguous_exact_match")
    )).toBe(true);
    expect(store.failBatch).not.toHaveBeenCalled();
  });

  it("commits retry-later for real resolver ambiguity when the AI provider is unavailable", async () => {
    const contexts = [
      ambiguousIdentityIncompleteContext("company"),
      ambiguousIdentityIncompleteContext("contact"),
    ];
    const store = makeStore({ loadBatch: vi.fn(async () => contexts) });
    const worker = new ArchiveProfileImportWorker({
      store,
      createAiClient: vi.fn(async () => {
        throw Object.assign(new Error("provider unavailable"), { code: "NO_AI_PROVIDER_CONFIGURED" });
      }),
      clock: { now: () => now },
    });

    await expect(worker.runOne({ workerId: "worker-1", now })).resolves.toEqual({ kind: "progress" });

    const records = vi.mocked(store.commitBatch).mock.calls[0]![0].records;
    expect(records).toHaveLength(2);
    expect(records.every(({ resolution }) =>
      resolution.action === "retry_later" &&
      resolution.reasonCode === "ai_unavailable" &&
      resolution.evidenceLabels.includes("ambiguous_exact_match")
    )).toBe(true);
    expect(store.failBatch).not.toHaveBeenCalled();
  });

  it.each(["synchronous throw", "asynchronous rejection"] as const)(
    "caches a provider %s once across every AI slice and commits deterministic rows",
    async (failureMode) => {
      const contexts = [
        companyContext(),
        ...Array.from({ length: 45 }, (_, index) => needsAiContact(index + 1)),
      ];
      const store = makeStore({ loadBatch: vi.fn(async () => contexts) });
      const unavailable = Object.assign(new Error("provider secret"), {
        code: "NO_AI_PROVIDER_CONFIGURED",
      });
      const createAiClient = vi.fn(() => {
        if (failureMode === "synchronous throw") throw unavailable;
        return Promise.reject(unavailable);
      });
      const worker = new ArchiveProfileImportWorker({
        store,
        createAiClient,
        clock: { now: () => now },
      });

      await expect(worker.runOne({ workerId: "worker-1", now })).resolves.toEqual({
        kind: "progress",
      });

      expect(createAiClient).toHaveBeenCalledTimes(1);
      expect(store.failBatch).not.toHaveBeenCalled();
      expect(store.commitBatch).toHaveBeenCalledTimes(1);
      const records = vi.mocked(store.commitBatch).mock.calls[0]![0].records;
      expect(records).toHaveLength(46);
      expect(records[0]!.resolution.action).toBe("create_profile");
      expect(records.slice(1).every(({ resolution }) =>
        resolution.action === "retry_later" && resolution.reasonCode === "ai_unavailable"
      )).toBe(true);
    },
  );

  it.each([
    "archive_profile_target_set_changed",
    "profile_candidate_stale",
    "profile_source_link_stale",
  ])("retries optimistic conflict %s without terminalizing the claimed job", async (code) => {
    const conflict = Object.assign(new Error("bounded conflict"), { code });
    const store = makeStore({ commitBatch: vi.fn(async () => { throw conflict; }) });
    const worker = new ArchiveProfileImportWorker({
      store,
      createAiClient: vi.fn(),
      clock: { now: () => now },
    });

    await worker.runOne({ workerId: "worker-1", now });

    expect(store.commitBatch).toHaveBeenCalledTimes(1);
    expect(store.failBatch).toHaveBeenCalledWith({
      ...claim,
      errorCode: code,
      retryable: true,
      now,
    });
  });

  it.each([
    "40001",
    "40P01",
    "08006",
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "EHOSTUNREACH",
    "ENETUNREACH",
  ])("finds transient code %s through bounded wrapped causes", async (code) => {
    const privateCause = Object.assign(new Error("ada@example.com"), { code });
    const drizzleError = Object.assign(new Error("query failed"), {
      name: "DrizzleQueryError",
      cause: { cause: privateCause },
    });
    const store = makeStore({ loadBatch: vi.fn(async () => { throw drizzleError; }) });
    const log = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const worker = new ArchiveProfileImportWorker({
      store,
      createAiClient: vi.fn(),
      clock: { now: () => now },
    });

    await worker.runOne({ workerId: "worker-1", now });

    expect(store.commitBatch).not.toHaveBeenCalled();
    expect(store.failBatch).toHaveBeenCalledWith({
      ...claim,
      errorCode: "archive_profile_database_unavailable",
      retryable: true,
      now,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("ada@example.com");
  });

  it("finds nested lease loss through a cyclic cause chain without failing another owner", async () => {
    const leaseLost = Object.assign(new Error("private lease"), {
      code: "archive_profile_lease_lost",
    });
    const wrapper = Object.assign(new Error("outer private error"), {
      code: "wrapper_code",
      cause: leaseLost,
    });
    Object.assign(leaseLost, { cause: wrapper });
    const store = makeStore({ commitBatch: vi.fn(async () => { throw wrapper; }) });
    const log = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const worker = new ArchiveProfileImportWorker({
      store,
      createAiClient: vi.fn(),
      clock: { now: () => now },
    });

    await worker.runOne({ workerId: "worker-1", now });

    expect(store.failBatch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "archive_profile_lease_lost" }),
      "Archived profile import step stopped",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("outer private error");
  });

  it("does not inspect causes beyond the bounded traversal depth", async () => {
    let nested: { code: string; cause?: unknown } = { code: "40001" };
    for (let depth = 0; depth < 6; depth += 1) nested = { code: `wrapper_${depth}`, cause: nested };
    const store = makeStore({ commitBatch: vi.fn(async () => { throw nested; }) });
    const worker = new ArchiveProfileImportWorker({
      store,
      createAiClient: vi.fn(),
      clock: { now: () => now },
    });

    await worker.runOne({ workerId: "worker-1", now });

    expect(store.failBatch).toHaveBeenCalledWith({
      ...claim,
      errorCode: "archive_profile_batch_failed",
      retryable: false,
      now,
    });
  });

  it("stops cleanly on lease loss without attempting to fail another owner's batch", async () => {
    const leaseLost = Object.assign(new Error("private lease detail"), {
      code: "archive_profile_lease_lost",
    });
    const store = makeStore({ loadBatch: vi.fn(async () => { throw leaseLost; }) });
    const error = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const worker = new ArchiveProfileImportWorker({
      store,
      createAiClient: vi.fn(),
      clock: { now: () => now },
    });

    await expect(worker.runOne({ workerId: "worker-1", now })).resolves.toEqual({ kind: "progress" });
    expect(store.failBatch).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith({
      jobId: claim.jobId,
      runId: claim.runId,
      phase: claim.phase,
      batchSize: 0,
      errorCode: "archive_profile_lease_lost",
    }, "Archived profile import step stopped");
  });

  it("durably releases a claimed batch after a transient database error using bounded metadata", async () => {
    const databaseError = Object.assign(new Error("ada@example.com must never be logged"), {
      code: "ECONNRESET",
    });
    const store = makeStore({ loadBatch: vi.fn(async () => { throw databaseError; }) });
    const error = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const worker = new ArchiveProfileImportWorker({
      store,
      createAiClient: vi.fn(),
      clock: { now: () => now },
    });

    await expect(worker.runOne({ workerId: "worker-1", now })).resolves.toEqual({ kind: "progress" });
    expect(store.failBatch).toHaveBeenCalledWith({
      ...claim,
      errorCode: "archive_profile_database_unavailable",
      retryable: true,
      now,
    });
    expect(error).toHaveBeenCalledWith({
      jobId: claim.jobId,
      runId: claim.runId,
      phase: claim.phase,
      batchSize: 0,
      errorCode: "archive_profile_database_unavailable",
    }, "Archived profile import step failed");
    expect(JSON.stringify(error.mock.calls)).not.toContain("ada@example.com");
  });

  it("commits an empty claimed phase once so the repository can advance it", async () => {
    const nextStatus = { ...status, phase: "contacts" as const };
    const store = makeStore({
      loadBatch: vi.fn(async () => []),
      commitBatch: vi.fn(async () => ({ status: nextStatus, phaseAdvanced: true })),
    });
    const worker = new ArchiveProfileImportWorker({
      store,
      createAiClient: vi.fn(),
      clock: { now: () => now },
    });

    await expect(worker.runOne({ workerId: "worker-1", now })).resolves.toEqual({ kind: "progress" });
    expect(store.commitBatch).toHaveBeenCalledWith({ ...claim, records: [], now });
  });
});
