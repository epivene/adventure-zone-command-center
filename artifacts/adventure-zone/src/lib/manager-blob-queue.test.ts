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

  it("preserves image kind so receipt, incident, and checklist uploads cannot be mixed", async () => {
    const store = new MemoryManagerBlobStore();
    await queueManagerBlob({ id: "receipt-1", legId: "leg-a", receiptId: "receipt-1", kind: "receipt", blob: new Blob(["receipt"]), createdAt: "1" }, store);
    await queueManagerBlob({ id: "incident-1", legId: "leg-a", receiptId: "incident-1", kind: "incident", blob: new Blob(["incident"]), createdAt: "2" }, store);
    await queueManagerBlob({ id: "checklist-1", legId: "leg-a", receiptId: "checklist-1", kind: "checklist_attachment", bookingId: "booking-1", blob: new Blob(["checklist"]), createdAt: "3" }, store);
    expect((await store.list()).map((row) => row.kind)).toEqual(["receipt", "incident", "checklist_attachment"]);
  });

  it("persists booking context for checklist attachment upload after reload", async () => {
    const store = new MemoryManagerBlobStore();
    await queueManagerBlob({ id: "checklist-1", legId: "leg-a", receiptId: "checklist-1", kind: "checklist_attachment", bookingId: "booking-123", blob: new Blob(["checklist"]), createdAt: "1" }, store);
    expect((await store.list())[0]).toMatchObject({
      kind: "checklist_attachment",
      bookingId: "booking-123",
      receiptId: "checklist-1",
    });
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
