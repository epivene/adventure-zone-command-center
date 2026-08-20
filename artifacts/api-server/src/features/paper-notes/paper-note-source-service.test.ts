import { describe, expect, it, vi } from "vitest";

import {
  PaperNoteSourceError,
  PaperNoteSourceService,
} from "./paper-note-source-service";

const source = {
  batchId: "10000000-0000-4000-8000-000000000001",
  pageId: "20000000-0000-4000-8000-000000000001",
  originalObjectKey: "paper-notes/private/original",
  analysisObjectKey: "paper-notes/private/analysis",
};

describe("PaperNoteSourceService", () => {
  it("returns a 15-minute signed URL only after the private source exists", async () => {
    const resolver = { resolvePage: vi.fn(async () => source), resolveEntry: vi.fn() };
    const storage = {
      exists: vi.fn(async () => true),
      signedReadUrl: vi.fn(async () => "https://signed.example/source"),
    };
    const service = new PaperNoteSourceService(resolver, storage);

    await expect(service.pageUrl("owner", source.batchId, source.pageId, "original"))
      .resolves.toEqual({ url: "https://signed.example/source", kind: "original" });
    expect(storage.exists).toHaveBeenCalledWith(source.originalObjectKey);
    expect(storage.signedReadUrl).toHaveBeenCalledWith(source.originalObjectKey, 900);
  });

  it("fails closed when the source object is missing", async () => {
    const resolver = { resolvePage: vi.fn(async () => source), resolveEntry: vi.fn() };
    const service = new PaperNoteSourceService(resolver, {
      exists: vi.fn(async () => false),
      signedReadUrl: vi.fn(),
    });

    await expect(service.pageUrl("owner", source.batchId, source.pageId, "original"))
      .rejects.toMatchObject({ code: "SOURCE_MISSING" } satisfies Partial<PaperNoteSourceError>);
  });

  it("never falls back to another owner's page", async () => {
    const resolver = { resolvePage: vi.fn(async () => null), resolveEntry: vi.fn() };
    const service = new PaperNoteSourceService(resolver, {
      exists: vi.fn(),
      signedReadUrl: vi.fn(),
    });

    await expect(service.pageUrl("different-owner", source.batchId, source.pageId, "original"))
      .rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" } satisfies Partial<PaperNoteSourceError>);
  });
});
