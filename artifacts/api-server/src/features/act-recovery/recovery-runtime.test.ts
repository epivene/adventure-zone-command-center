import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { createActArchiveRecoveryLoop } from "@/features/act-replacement/runtime";

describe("ACT archive recovery runtime", () => {
  it("starts and drains the local archive recovery loop with its own worker identity", async () => {
    const scheduled: Array<() => void> = [];
    const cancelled: unknown[] = [];
    const workerIds: string[] = [];
    const runtime = createActArchiveRecoveryLoop({
      worker: {
        async runOne(input) {
          workerIds.push(input.workerId);
          return { kind: "idle" as const };
        },
      },
      clock: { now: () => new Date("2026-08-16T14:00:00.000Z") },
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
    expect(workerIds[0]).toMatch(/^act-archive-recovery-\d+-[0-9a-f-]{36}$/);
    await vi.waitFor(() => expect(scheduled).toHaveLength(1));

    await runtime.close();
    expect(cancelled).toHaveLength(1);
  });

  it("composes the production archive runtime from profile import plus full recovery", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../act-replacement/runtime.ts", import.meta.url)),
      "utf8",
    );

    expect(source).toContain("DrizzleActArchiveRecoveryRepository");
    expect(source).toContain("ActArchiveRecoveryWorker");
    expect(source).toContain("createActArchiveRecoveryLoop");
    expect(source).toContain("archiveProfileImportLoop.start()");
    expect(source).toContain("archiveRecoveryLoop.start()");
    expect(source).toContain("archiveRecoveryLoop.close()");
  });
});
