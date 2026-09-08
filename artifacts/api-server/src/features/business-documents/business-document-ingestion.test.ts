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

  it("does not let manual metadata bypass temporary-file safety", async () => {
    const storage = { putIfAbsent: vi.fn() };
    const repository = { ingest: vi.fn() };
    const ingestion = new BusinessDocumentIngestion({ storage, repository });

    await expect(ingestion.ingest({
      bytes,
      filename: "desktop.ini",
      mimeType: "application/octet-stream",
      subject: "",
      bodyText: "",
      source: { ...source, sourceKind: "manual", externalId: "manual-temp" },
      evidence: { approvedThreadProfileId: null, exactEmailProfileIds: [], exactEventMatches: [], fuzzyNameMatches: [] },
      actor: "boss:dave",
      uploadMetadata: { displayName: "Contract", category: "contract" },
    })).resolves.toEqual({ outcome: "skipped", errorCode: "business_document_temporary_file" });

    expect(storage.putIfAbsent).not.toHaveBeenCalled();
    expect(repository.ingest).not.toHaveBeenCalled();
  });

  it("reuses a previously copied blob without writing storage again", async () => {
    const storedBlob = { sha256Hex: "b".repeat(64), storageKey: "profile-files/b", mimeType: "application/pdf", sizeBytes: 3 };
    const storage = { putIfAbsent: vi.fn() };
    const repository = { ingest: vi.fn(async (input: any) => ({ outcome: "deduplicated" as const, documentId: "doc-1", versionId: "version-1", blobId: "blob-1", reviewState: input.reviewState, linkedProfileIds: [], linkedBookingIds: [], linkedEventFamilyIds: [] })) };
    const ingestion = new BusinessDocumentIngestion({ storage, repository });
    await expect(ingestion.ingest({ storedBlob, filename: "COI.pdf", mimeType: "application/pdf", subject: "COI", bodyText: "", source, evidence: { approvedThreadProfileId: "profile-1", exactEmailProfileIds: [], exactEventMatches: [], fuzzyNameMatches: [] }, actor: "owner" })).resolves.toMatchObject({ outcome: "deduplicated" });
    expect(storage.putIfAbsent).not.toHaveBeenCalled();
    expect(repository.ingest).toHaveBeenCalledWith(expect.objectContaining({ blob: storedBlob }));
  });

  it("applies user-supplied upload metadata in the repository transaction", async () => {
    const repository = { ingest: vi.fn(async (input: any) => ({ outcome: "imported" as const, documentId: "doc-1", versionId: "version-1", blobId: "blob-1", reviewState: input.reviewState, linkedProfileIds: [], linkedBookingIds: [], linkedEventFamilyIds: [] })) };
    const ingestion = new BusinessDocumentIngestion({
      storage: { putIfAbsent: vi.fn(async () => ({ sha256Hex: "c".repeat(64), storageKey: "business-documents/cc/hash", mimeType: "application/pdf", sizeBytes: 3 })) },
      repository,
    });

    await ingestion.ingest({
      bytes,
      filename: "raw-file.pdf",
      mimeType: "application/pdf",
      subject: "raw-file.pdf",
      bodyText: "",
      source: { ...source, sourceKind: "manual", externalId: "manual-1" },
      evidence: { approvedThreadProfileId: null, exactEmailProfileIds: [], exactEventMatches: [], fuzzyNameMatches: [] },
      actor: "boss:dave",
      uploadMetadata: { displayName: "County Fair Agreement", category: "contract" },
    });

    expect(repository.ingest).toHaveBeenCalledWith(expect.objectContaining({
      displayName: "County Fair Agreement",
      category: "contract",
      reviewState: "accepted",
      preserveMetadataOnDuplicate: true,
    }));
  });

});
