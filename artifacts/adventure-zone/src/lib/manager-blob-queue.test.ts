// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { MemoryManagerBlobStore, queueManagerBlob, flushManagerBlobQueue } from "./manager-blob-queue";

describe("manager blob queue", () => {
  it("keeps failed receipt images for retry", async () => {
    const store = new MemoryManagerBlobStore();
    await queueManagerBlob({ id: "r1", legId: "leg-a", receiptId: "r1", kind: "receipt", blob: new Blob(["x"]), createdAt: "1" }, store);
    await flushManagerBlobQueue(vi.fn(async () => { throw new Error("offline"); }), store);
    expect((await store.list())[0]?.state).toBe("image_failed");
  });

  it("preserves image kind so receipt and incident uploads cannot be mixed", async () => {
    const store = new MemoryManagerBlobStore();
    await queueManagerBlob({ id: "receipt-1", legId: "leg-a", receiptId: "receipt-1", kind: "receipt", blob: new Blob(["receipt"]), createdAt: "1" }, store);
    await queueManagerBlob({ id: "incident-1", legId: "leg-a", receiptId: "incident-1", kind: "incident", blob: new Blob(["incident"]), createdAt: "2" }, store);
    expect((await store.list()).map((row) => row.kind)).toEqual(["receipt", "incident"]);
  });

  it("allows a flush to process only one image kind", async () => {
    const store = new MemoryManagerBlobStore();
    await queueManagerBlob({ id: "receipt-1", legId: "leg-a", receiptId: "receipt-1", kind: "receipt", blob: new Blob(["receipt"]), createdAt: "1" }, store);
    await queueManagerBlob({ id: "incident-1", legId: "leg-a", receiptId: "incident-1", kind: "incident", blob: new Blob(["incident"]), createdAt: "2" }, store);
    const upload = vi.fn(async () => undefined);
    await flushManagerBlobQueue(upload, store, async (row) => row.kind === "incident");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]?.[0].id).toBe("incident-1");
    const rows = await store.list();
    expect(rows.find((row) => row.id === "receipt-1")?.state).toBe("image_pending");
    expect(rows.find((row) => row.id === "incident-1")?.state).toBe("image_uploaded");
  });

  it("purges only signed out leg", async () => {
    const store = new MemoryManagerBlobStore();
    await queueManagerBlob({ id: "a", legId: "a", receiptId: "a", kind: "receipt", blob: new Blob(["a"]), createdAt: "1" }, store);
    await queueManagerBlob({ id: "b", legId: "b", receiptId: "b", kind: "incident", blob: new Blob(["b"]), createdAt: "2" }, store);
    await store.clearLeg("a");
    expect((await store.list()).map((row) => row.legId)).toEqual(["b"]);
  });
});
