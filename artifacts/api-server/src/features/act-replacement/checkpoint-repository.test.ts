import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  actReplacementCheckpoints,
  actReplacementRuns,
} from "@workspace/db/schema";
import {
  DrizzleActReplacementCheckpointRepository,
  manualResumeCheckpointStates,
} from "./checkpoint-repository";

describe("manual Act extraction resume", () => {
  it("does not steal a live leased checkpoint when the owner explicitly resumes", async () => {
    expect(manualResumeCheckpointStates).not.toContain("leased");
    const source = await readFile(
      new URL("./checkpoint-repository.ts", import.meta.url),
      "utf8",
    );
    const resumeMethod = source.slice(
      source.indexOf("  async resumeRun("),
      source.indexOf("  async createRun("),
    );
    expect(resumeMethod).toContain(
      "lte(actReplacementCheckpoints.leaseExpiresAt, input.now)",
    );
  });

  it("locks the run before recovering checkpoints to match archive lock order", async () => {
    const source = await readFile(new URL("./checkpoint-repository.ts", import.meta.url), "utf8");
    const resumeMethod = source.slice(
      source.indexOf("  async resumeRun("),
      source.indexOf("  async createRun("),
    );
    const runLock = resumeMethod.indexOf(".from(actReplacementRuns)");
    const checkpointRecovery = resumeMethod.indexOf(
      ".update(actReplacementCheckpoints)",
    );

    expect(runLock).toBeGreaterThanOrEqual(0);
    expect(runLock).toBeLessThan(checkpointRecovery);
  });
});


describe("Act extraction status polling", () => {
  it("does not enter the checkpoint-locking finalization transaction while work is open", async () => {
    const now = new Date("2026-08-08T15:44:00.000Z");
    const run = {
      id: "11111111-1111-4111-8111-111111111111",
      sourceDatabaseKey: "database-key",
      phase: "extracting",
      previewOnly: true,
      pageSize: 100,
    };
    const checkpoint = {
      id: "22222222-2222-4222-8222-222222222222",
      runId: run.id,
      sourceDatabaseKey: run.sourceDatabaseKey,
      streamType: "company_contact",
      checkpointKind: "relationship",
      partitionKey: "relationship:company:contact",
      requiredness: "optional_capability",
      state: "pending",
      queryMode: "projected",
      errorCode: null,
      retryable: false,
      retryAfter: null,
      updatedAt: now,
      lastSucceededAt: null,
      responseRows: 0,
      observedIdentities: 0,
      archivedIdentities: 0,
      completeIdentities: 0,
      partialIdentities: 0,
      failedIdentities: 0,
      snapshotVersionsInserted: 0,
    };
    let transactionCount = 0;

    const query = (rowsForTable: (table: unknown) => unknown[]) => {
      let rows: unknown[] = [];
      const builder = {
        from(table: unknown) {
          rows = rowsForTable(table);
          return builder;
        },
        where() {
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit() {
          return builder;
        },
        for() {
          return Promise.resolve(rows);
        },
        then<TResult1 = unknown[], TResult2 = never>(
          onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          return Promise.resolve(rows).then(onfulfilled, onrejected);
        },
      };
      return builder;
    };
    const rowsForTable = (table: unknown) => {
      if (table === actReplacementRuns) return [run];
      if (table === actReplacementCheckpoints) return [checkpoint];
      return [];
    };
    const database = {
      select: () => query(rowsForTable),
      async transaction(callback: (transaction: unknown) => Promise<unknown>) {
        transactionCount += 1;
        return callback({ select: () => query(rowsForTable) });
      },
    };
    const repository = new DrizzleActReplacementCheckpointRepository(
      database as never,
    );

    const status = await repository.summarize(run.id);

    expect(status.phase).toBe("extracting");
    expect(status.canResume).toBe(true);
    expect(transactionCount).toBe(0);
  });
});
