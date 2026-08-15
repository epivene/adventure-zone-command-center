import { describe, expect, it, vi } from "vitest";

import { ActClient } from "@/features/act-sync/act-client";
import type { ActConfig } from "@/features/act-sync/act-types";
import type { ActReplacementCheckpointRepository } from "./checkpoint-repository";
import { ActExtractionWorker } from "./extraction-worker";
import {
  createArchiveProfileImportLoop,
  createActExtractionRuntime,
  createActExtractionClientAdapter,
  createActExtractionLoopPool,
  createActServerShutdown,
  actExtractionWorkerConcurrency,
} from "./runtime";

const actConfig: ActConfig = {
  baseUrl: "https://apius.act.com/act.web.api",
  databaseName: "private-database",
  username: "private-user",
  password: "private-password",
};

describe("Act extraction server shutdown", () => {
  it("closes worker, drains server, then closes the shared pool exactly once", async () => {
    const events: string[] = [];
    const shutdown = createActServerShutdown({
      async closeRuntime() {
        events.push("runtime");
      },
      async closeServer() {
        events.push("server");
      },
      async closePool() {
        events.push("pool");
      },
      onError(stage) {
        events.push(`error:${stage}`);
      },
    });

    await Promise.all([shutdown(), shutdown(), shutdown()]);

    expect(events).toEqual(["runtime", "server", "pool"]);
  });

  it("continues every shutdown phase after errors without rejecting", async () => {
    const events: string[] = [];
    const shutdown = createActServerShutdown({
      async closeRuntime() {
        events.push("runtime");
        throw new Error("runtime secret");
      },
      async closeServer() {
        events.push("server");
        throw new Error("server secret");
      },
      async closePool() {
        events.push("pool");
        throw new Error("pool secret");
      },
      onError(stage) {
        events.push(`error:${stage}`);
      },
    });

    await expect(shutdown()).resolves.toBeUndefined();
    expect(events).toEqual([
      "runtime",
      "error:runtime",
      "server",
      "error:server",
      "pool",
      "error:pool",
    ]);
  });
});

describe("Act extraction runtime composition", () => {
  it.each(["unconfigured", "configured"] as const)(
    "starts and closes exactly one archive loop when ACT is %s",
    async (mode) => {
      const events: string[] = [];
      const archive = {
        start: vi.fn(() => events.push("archive:start")),
        close: vi.fn(async () => { events.push("archive:close"); }),
      };
      const extraction = {
        start: vi.fn(() => events.push("extraction:start")),
        close: vi.fn(async () => { events.push("extraction:close"); }),
      };
      const createConfiguredRuntime = vi.fn(async () => extraction);
      const runtime = await createActExtractionRuntime({
        getEnvironment: () => mode === "configured"
          ? { configured: true, config: actConfig }
          : { configured: false },
        createArchiveRuntime: vi.fn(async () => archive),
        createConfiguredRuntime,
      });

      runtime.start();
      await runtime.close();

      expect(archive.start).toHaveBeenCalledTimes(1);
      expect(archive.close).toHaveBeenCalledTimes(1);
      expect(createConfiguredRuntime).toHaveBeenCalledTimes(mode === "configured" ? 1 : 0);
      if (mode === "unconfigured") {
        expect(events).toEqual(["archive:start", "archive:close"]);
      } else {
        expect(events).toEqual([
          "extraction:start",
          "archive:start",
          "archive:close",
          "extraction:close",
        ]);
      }
    },
  );

  it("keeps archive-only processing available when ACT credentials are partial", async () => {
    const archive = { start: vi.fn(), close: vi.fn(async () => undefined) };
    const createConfiguredRuntime = vi.fn();
    const runtime = await createActExtractionRuntime({
      getEnvironment: () => { throw new Error("private ACT password validation detail"); },
      createArchiveRuntime: vi.fn(async () => archive),
      createConfiguredRuntime,
    });

    runtime.start();
    await runtime.close();

    expect(archive.start).toHaveBeenCalledTimes(1);
    expect(archive.close).toHaveBeenCalledTimes(1);
    expect(createConfiguredRuntime).not.toHaveBeenCalled();
  });

  it("starts and closes exactly one archived-profile loop with a unique worker ID", async () => {
    const scheduled: Array<() => void> = [];
    const cancelled: unknown[] = [];
    const workerIds: string[] = [];
    const runtime = createArchiveProfileImportLoop({
      store: {
        createOrGetJob: vi.fn(),
        getStatus: vi.fn(),
        async claimNext(input) {
          workerIds.push(input.workerId);
          return null;
        },
        loadBatch: vi.fn(),
        commitBatch: vi.fn(),
        failBatch: vi.fn(),
      },
      createAiClient: vi.fn(),
      clock: { now: () => new Date("2026-08-14T12:00:00.000Z") },
      scheduler: {
        schedule(task) {
          scheduled.push(task);
          return task;
        },
        cancel(handle) {
          cancelled.push(handle);
        },
      },
    });

    runtime.start();
    runtime.start();
    expect(scheduled).toHaveLength(1);

    scheduled.shift()!();
    await vi.waitFor(() => expect(workerIds).toHaveLength(1));
    expect(workerIds[0]).toMatch(/^act-archive-profile-import-\d+-[0-9a-f-]{36}$/);
    await vi.waitFor(() => expect(scheduled).toHaveLength(1));

    await runtime.close();
    expect(cancelled).toHaveLength(1);
  });

  it("starts and drains every extraction loop in the bounded pool", async () => {
    const events: string[] = [];
    const pool = createActExtractionLoopPool({
      concurrency: 4,
      createLoop(index) {
        return {
          start() {
            events.push(`start:${index}`);
          },
          async close() {
            events.push(`close:${index}`);
          },
        };
      },
    });

    pool.start();
    await pool.close();

    expect(events).toEqual([
      "start:0",
      "start:1",
      "start:2",
      "start:3",
      "close:0",
      "close:1",
      "close:2",
      "close:3",
    ]);
  });

  it("extraction pool concurrency is 1 so Render's 256 MB instance cannot OOM from duplicate workers", () => {
    // Regression: concurrency was 4, causing 4 identical polling loops per process
    // on the small Render instance, leading to JavaScript heap out of memory.
    // Changing it back to > 1 will fail this test as an early warning.
    expect(actExtractionWorkerConcurrency).toBe(1);
  });

  it("extraction loop pool cannot double-start workers when start() is called twice", () => {
    const starts: number[] = [];
    const pool = createActExtractionLoopPool({
      concurrency: 1,
      createLoop(index) {
        return {
          start() { starts.push(index); },
          async close() {},
        };
      },
    });

    pool.start();
    pool.start(); // second call must be a no-op at the loop level
    expect(starts).toHaveLength(1);
    expect(starts[0]).toBe(0);
  });

  it("single-flights authorization shared by concurrent extraction loops", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const authorize = vi.fn(() => pending);
    const adapter = createActExtractionClientAdapter({
      authorize,
      hasValidAuthorization: () => false,
      getJsonAuthorized: vi.fn(),
      rateLimit: { limit: null, remaining: null, reset: null },
    });

    const first = adapter.authorization.authorize();
    const second = adapter.authorization.authorize();
    expect(authorize).toHaveBeenCalledTimes(1);

    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it("runs cold authorization and warm data as separate one-fetch worker steps", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "private-token" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "company-1" }]), { status: 200 }),
      );
    const client = new ActClient(actConfig, { fetcher });
    const adapter = createActExtractionClientAdapter(client);
    const checkpoint = {
      id: "checkpoint-1",
      runId: "run-1",
      sourceDatabaseKey: "database-a",
      leaseOwner: "worker-a",
      attemptCount: 1,
      streamType: "company" as const,
      checkpointKind: "list" as const,
      partitionKey: "root:company",
      requiredness: "required" as const,
      parentSourceRecordId: null,
      parentActRecordId: null,
      sourceRecordId: null,
      nextSkip: 0,
      pageSize: 100,
      queryMode: "projected" as const,
      deriveDetails: true,
    };
    const auditPaths: string[] = [];
    const archived: unknown[] = [];
    const releases: unknown[] = [];
    const worker = new ActExtractionWorker({
      checkpoints: {
        claimNext: async () => checkpoint,
        releaseForAuthorization: async (input: unknown) => {
          releases.push(input);
        },
      } as unknown as ActReplacementCheckpointRepository,
      audits: {
        begin: async (input) => {
          auditPaths.push(input.pathTemplate);
          return { auditId: `audit-${auditPaths.length}` };
        },
        finish: async () => {},
      },
      source: adapter.source,
      authorization: adapter.authorization,
      archive: {
        archiveCheckpointPage: async (input) => {
          archived.push(input);
          return {
            responseRows: 1,
            observedIdentities: 1,
            archivedIdentities: 1,
            completeIdentities: 0,
            partialIdentities: 0,
            failedIdentities: 0,
            snapshotVersionsInserted: 1,
          };
        },
      },
      clock: { now: () => new Date("2026-08-04T12:00:00.025Z") },
    });

    await worker.runOne({
      workerId: "worker-a",
      now: new Date("2026-08-04T12:00:00.000Z"),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/authorize");
    expect(auditPaths).toEqual(["/authorize"]);
    expect(releases).toHaveLength(1);
    expect(archived).toHaveLength(0);

    await worker.runOne({
      workerId: "worker-a",
      now: new Date("2026-08-04T12:00:01.000Z"),
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("/api/companies");
    expect(auditPaths).toEqual(["/authorize", "/api/companies"]);
    expect(archived).toHaveLength(1);
  });

  it("audits a cold authorization failure and performs no data fetch", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("rejected", { status: 401 }));
    const adapter = createActExtractionClientAdapter(
      new ActClient(actConfig, { fetcher }),
    );
    const checkpointActions: string[] = [];
    const auditPaths: string[] = [];
    const auditStates: string[] = [];
    const worker = new ActExtractionWorker({
      checkpoints: {
        claimNext: async () => ({
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
        }),
        markFailed: async () => {
          checkpointActions.push("failed");
        },
      } as unknown as ActReplacementCheckpointRepository,
      audits: {
        begin: async (input) => {
          auditPaths.push(input.pathTemplate);
          return { auditId: "audit-1" };
        },
        finish: async (input) => {
          auditStates.push(`${input.state}:${input.safeErrorCode}`);
        },
      },
      source: adapter.source,
      authorization: adapter.authorization,
      archive: {
        archiveCheckpointPage: async () => {
          throw new Error("data archive must not run");
        },
      },
      clock: { now: () => new Date("2026-08-04T12:00:00.025Z") },
    });

    await worker.runOne({
      workerId: "worker-a",
      now: new Date("2026-08-04T12:00:00.000Z"),
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/authorize");
    expect(auditPaths).toEqual(["/authorize"]);
    expect(auditStates).toEqual(["failed:authentication_failed"]);
    expect(checkpointActions).toEqual(["failed"]);
  });
});
