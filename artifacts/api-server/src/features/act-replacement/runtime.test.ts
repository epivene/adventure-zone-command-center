import { describe, expect, it, vi } from "vitest";

import { ActClient } from "@/features/act-sync/act-client";
import type { ActConfig } from "@/features/act-sync/act-types";
import type { ActReplacementCheckpointRepository } from "./checkpoint-repository";
import { ActExtractionWorker } from "./extraction-worker";
import {
  createActExtractionClientAdapter,
  createActExtractionLoopPool,
  createActServerShutdown,
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
