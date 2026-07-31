import { describe, expect, it, vi } from "vitest";

import { ActMigrationPreviewService } from "@/features/act-migration/preview-service";
import { sourceSnapshotDigest } from "@/features/act-migration/snapshot-repository";
import { parseSourceItem, type StagedSourceItem } from "@/features/act-migration/source-parser";

function company(id: string, name: string, address: Record<string, unknown>): StagedSourceItem {
  const parsed = parseSourceItem("company", { id, name, address });
  if (!parsed.ok) throw new Error("Expected a valid company fixture.");
  return {
    streamType: "company",
    sourceKey: parsed.sourceKey,
    sourceId: parsed.sourceId,
    targetSourceId: null,
    rawSnapshot: parsed.rawSnapshot,
    normalizedSnapshot: parsed.normalized as Record<string, unknown>,
    fingerprint: parsed.fingerprint,
    errorCode: null,
    errorFields: [],
  };
}

describe("ActMigrationPreviewService", () => {
  it("consolidates exact duplicate places under the lexically stable source ID with provenance", async () => {
    const records = [
      company("B-PLACE", "Example Fair, Inc.", { line1: "123 Main St.", city: "Denver", state: "CO" }),
      company("A-PLACE", " example fair inc ", { line1: "123 Main St", city: "Denver", state: "CO" }),
      company("OTHER", "Example Fair Inc", { line1: "123 Main St", city: "Austin", state: "TX" }),
    ];
    const source = {
      runId: "run-1",
      sourceDigest: sourceSnapshotDigest(records),
      checkpoints: [],
      records,
    };
    const previews = {
      getPreviewIfStored: vi.fn().mockResolvedValue(null),
      storeProposalsIfAbsent: vi.fn().mockResolvedValue({ changed: true }),
      getPreview: vi.fn().mockResolvedValue({ runId: "run-1", rows: [], total: 2 }),
    };
    const service = new ActMigrationPreviewService(
      { finalizeSourceSnapshot: vi.fn().mockResolvedValue(source) } as never,
      { loadCandidateSnapshot: vi.fn().mockResolvedValue({ places: [], people: [], bookings: [], placePeople: [], bookingPeople: [], externalLinks: [] }) } as never,
      previews as never,
    );

    await service.finalizePreview("run-1");

    const proposals = previews.storeProposalsIfAbsent.mock.calls[0]?.[0].proposals;
    expect(proposals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        proposalKey: "organization:company:A-PLACE",
        duplicateGroupKey: '["example fair inc","123 main st denver co"]',
        duplicateSourceIds: ["A-PLACE", "B-PLACE"],
        sourceRecordKeys: ["company:A-PLACE", "company:B-PLACE"],
      }),
    ]));
    expect(proposals).toHaveLength(2);
  });

  it("does not consolidate places whose locations normalize to empty", async () => {
    const records = [
      company("A-PLACE", "Example Fair", { line1: "---" }),
      company("B-PLACE", "Example Fair", { line1: "..." }),
    ];
    const source = {
      runId: "run-1",
      sourceDigest: sourceSnapshotDigest(records),
      checkpoints: [],
      records,
    };
    const previews = {
      getPreviewIfStored: vi.fn().mockResolvedValue(null),
      storeProposalsIfAbsent: vi.fn().mockResolvedValue({ changed: true }),
      getPreview: vi.fn().mockResolvedValue({ runId: "run-1", rows: [], total: 2 }),
    };
    const service = new ActMigrationPreviewService(
      { finalizeSourceSnapshot: vi.fn().mockResolvedValue(source) } as never,
      { loadCandidateSnapshot: vi.fn().mockResolvedValue({ places: [], people: [], bookings: [], placePeople: [], bookingPeople: [], externalLinks: [] }) } as never,
      previews as never,
    );

    await service.finalizePreview("run-1");

    const proposals = previews.storeProposalsIfAbsent.mock.calls[0]?.[0].proposals;
    expect(proposals).toHaveLength(2);
    expect(proposals).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ duplicateGroupKey: expect.any(String) }),
    ]));
  });
});
