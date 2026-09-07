import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??=
    "postgres://postgres:postgres@127.0.0.1:5432/test";
});

import { BusinessDocumentIngestion } from "./business-document-ingestion";

const bytes = new Uint8Array([1, 2, 3]);
const source = {
  sourceKind: "gmail" as const,
  sourceAccountKey: "workspace",
  externalId: "message-1:attachment-1",
  originalUrl: "https://mail.google.com/thread/1",
  metadata: {},
};

describe("BusinessDocumentIngestion", () => {
  it("auto-files an approved profile-thread COI", async () => {
    const repository = { ingest: vi.fn(async (input) => ({ outcome: "imported" as const, documentId: "doc-1", versionId: "version-1", blobId: "blob-1", reviewState: input.reviewState, linkedProfileIds: input.links.map((link: any) => link.targetId), linkedBookingIds: [], linkedEventFamilyIds: [] })) };
    const ingestion = new BusinessDocumentIngestion({
      storage: { putIfAbsent: vi.fn(async () => ({ sha256Hex: "a".repeat(64), storageKey: "business-documents/aa/hash", mimeType: "application/pdf", sizeBytes: 3 })) },
      repository,
    });

    const outcome = await ingestion.ingest({
      bytes,
      filename: "COI 24-25 - City of Victor.pdf",
      mimeType: "application/pdf",
      subject: "Certificate for City of Victor",
      bodyText: "Attached is your certificate.",
      source,
      evidence: { approvedThreadProfileId: "profile-1", exactEmailProfileIds: [], exactEventMatches: [], fuzzyNameMatches: [] },
      actor: "owner",
    });

    expect(outcome).toMatchObject({ reviewState: "accepted", linkedProfileIds: ["profile-1"] });
    expect(repository.ingest).toHaveBeenCalledWith(expect.objectContaining({ category: "coi", reviewState: "accepted" }));
  });

  it("returns a skipped outcome before storage for a temporary file", async () => {
    const storage = { putIfAbsent: vi.fn() };
    const ingestion = new BusinessDocumentIngestion({ storage, repository: { ingest: vi.fn() } });
    await expect(ingestion.ingest({ bytes, filename: "desktop.ini", mimeType: "application/octet-stream", subject: "", bodyText: "", source, evidence: { approvedThreadProfileId: null, exactEmailProfileIds: [], exactEventMatches: [], fuzzyNameMatches: [] }, actor: "owner" })).resolves.toEqual({ outcome: "skipped", errorCode: "business_document_temporary_file" });
    expect(storage.putIfAbsent).not.toHaveBeenCalled();
  });
});
