import { describe, expect, it } from "vitest";
import { ActOrganizerWorker, InMemoryActOrganizerStore } from "./organizer-worker";

describe("ActOrganizerWorker", () => {
  it("single-flights work and returns progress", async () => {
    let calls = 0;
    const worker = new ActOrganizerWorker({ organizeOne: async () => { calls++; return { kind: "progress", runId: "r", sourceRecordId: "s" }; } });
    await expect(worker.runOne({ workerId: "w", now: new Date() })).resolves.toEqual({ kind: "progress", runId: "r", sourceRecordId: "s" });
    expect(calls).toBe(1);
  });
  it("does not suppress the same source identity in a new run/version", async () => {
    const source = { sourceRecordId: "s", sourceVersionId: "v", streamType: "company", normalized: { kind: "organization" as const, name: "A" } };
    const store = new InMemoryActOrganizerStore([{ runId: "r1", source }, { runId: "r2", source: { ...source, sourceVersionId: "v2" } }]);
    expect((await store.claimOne({ workerId: "a", now: new Date() }))?.runId).toBe("r1");
    expect((await store.claimOne({ workerId: "b", now: new Date() }))?.runId).toBe("r2");
  });
  it("replays manifest persistence idempotently after a crash boundary", async () => {
    const store = new InMemoryActOrganizerStore([]);
    const manifest = { operations: [], outcomes: [], diagnostics: [], digest: "d" } as never;
    await store.saveManifest("r", manifest); await store.saveManifest("r", manifest);
    expect(store.manifests.get("r")).toBe(manifest);
  });
});
