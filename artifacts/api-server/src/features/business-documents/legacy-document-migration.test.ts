import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://postgres:postgres@127.0.0.1:5432/test";
});

import { LegacyDocumentMigration, legacyDocumentSourceNames, type LegacyDocumentCandidate } from "./legacy-document-migration";

function candidate(sourceName: LegacyDocumentCandidate["sourceName"], index: number): LegacyDocumentCandidate {
  return {
    cursor: `${sourceName}:${index}`,
    sourceName,
    sourceKind: sourceName === "design_certificate" ? "business_source" : sourceName,
    sourceAccountKey: "legacy",
    externalId: `${sourceName}-${index}`,
    displayName: `${sourceName} file`,
    filename: `${sourceName}.pdf`,
    mimeType: "application/pdf",
    storageKey: `legacy/${sourceName}`,
    sha256Hex: String(index).padStart(64, "a").slice(-64),
    sizeBytes: 12,
    category: sourceName === "design_certificate" ? "coi" : "other",
    reviewState: "accepted",
    profileIds: index < 3 ? ["profile-1"] : [],
    bookingIds: [],
    metadata: {},
  };
}

describe("LegacyDocumentMigration", () => {
  it("maps all legacy sources and preserves links", async () => {
    const seen = new Set<string>();
    const inputs: any[] = [];
    const migration = new LegacyDocumentMigration({
      reader: { discover: async () => legacyDocumentSourceNames.map(candidate) },
      storage: { get: vi.fn(), putIfAbsent: vi.fn() },
      repository: { ingest: async (input) => {
        inputs.push(input);
        const duplicate = seen.has(input.source.externalId);
        seen.add(input.source.externalId);
        return { outcome: duplicate ? "deduplicated" : "imported", documentId: input.source.externalId, versionId: "version", blobId: "blob", reviewState: input.reviewState, linkedProfileIds: input.links.filter((link) => link.targetKind === "profile").map((link) => link.targetId), linkedBookingIds: [], linkedEventFamilyIds: [] };
      } },
    });

    const report = await migration.migrate({ dryRun: false, batchSize: 50, afterId: null });

    expect(report.bySource).toEqual({ business_source: 1, google_profile_file: 1, design_asset: 1, design_output: 1, design_certificate: 1 });
    expect(inputs.flatMap((input) => input.links)).toHaveLength(3);
    expect(report.imported).toBe(5);
  });

  it("is idempotent on rerun", async () => {
    const seen = new Set<string>();
    const repository = { ingest: vi.fn(async (input: any): Promise<any> => {
      const duplicate = seen.has(input.source.externalId);
      seen.add(input.source.externalId);
      return { outcome: duplicate ? "deduplicated" : "imported", documentId: input.source.externalId, versionId: "version", blobId: "blob", reviewState: input.reviewState, linkedProfileIds: [], linkedBookingIds: [], linkedEventFamilyIds: [] };
    }) };
    const migration = new LegacyDocumentMigration({
      reader: { discover: async () => legacyDocumentSourceNames.map(candidate) },
      storage: { get: vi.fn(), putIfAbsent: vi.fn() },
      repository,
    });
    await migration.migrate({ dryRun: false, batchSize: 50, afterId: null });
    const second = await migration.migrate({ dryRun: false, batchSize: 50, afterId: null });
    expect(second.imported).toBe(0);
    expect(second.deduplicated).toBe(5);
  });

  it("previews without reading or writing object bytes", async () => {
    const storage = { get: vi.fn(), putIfAbsent: vi.fn() };
    const repository = { ingest: vi.fn() };
    const migration = new LegacyDocumentMigration({ reader: { discover: async () => [candidate("business_source", 1)] }, storage, repository });
    const report = await migration.migrate({ dryRun: true, batchSize: 50, afterId: null });
    expect(report).toMatchObject({ dryRun: true, discovered: 1, imported: 0 });
    expect(storage.get).not.toHaveBeenCalled();
    expect(repository.ingest).not.toHaveBeenCalled();
  });
});
