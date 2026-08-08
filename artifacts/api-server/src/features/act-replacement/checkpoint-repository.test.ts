import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { manualResumeCheckpointStates } from "./checkpoint-repository";

describe("manual Act extraction resume", () => {
  it("requeues every leased checkpoint when the owner explicitly resumes", () => {
    expect(manualResumeCheckpointStates).toContain("leased");
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
