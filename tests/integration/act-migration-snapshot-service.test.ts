import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ActApiError } from "@/features/act-sync/act-errors";
import type {
  ActMigrationCheckpoint,
  ActMigrationSnapshotRepository,
  FinalizedSourceSnapshot,
  SnapshotProgress,
} from "@/features/act-migration/snapshot-repository";
import {
  ActMigrationSnapshotService,
} from "@/features/act-migration/snapshot-service";
import type {
  ActMigrationRunStatus,
  ActMigrationStreamType,
  ActPage,
  ActPageRequest,
} from "@/features/act-migration/migration-types";
import type { ActMigrationSourceClient } from "@/features/act-migration/source-client";
import type { StagedSourceItem } from "@/features/act-migration/source-parser";

type ClientMethod = keyof ActMigrationSourceClient;
type QueuedResponse = ActPage | Error;

class FakeSourceClient implements ActMigrationSourceClient {
  readonly requests: Array<{
    method: ClientMethod;
    parentSourceId: string | null;
    request: ActPageRequest;
  }> = [];
  private readonly responses = new Map<ClientMethod, QueuedResponse[]>();

  queue(method: ClientMethod, ...responses: QueuedResponse[]) {
    this.responses.set(method, [
      ...(this.responses.get(method) ?? []),
      ...responses,
    ]);
  }

  listCompanies(request: ActPageRequest) {
    return this.respond("listCompanies", null, request);
  }

  listContacts(request: ActPageRequest) {
    return this.respond("listContacts", null, request);
  }

  listOpportunities(request: ActPageRequest) {
    return this.respond("listOpportunities", null, request);
  }

  listGroups(request: ActPageRequest) {
    return this.respond("listGroups", null, request);
  }

  listCompaniesForContact(parentSourceId: string, request: ActPageRequest) {
    return this.respond("listCompaniesForContact", parentSourceId, request);
  }

  listCompaniesForOpportunity(
    parentSourceId: string,
    request: ActPageRequest,
  ) {
    return this.respond(
      "listCompaniesForOpportunity",
      parentSourceId,
      request,
    );
  }

  listContactsForOpportunity(
    parentSourceId: string,
    request: ActPageRequest,
  ) {
    return this.respond(
      "listContactsForOpportunity",
      parentSourceId,
      request,
    );
  }

  listContactsForGroup(parentSourceId: string, request: ActPageRequest) {
    return this.respond("listContactsForGroup", parentSourceId, request);
  }

  private async respond(
    method: ClientMethod,
    parentSourceId: string | null,
    request: ActPageRequest,
  ) {
    this.requests.push({ method, parentSourceId, request });
    const response = this.responses.get(method)?.shift();
    if (!response) {
      return { items: [], nextSkip: null, queryMode: request.queryMode };
    }
    if (response instanceof Error) throw response;
    return structuredClone(response);
  }
}

type InternalCheckpoint = ActMigrationCheckpoint & {
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
};

class InMemorySnapshotRepository
  implements ActMigrationSnapshotRepository
{
  readonly records: StagedSourceItem[] = [];
  readonly checkpoints: InternalCheckpoint[] = [];
  readonly failures: Array<{
    errorCode: string;
    retryable: boolean;
    retryAfter: Date | null;
  }> = [];
  enqueueCalls = 0;
  enqueueFailureAfterRootCompletion: Error | null = null;
  private runId = randomUUID();
  private status: ActMigrationRunStatus = "snapshotting";

  async createRun() {
    if (this.checkpoints.length === 0) {
      for (const streamType of [
        "company",
        "contact",
        "opportunity",
        "group",
      ] as const) {
        this.addCheckpoint(streamType, "root", null);
      }
    }
    return { id: this.runId, created: true };
  }

  async claimNextCheckpoint(
    runId: string,
    leaseOwner: string,
    now: Date,
  ) {
    const checkpoint = this.checkpoints.find((candidate) =>
      candidate.runId === runId &&
      (
        candidate.status === "pending" ||
        (
          candidate.status === "fetching" &&
          candidate.leaseExpiresAt !== null &&
          candidate.leaseExpiresAt <= now
        ) ||
        (
          candidate.status === "failed" &&
          candidate.retryable &&
          (candidate.retryAfter === null || candidate.retryAfter <= now)
        )
      )
    );
    if (!checkpoint) return null;
    checkpoint.status = "fetching";
    checkpoint.leaseOwner = leaseOwner;
    checkpoint.leaseExpiresAt = new Date(now.getTime() + 5 * 60 * 1_000);
    checkpoint.retryAfter = null;
    return this.publicCheckpoint(checkpoint);
  }

  async storePage(input: {
    checkpointId: string;
    leaseOwner: string;
    expectedSkip: number;
    records: readonly StagedSourceItem[];
    nextSkip: number | null;
    queryMode: ActMigrationCheckpoint["queryMode"];
    now: Date;
  }) {
    const checkpoint = this.checkpoints.find(
      ({ id }) => id === input.checkpointId,
    );
    if (
      !checkpoint ||
      checkpoint.status !== "fetching" ||
      checkpoint.leaseOwner !== input.leaseOwner ||
      checkpoint.nextSkip !== input.expectedSkip
    ) {
      throw new Error("checkpoint lease mismatch");
    }
    for (const record of input.records) {
      if (!this.records.some((stored) =>
        stored.streamType === record.streamType &&
        stored.sourceKey === record.sourceKey
      )) {
        this.records.push(structuredClone(record));
      }
    }
    checkpoint.nextSkip = input.nextSkip ?? input.expectedSkip;
    checkpoint.queryMode = input.queryMode;
    checkpoint.status = input.nextSkip === null ? "complete" : "pending";
    checkpoint.leaseOwner = null;
    checkpoint.leaseExpiresAt = null;
    checkpoint.retryAfter = null;
    checkpoint.retryable = true;
  }

  async failCheckpoint(input: {
    checkpointId: string;
    leaseOwner: string;
    errorCode: string;
    retryable: boolean;
    retryAfter: Date | null;
    now: Date;
  }) {
    const checkpoint = this.checkpoints.find(
      ({ id }) => id === input.checkpointId,
    );
    if (
      !checkpoint ||
      checkpoint.status !== "fetching" ||
      checkpoint.leaseOwner !== input.leaseOwner
    ) {
      throw new Error("checkpoint lease mismatch");
    }
    checkpoint.status = "failed";
    checkpoint.retryable = input.retryable;
    checkpoint.retryAfter = input.retryAfter;
    checkpoint.leaseOwner = null;
    checkpoint.leaseExpiresAt = null;
    this.failures.push({
      errorCode: input.errorCode,
      retryable: input.retryable,
      retryAfter: input.retryAfter,
    });
  }

  async enqueueRelationshipCheckpoints() {
    this.enqueueCalls += 1;
    const roots = this.checkpoints.filter(
      ({ partitionKey }) => partitionKey === "root",
    );
    if (roots.length !== 4 || roots.some(({ status }) => status !== "complete")) {
      return;
    }
    if (this.enqueueFailureAfterRootCompletion) {
      const failure = this.enqueueFailureAfterRootCompletion;
      this.enqueueFailureAfterRootCompletion = null;
      throw failure;
    }
    for (const record of this.records) {
      if (record.errorCode || !record.sourceId) continue;
      if (record.streamType === "contact") {
        this.addCheckpoint(
          "company_contact",
          `contact:${record.sourceId}`,
          record.sourceId,
        );
      } else if (record.streamType === "opportunity") {
        this.addCheckpoint(
          "opportunity_company",
          `opportunity:${record.sourceId}:companies`,
          record.sourceId,
        );
        this.addCheckpoint(
          "opportunity_contact",
          `opportunity:${record.sourceId}:contacts`,
          record.sourceId,
        );
      } else if (record.streamType === "group") {
        this.addCheckpoint(
          "group_contact",
          `group:${record.sourceId}:contacts`,
          record.sourceId,
        );
      }
    }
  }

  async getProgress(runId: string): Promise<SnapshotProgress> {
    const failed = this.checkpoints.filter(({ status }) => status === "failed");
    const retryable = failed.filter((checkpoint) => checkpoint.retryable);
    return {
      runId,
      status: this.status,
      completedCheckpoints: this.checkpoints.filter(
        ({ status }) => status === "complete",
      ).length,
      totalCheckpoints: this.checkpoints.length,
      stagedRecords: this.records.length,
      failedCheckpoints: failed.length,
      retryable: retryable.length > 0,
      retryAfter: retryable
        .map(({ retryAfter }) => retryAfter)
        .filter((value): value is Date => value !== null)
        .sort((left, right) => left.getTime() - right.getTime())[0] ?? null,
      streams: [],
      interruption: failed[0]
        ? {
            code: this.failures.at(-1)?.errorCode === "rate_limited"
              ? "rate_limited"
              : "unknown",
            retryable: failed[0].retryable,
            retryAfter: failed[0].retryAfter,
          }
        : null,
    };
  }

  getLatestProgress() {
    return this.getProgress(this.runId);
  }

  async finalizeSourceSnapshot(): Promise<FinalizedSourceSnapshot> {
    throw new Error("not used by service tests");
  }

  private addCheckpoint(
    streamType: ActMigrationStreamType,
    partitionKey: string,
    parentSourceId: string | null,
  ) {
    if (this.checkpoints.some((checkpoint) =>
      checkpoint.streamType === streamType &&
      checkpoint.partitionKey === partitionKey
    )) {
      return;
    }
    this.checkpoints.push({
      id: randomUUID(),
      runId: this.runId,
      streamType,
      partitionKey,
      parentSourceId,
      nextSkip: 0,
      pageSize: 100,
      queryMode: "projected",
      status: "pending",
      retryAfter: null,
      retryable: true,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  }

  private publicCheckpoint(
    checkpoint: InternalCheckpoint,
  ): ActMigrationCheckpoint {
    return structuredClone({
      id: checkpoint.id,
      runId: checkpoint.runId,
      streamType: checkpoint.streamType,
      partitionKey: checkpoint.partitionKey,
      parentSourceId: checkpoint.parentSourceId,
      nextSkip: checkpoint.nextSkip,
      pageSize: checkpoint.pageSize,
      queryMode: checkpoint.queryMode,
      status: checkpoint.status,
      retryAfter: checkpoint.retryAfter,
      retryable: checkpoint.retryable,
    });
  }
}

function page(
  items: unknown[],
  nextSkip: number | null,
  queryMode: ActPage["queryMode"] = "projected",
): ActPage {
  return { items, nextSkip, queryMode };
}

async function setup() {
  const client = new FakeSourceClient();
  const repository = new InMemorySnapshotRepository();
  const now = new Date("2026-07-30T15:00:00.000Z");
  const service = new ActMigrationSnapshotService(
    client,
    repository,
    () => now,
  );
  const run = await service.start({
    requestKey: randomUUID(),
    sourceDatabaseKey: "act-production-copy",
    requestedBy: "snapshot-test",
  });
  return { client, repository, service, run, now };
}

describe("ActMigrationSnapshotService", () => {
  it("starts a durable run without making a network request", async () => {
    const { client, repository, run } = await setup();

    expect(client.requests).toEqual([]);
    expect(run.id).toBe(repository.checkpoints[0]?.runId);
    expect(run).toMatchObject({
      created: true,
      progress: { runId: run.id, totalCheckpoints: 4 },
    });
  });

  it("returns changed false when no checkpoint is eligible", async () => {
    const { service, run } = await setup();
    await service.captureNext(run.id, { maxRequests: 10 });

    await expect(
      service.captureNext(run.id, { maxRequests: 10 }),
    ).resolves.toMatchObject({ changed: false });
  });

  it("returns a persisted API interruption with changed true", async () => {
    const { client, service, run } = await setup();
    client.queue(
      "listCompanies",
      new ActApiError("rate_limited", true, "2030-01-02T03:04:05.000Z"),
    );

    await expect(
      service.captureNext(run.id, { maxRequests: 10 }),
    ).resolves.toMatchObject({
      changed: true,
      progress: {
        interruption: {
          code: "rate_limited",
          retryable: true,
          retryAfter: new Date("2030-01-02T03:04:05.000Z"),
        },
      },
    });
  });

  it("bounds captureNext to between one and ten requests", async () => {
    const upper = await setup();
    upper.client.queue(
      "listCompanies",
      ...Array.from({ length: 10 }, (_, index) =>
        page([{ id: `company-${index}` }], index + 1)),
    );

    await upper.service.captureNext(upper.run.id, { maxRequests: 99 });
    expect(upper.client.requests).toHaveLength(10);

    const lower = await setup();
    lower.client.queue("listCompanies", page([{ id: "company-1" }], 1));
    await lower.service.captureNext(lower.run.id, { maxRequests: 0 });
    expect(lower.client.requests).toHaveLength(1);
  });

  it("keeps committed pages when a later page fails and resumes at the failed skip", async () => {
    const { client, repository, service, run, now } = await setup();
    client.queue(
      "listCompanies",
      page([{ id: "company-1", name: "First" }], 1),
      new ActApiError(
        "rate_limited",
        true,
        "2026-07-30T15:01:00.000Z",
      ),
      page([{ id: "company-2", name: "Second" }], 2),
    );

    await service.captureNext(run.id, { maxRequests: 2 });

    expect(repository.records.map(({ sourceKey }) => sourceKey)).toEqual([
      "company:company-1",
    ]);
    expect(repository.failures).toEqual([{
      errorCode: "rate_limited",
      retryable: true,
      retryAfter: new Date("2026-07-30T15:01:00.000Z"),
    }]);
    expect(client.requests.map(({ request }) => request.skip)).toEqual([0, 1]);

    now.setMinutes(now.getMinutes() + 2);
    await service.captureNext(run.id, { maxRequests: 1 });
    expect(client.requests.map(({ request }) => request.skip)).toEqual([0, 1, 1]);
    expect(repository.records.map(({ sourceKey }) => sourceKey)).toEqual([
      "company:company-1",
      "company:company-2",
    ]);
  });

  it("honors epoch-seconds rate-limit resets without immediately retrying the failed page", async () => {
    const { client, repository, service, run, now } = await setup();
    now.setTime(new Date("2026-07-27T20:00:00.000Z").getTime());
    client.queue(
      "listCompanies",
      new ActApiError("rate_limited", true, "1785186000"),
    );
    client.queue("listContacts", page([], null));

    await service.captureNext(run.id, { maxRequests: 2 });

    expect(repository.failures).toEqual([{
      errorCode: "rate_limited",
      retryable: true,
      retryAfter: new Date("2026-07-27T21:00:00.000Z"),
    }]);
    expect(client.requests.map(({ method }) => method)).toEqual([
      "listCompanies",
    ]);

    await service.captureNext(run.id, { maxRequests: 1 });

    expect(client.requests.map(({ method }) => method)).toEqual([
      "listCompanies",
      "listContacts",
    ]);
    expect(repository.checkpoints.slice(0, 2)).toEqual([
      expect.objectContaining({
        streamType: "company",
        status: "failed",
        nextSkip: 0,
      }),
      expect.objectContaining({
        streamType: "contact",
        status: "complete",
      }),
    ]);
  });

  it("stops after one retryable API failure and resumes the same page only on a later capture action", async () => {
    const { client, repository, service, run } = await setup();
    client.queue(
      "listCompanies",
      new ActApiError("unavailable", true),
      page([{ id: "company-1" }], 1),
    );

    await service.captureNext(run.id, { maxRequests: 10 });

    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.request.skip).toBe(0);
    expect(repository.checkpoints[0]).toMatchObject({
      streamType: "company",
      status: "failed",
      nextSkip: 0,
      retryable: true,
    });

    await service.captureNext(run.id, { maxRequests: 1 });

    expect(client.requests).toHaveLength(2);
    expect(client.requests[1]?.request.skip).toBe(0);
    expect(repository.records).toEqual([
      expect.objectContaining({ sourceKey: "company:company-1" }),
    ]);
  });

  it.each([
    "authentication_failed",
    "permission_denied",
    "not_configured",
  ] as const)("keeps %s interruptions nonretryable", async (code) => {
    const { client, repository, service, run, now } = await setup();
    client.queue(
      "listCompanies",
      new ActApiError(code, false),
    );

    await service.captureNext(run.id, { maxRequests: 10 });

    expect(client.requests).toHaveLength(1);
    expect(repository.failures).toEqual([{
      errorCode: code,
      retryable: false,
      retryAfter: null,
    }]);
    expect(repository.checkpoints[0]).toMatchObject({
      status: "failed",
      nextSkip: 0,
      retryable: false,
    });

    const fixedClient = new FakeSourceClient();
    const resumedService = new ActMigrationSnapshotService(
      fixedClient,
      repository,
      () => now,
    );
    await resumedService.captureNext(run.id, { maxRequests: 1 });

    expect(fixedClient.requests).toEqual([
      expect.objectContaining({ method: "listContacts" }),
    ]);
    expect(repository.records).toEqual([]);
  });

  it("keeps malformed Act responses nonretryable", async () => {
    const { client, repository, service, run } = await setup();
    client.queue(
      "listCompanies",
      new ActApiError("invalid_response", false),
    );

    await service.captureNext(run.id, { maxRequests: 10 });

    expect(client.requests).toHaveLength(1);
    expect(repository.failures).toEqual([{
      errorCode: "invalid_response",
      retryable: false,
      retryAfter: null,
    }]);
  });

  it("stages deterministic invalid-row errors beside valid rows and continues unrelated checkpoints", async () => {
    const { client, repository, service, run } = await setup();
    client.queue(
      "listCompanies",
      page([
        { id: "company-1", name: "Valid" },
        { name: "Missing id" },
      ], null),
    );
    client.queue("listContacts", page([], null));

    await service.captureNext(run.id, { maxRequests: 2 });

    expect(repository.records).toHaveLength(2);
    expect(repository.records[0]).toMatchObject({
      sourceKey: "company:company-1",
      errorCode: null,
    });
    expect(repository.records[1]).toMatchObject({
      sourceKey: expect.stringMatching(
        /^error:company:occurrence:[a-f0-9]{64}$/,
      ),
      sourceId: null,
      normalizedSnapshot: {},
      errorCode: "missing_source_id",
      errorFields: ["id"],
    });
    expect(client.requests.map(({ method }) => method)).toEqual([
      "listCompanies",
      "listContacts",
    ]);
  });

  it("advances a short page by its real length and completes only on the empty page", async () => {
    const { client, repository, service, run } = await setup();
    client.queue(
      "listCompanies",
      page([{ id: "company-1" }, { id: "company-2" }], 2),
      page([], null),
    );

    await service.captureNext(run.id, { maxRequests: 2 });

    expect(client.requests.map(({ request }) => request.skip)).toEqual([0, 2]);
    expect(repository.checkpoints[0]).toMatchObject({
      nextSkip: 2,
      status: "complete",
    });
  });

  it("runs post-store relationship discovery only when a root checkpoint completes", async () => {
    const { client, repository, service, run } = await setup();
    client.queue(
      "listCompanies",
      page([{ id: "company-1" }], 1),
      page([{ id: "company-2" }], 2),
      page([], null),
    );

    await service.captureNext(run.id, { maxRequests: 2 });

    expect(repository.enqueueCalls).toBe(1);

    await service.captureNext(run.id, { maxRequests: 1 });

    expect(repository.enqueueCalls).toBe(3);
  });

  it("does not rebuild relationship checkpoints after a relationship page", async () => {
    const { client, repository, service, run } = await setup();
    client.queue("listContacts", page([{ id: "contact-1" }], null));
    await service.captureNext(run.id, { maxRequests: 4 });
    const enqueueCallsAfterRoots = repository.enqueueCalls;

    client.queue("listCompaniesForContact", page([], null));
    await service.captureNext(run.id, { maxRequests: 1 });

    expect(repository.enqueueCalls).toBe(enqueueCallsAfterRoots + 1);
  });

  it("does not request the network again after every checkpoint completes", async () => {
    const { client, service, run } = await setup();

    await service.captureNext(run.id, { maxRequests: 10 });
    const requestsAfterCompletion = client.requests.length;
    await service.captureNext(run.id, { maxRequests: 10 });

    expect(requestsAfterCompletion).toBe(4);
    expect(client.requests).toHaveLength(4);
  });

  it("repairs relationship checkpoints on resume after enqueue fails following the last root commit", async () => {
    const { client, repository, service, run } = await setup();
    client.queue("listGroups", page([{ id: "group-1" }], null));
    client.queue("listContactsForGroup", page([], null));

    await service.captureNext(run.id, { maxRequests: 3 });
    repository.enqueueFailureAfterRootCompletion = new Error(
      "enqueue interrupted",
    );
    await expect(
      service.captureNext(run.id, { maxRequests: 1 }),
    ).rejects.toThrow("enqueue interrupted");

    expect(repository.checkpoints).toHaveLength(4);
    expect(repository.checkpoints.every(
      ({ status }) => status === "complete",
    )).toBe(true);
    expect(repository.records).toEqual([
      expect.objectContaining({
        streamType: "group",
        sourceId: "group-1",
      }),
    ]);

    const requestsBeforeResume = client.requests.length;
    await service.captureNext(run.id, { maxRequests: 1 });

    expect(client.requests).toHaveLength(requestsBeforeResume + 1);
    expect(client.requests.at(-1)).toMatchObject({
      method: "listContactsForGroup",
      parentSourceId: "group-1",
    });
    expect(repository.checkpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        streamType: "group_contact",
        partitionKey: "group:group-1:contacts",
        parentSourceId: "group-1",
        status: "complete",
      }),
    ]));
  });

  it("starts relationship requests only after all roots complete and preserves semantic relationship ids", async () => {
    const { client, repository, service, run } = await setup();
    client.queue("listCompanies", page([{ id: "company-1" }], null));
    client.queue("listContacts", page([{ id: "contact-1" }], null));
    client.queue(
      "listOpportunities",
      page([{ id: "opportunity-1" }], null),
    );
    client.queue("listGroups", page([{ id: "group-1" }], null));
    client.queue(
      "listCompaniesForContact",
      page([{ id: "company-1" }], null),
    );
    client.queue(
      "listCompaniesForOpportunity",
      page([{ id: "company-1" }], null),
    );
    client.queue(
      "listContactsForOpportunity",
      page([{ id: "contact-1" }], null),
    );
    client.queue(
      "listContactsForGroup",
      page([{ id: "contact-1" }], null),
    );

    await service.captureNext(run.id, { maxRequests: 3 });
    expect(client.requests.map(({ method }) => method)).toEqual([
      "listCompanies",
      "listContacts",
      "listOpportunities",
    ]);
    expect(repository.checkpoints).toHaveLength(4);

    await service.captureNext(run.id, { maxRequests: 5 });
    expect(client.requests.slice(3).map(({ method }) => method)).toEqual([
      "listGroups",
      "listCompaniesForContact",
      "listCompaniesForOpportunity",
      "listContactsForOpportunity",
      "listContactsForGroup",
    ]);
    expect(repository.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        streamType: "company_contact",
        sourceId: "company-1",
        targetSourceId: "contact-1",
      }),
      expect.objectContaining({
        streamType: "opportunity_company",
        sourceId: "opportunity-1",
        targetSourceId: "company-1",
      }),
      expect.objectContaining({
        streamType: "opportunity_contact",
        sourceId: "opportunity-1",
        targetSourceId: "contact-1",
      }),
      expect.objectContaining({
        streamType: "group_contact",
        sourceId: "group-1",
        targetSourceId: "contact-1",
      }),
    ]));
  });

  it("keeps every malformed relationship occurrence attributable and idempotent across page replay", async () => {
    const { client, repository, service, run } = await setup();
    client.queue("listCompanies", page([], null));
    client.queue("listContacts", page([], null));
    client.queue("listOpportunities", page([], null));
    client.queue(
      "listGroups",
      page([{ id: "group-1" }, { id: "group-2" }], null),
    );
    await service.captureNext(run.id, { maxRequests: 4 });

    client.queue("listContactsForGroup", page([null, null], null));
    client.queue("listContactsForGroup", page([null], null));
    await service.captureNext(run.id, { maxRequests: 2 });

    const firstCapture = repository.records.filter(
      ({ streamType }) => streamType === "group_contact",
    );
    expect(firstCapture).toHaveLength(3);
    expect(firstCapture.map(({ sourceId, targetSourceId }) => ({
      sourceId,
      targetSourceId,
    }))).toEqual([
      { sourceId: "group-1", targetSourceId: null },
      { sourceId: "group-1", targetSourceId: null },
      { sourceId: "group-2", targetSourceId: null },
    ]);
    expect(new Set(firstCapture.map(({ sourceKey }) => sourceKey)).size).toBe(3);
    expect(firstCapture.every(
      ({ sourceKey }) => /^error:group_contact:occurrence:[a-f0-9]{64}$/.test(sourceKey),
    )).toBe(true);

    for (const checkpoint of repository.checkpoints) {
      if (checkpoint.streamType === "group_contact") {
        checkpoint.status = "pending";
        checkpoint.nextSkip = 0;
      }
    }
    client.queue("listContactsForGroup", page([null, null], null));
    client.queue("listContactsForGroup", page([null], null));
    await service.captureNext(run.id, { maxRequests: 2 });

    expect(repository.records.filter(
      ({ streamType }) => streamType === "group_contact",
    )).toEqual(firstCapture);
  });
});
