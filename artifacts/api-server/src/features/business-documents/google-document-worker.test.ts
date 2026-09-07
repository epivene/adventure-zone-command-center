import { describe, expect, it, vi } from "vitest";
import { GoogleDocumentWorker, type GoogleDocumentCursor } from "./google-document-worker";

function item(messageId: string, attachmentId: string, internalDateMs: number) {
  return { messageId, attachmentId, internalDateMs } as any;
}

describe("GoogleDocumentWorker", () => {
  it("does not process the same Gmail attachment twice", async () => {
    const processed = new Set<string>();
    let cursor: GoogleDocumentCursor | null = null;
    const ingest = vi.fn().mockResolvedValue({ outcome: "imported", documentId: "document-1", reviewState: "accepted", linkedProfileIds: [], linkedBookingIds: [], linkedEventFamilyIds: [] });
    const source = {
      async *inventoryIncrementalGmail() { yield item("m1", "a1", 100); },
      candidate: vi.fn(async () => ({} as any)),
    };
    const worker = new GoogleDocumentWorker({
      connection: { createReadClient: vi.fn().mockResolvedValue({}) },
      sourceFactory: () => source as any,
      ingestion: { ingest },
      state: {
        loadCursor: async () => cursor,
        startRun: async () => "run-1",
        hasProcessed: async (_accountKey, id) => processed.has(id),
        checkpoint: async ({ externalId, status }) => { if (status !== "retry") processed.add(externalId); },
        finishRun: async ({ cursor: next }) => { cursor = next; },
      },
      accountKey: "workspace",
    });

    const first = await worker.runOnce(new Date(200));
    cursor = { internalDateMs: 0, messageId: "" };
    const second = await worker.runOnce(new Date(200));
    expect(first.discovered).toBe(1);
    expect(second.discovered).toBe(0);
    expect(ingest).toHaveBeenCalledOnce();
  });

  it("skips safely when Workspace is disconnected", async () => {
    const worker = new GoogleDocumentWorker({
      connection: { createReadClient: vi.fn().mockResolvedValue(null) },
      sourceFactory: vi.fn() as any,
      ingestion: { ingest: vi.fn() },
      state: {} as any,
      accountKey: "workspace",
    });
    await expect(worker.runOnce(new Date())).resolves.toMatchObject({ connected: false, discovered: 0 });
  });

  it("retries transient failures and promotes repeated failure to review", async () => {
    const checkpoint = vi.fn().mockResolvedValue(undefined);
    const source = { async *inventoryIncrementalGmail() { yield item("m1", "a1", 100); }, candidate: vi.fn(async () => ({} as any)) };
    const worker = new GoogleDocumentWorker({
      connection: { createReadClient: vi.fn().mockResolvedValue({}) }, sourceFactory: () => source as any,
      ingestion: { ingest: vi.fn().mockRejectedValue(new Error("temporary")) }, accountKey: "workspace",
      state: { loadCursor: async () => null, startRun: async () => "run-1", hasProcessed: async () => false, checkpoint, finishRun: vi.fn() },
    });
    const result = await worker.runOnce(new Date(200));
    expect(source.candidate).toHaveBeenCalledTimes(3);
    expect(result.review).toBe(1);
    expect(checkpoint).toHaveBeenLastCalledWith(expect.objectContaining({ status: "review", errorCode: "temporary" }));
  });
});
