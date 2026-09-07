import { describe, expect, it, vi } from "vitest";
vi.hoisted(() => { process.env.DATABASE_URL ??= "postgres://postgres:postgres@127.0.0.1:5432/test"; });
import { BusinessDocumentImportService } from "./business-document-import-service";

const files = Array.from({ length: 7 }, (_, index) => ({ id: `file-${index}`, name: `File ${index}.pdf`, mimeType: "application/pdf", modifiedTime: null, size: 10, parents: ["contracts"], webViewLink: null, rootFolderId: "contracts" }));

function setup() {
  const store = { create: vi.fn(async () => "run-1"), checkpoint: vi.fn(async () => undefined), finish: vi.fn(async () => undefined), get: vi.fn() };
  const source = { inventory: vi.fn(async () => files), candidate: vi.fn(async (file: any) => ({ file })) };
  const ingestion = { ingest: vi.fn(async () => ({ outcome: "imported", documentId: "doc", versionId: "v", blobId: "b", reviewState: "accepted", linkedProfileIds: [], linkedBookingIds: [], linkedEventFamilyIds: [] })) };
  return { service: new BusinessDocumentImportService({ source: source as any, store, ingestion: ingestion as any, accountKey: "workspace" }), source, store, ingestion };
}

describe("BusinessDocumentImportService", () => {
  it("previews candidates without downloading bytes", async () => {
    const { service, source, store } = setup();
    await expect(service.preview(["contracts"], "owner")).resolves.toMatchObject({ discovered: 7, imported: 0 });
    expect(source.candidate).not.toHaveBeenCalled();
    expect(store.checkpoint).toHaveBeenCalledTimes(7);
  });

  it("requires a bounded pilot and checkpoints every file", async () => {
    const { service, source, ingestion } = setup();
    await expect(service.start(["contracts"], "owner", 2)).resolves.toMatchObject({ discovered: 2, imported: 2 });
    expect(source.candidate).toHaveBeenCalledTimes(2);
    expect(ingestion.ingest).toHaveBeenCalledTimes(2);
  });

  it("previews Gmail metadata without materializing attachments", async () => {
    const { source, store, ingestion } = setup();
    const gmailSource = {
      inventoryHistoricalGmail: async function* () { yield { messageId: "m1", attachmentId: "a1" }; },
      candidate: vi.fn(),
    };
    const service = new BusinessDocumentImportService({ source: source as any, gmailSource: gmailSource as any, store, ingestion: ingestion as any, accountKey: "workspace" });
    await expect(service.previewGmail({ after: "2025-01-01", before: "2026-01-01" }, "owner")).resolves.toMatchObject({ discovered: 1 });
    expect(gmailSource.candidate).not.toHaveBeenCalled();
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({ sourceKind: "gmail", mode: "preview", scope: { after: "2025-01-01", before: "2026-01-01" } }));
  });
});
