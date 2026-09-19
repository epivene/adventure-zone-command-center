import { describe, expect, it, vi } from "vitest";

import { clearManagerPrivateData, flushManagerMutationQueue, MemoryManagerMutationStore, queueManagerMutation } from "./manager-sync-queue";

function mutation(id: string, legId = "leg-a", createdAt = "2026-08-15T10:00:00.000Z") {
  return { id, legId, method: "POST", path: "/manager/issues", body: { clientMutationId: id }, createdAt };
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
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
    await flushManagerMutationQueue(vi.fn(async () => { throw conflict("conflict"); }), store);
    expect((await store.list())[0]?.state).toBe("needs_attention");
  });

  it("marks permanent attraction conflicts for review and continues later work", async () => {
    const store = new MemoryManagerMutationStore();
    const base = { legId: "leg-1", method: "POST", body: {}, createdAt: "2026-09-19T00:00:00.000Z" };
    await queueManagerMutation({ ...base, id: "moved", path: "/discovered/moved" }, store);
    await queueManagerMutation({ ...base, id: "duplicate", path: "/discovered/duplicate", createdAt: "2026-09-19T00:00:01.000Z" }, store);
    await queueManagerMutation({ ...base, id: "later", path: "/entries/later", createdAt: "2026-09-19T00:00:02.000Z" }, store);
    const managerApi = vi.fn(async (path: string) => {
      if (path.includes("moved")) throw conflict("Attraction moved to another leg");
      if (path.includes("duplicate")) throw conflict("Attraction code is already in use");
      return {};
    });

    const rows = await flushManagerMutationQueue(managerApi, store);

    expect(rows.map(({ id, state }) => ({ id, state }))).toEqual([
      { id: "moved", state: "needs_attention" },
      { id: "duplicate", state: "needs_attention" },
      { id: "later", state: "synced" },
    ]);
    expect(managerApi).toHaveBeenCalledTimes(3);
  });

  it("purges private queued data for only the signed-out leg", async () => {
    const store = new MemoryManagerMutationStore();
    await queueManagerMutation(mutation("a", "leg-a"), store);
    await queueManagerMutation(mutation("b", "leg-b"), store);
    await clearManagerPrivateData("leg-a", store);
    expect((await store.list()).map((row) => row.legId)).toEqual(["leg-b"]);
  });
});
