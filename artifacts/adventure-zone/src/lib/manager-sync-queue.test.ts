import { describe, expect, it, vi } from "vitest";
import { clearManagerPrivateData, flushManagerMutationQueue, MemoryManagerMutationStore, queueManagerMutation } from "./manager-sync-queue";

function mutation(id: string, legId = "leg-a", createdAt = "2026-08-15T10:00:00.000Z") {
  return { id, legId, method: "POST", path: "/manager/issues", body: { clientMutationId: id }, createdAt };
}

describe("manager sync queue", () => {
  it("deduplicates a stable mutation id", async () => {
    const store = new MemoryManagerMutationStore();
    await queueManagerMutation(mutation("m1"), store);
    await queueManagerMutation(mutation("m1"), store);
    expect(await store.list()).toHaveLength(1);
  });

  it("syncs FIFO while preserving the client mutation id", async () => {
    const store = new MemoryManagerMutationStore();
    await queueManagerMutation(mutation("m2", "leg-a", "2026-08-15T10:01:00.000Z"), store);
    await queueManagerMutation(mutation("m1", "leg-a", "2026-08-15T10:00:00.000Z"), store);
    const sent: string[] = [];
    const api = vi.fn(async (_path: string, options?: RequestInit) => {
      sent.push(JSON.parse(String(options?.body)).clientMutationId);
      return {};
    });
    await flushManagerMutationQueue(api, store);
    expect(sent).toEqual(["m1", "m2"]);
    expect((await store.list()).map((row) => row.state)).toEqual(["synced", "synced"]);
  });

  it("retries the same id after an offline failure", async () => {
    const store = new MemoryManagerMutationStore();
    await queueManagerMutation(mutation("m1"), store);
    await flushManagerMutationQueue(vi.fn(async () => { throw new TypeError("offline"); }), store);
    expect((await store.list())[0]?.state).toBe("saved_offline");
    const api = vi.fn(async () => ({}));
    await flushManagerMutationQueue(api, store);
    expect(api).toHaveBeenCalledTimes(1);
    expect((await store.list())[0]?.body).toEqual({ clientMutationId: "m1" });
  });

  it("marks 409 conflicts as needs attention", async () => {
    const store = new MemoryManagerMutationStore();
    await queueManagerMutation(mutation("m1"), store);
    const error = Object.assign(new Error("conflict"), { status: 409 });
    await flushManagerMutationQueue(vi.fn(async () => { throw error; }), store);
    expect((await store.list())[0]?.state).toBe("needs_attention");
  });

  it("purges private queued data for only the signed-out leg", async () => {
    const store = new MemoryManagerMutationStore();
    await queueManagerMutation(mutation("a", "leg-a"), store);
    await queueManagerMutation(mutation("b", "leg-b"), store);
    await clearManagerPrivateData("leg-a", store);
    expect((await store.list()).map((row) => row.legId)).toEqual(["leg-b"]);
  });
});
