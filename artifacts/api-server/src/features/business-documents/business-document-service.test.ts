import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://postgres:postgres@127.0.0.1:5432/test";
});

import { BusinessDocumentService } from "./business-document-service";

describe("BusinessDocumentService", () => {
  it("opens an available current version with a 900-second signed URL", async () => {
    const repository = { getOpenableFile: vi.fn(async () => ({ storageKey: "business-documents/aa/hash" })) };
    const storage = { signedReadUrl: vi.fn(async () => "https://signed.example/file") };
    const service = new BusinessDocumentService({ repository: repository as any, storage: storage as any });

    await expect(service.open("11111111-1111-4111-8111-111111111111")).resolves.toBe("https://signed.example/file");
    expect(storage.signedReadUrl).toHaveBeenCalledWith("business-documents/aa/hash", 900);
  });

  it("reports a missing or quarantined file without generating a URL", async () => {
    const storage = { signedReadUrl: vi.fn() };
    const service = new BusinessDocumentService({ repository: { getOpenableFile: vi.fn(async () => null) } as any, storage: storage as any });
    await expect(service.open("11111111-1111-4111-8111-111111111111")).rejects.toThrow("BUSINESS_DOCUMENT_FILE_UNAVAILABLE");
    expect(storage.signedReadUrl).not.toHaveBeenCalled();
  });

  it("unlinks without deleting or archiving the document", async () => {
    const repository = {
      removeLink: vi.fn(async () => true),
      archive: vi.fn(),
      softDelete: vi.fn(),
    };
    const service = new BusinessDocumentService({ repository: repository as any, storage: {} as any });
    await expect(service.unlink("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "owner")).resolves.toBe(true);
    expect(repository.archive).not.toHaveBeenCalled();
    expect(repository.softDelete).not.toHaveBeenCalled();
  });

  it("delegates review actions atomically to the repository", async () => {
    const repository = { actOnReview: vi.fn(async () => true) };
    const service = new BusinessDocumentService({ repository: repository as any, storage: {} as any });
    await expect(service.reviewAction("review-1", { action: "approve" }, "owner")).resolves.toEqual({ ok: true });
    expect(repository.actOnReview).toHaveBeenCalledWith("review-1", { action: "approve" }, "owner");
  });
});
