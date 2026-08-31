import { describe, expect, it } from "vitest";

import {
  BLANK_PROFILE_BATCH_01_MERGES,
  BLANK_PROFILE_BATCH_01_RENAMES,
  applyBlankProfileBatch01,
  type BlankProfileBatch01Merge,
  type BlankProfileBatch01MergeOutcome,
  type BlankProfileBatch01Rename,
  type BlankProfileBatch01RenameOutcome,
  type BlankProfileBatch01Repository,
} from "./blank-profile-batch-01";

class FakeRepository implements BlankProfileBatch01Repository {
  readonly calls: Array<{ kind: "merge" | "rename"; id: string }> = [];

  constructor(
    private readonly mergeOutcomes = new Map<string, BlankProfileBatch01MergeOutcome>(),
    private readonly renameOutcomes = new Map<string, BlankProfileBatch01RenameOutcome>(),
  ) {}

  async merge(input: BlankProfileBatch01Merge): Promise<BlankProfileBatch01MergeOutcome> {
    this.calls.push({ kind: "merge", id: input.duplicateId });
    return this.mergeOutcomes.get(input.duplicateId) ?? "merged";
  }

  async rename(input: BlankProfileBatch01Rename): Promise<BlankProfileBatch01RenameOutcome> {
    this.calls.push({ kind: "rename", id: input.id });
    return this.renameOutcomes.get(input.id) ?? "renamed";
  }
}

describe("applyBlankProfileBatch01", () => {
  it("runs the two reviewed duplicate merges before renaming all 25 surviving profiles", async () => {
    const repository = new FakeRepository();

    const result = await applyBlankProfileBatch01(repository);

    expect(BLANK_PROFILE_BATCH_01_MERGES).toHaveLength(2);
    expect(BLANK_PROFILE_BATCH_01_RENAMES).toHaveLength(25);
    expect(repository.calls.slice(0, 2)).toEqual(
      BLANK_PROFILE_BATCH_01_MERGES.map((merge) => ({
        kind: "merge",
        id: merge.duplicateId,
      })),
    );
    expect(repository.calls.slice(2)).toEqual(
      BLANK_PROFILE_BATCH_01_RENAMES.map((rename) => ({
        kind: "rename",
        id: rename.id,
      })),
    );
    expect(result.merged).toEqual(
      BLANK_PROFILE_BATCH_01_MERGES.map((merge) => merge.duplicateId),
    );
    expect(result.renamed).toEqual(
      BLANK_PROFILE_BATCH_01_RENAMES.map((rename) => rename.id),
    );
    expect(result.skipped).toEqual([]);
  });

  it("does not rename a survivor when its reviewed merge becomes unsafe", async () => {
    const blockedMerge = BLANK_PROFILE_BATCH_01_MERGES[0]!;
    const repository = new FakeRepository(
      new Map([[blockedMerge.duplicateId, "unsafe"]]),
    );

    const result = await applyBlankProfileBatch01(repository);

    expect(repository.calls).not.toContainEqual({
      kind: "rename",
      id: blockedMerge.survivorId,
    });
    expect(result.skipped).toContainEqual({
      id: blockedMerge.duplicateId,
      operation: "merge",
      reason: "unsafe",
    });
    expect(result.skipped).toContainEqual({
      id: blockedMerge.survivorId,
      operation: "rename",
      reason: "merge_not_applied",
    });
  });

  it("is repeat-safe for already merged and already renamed records", async () => {
    const repository = new FakeRepository(
      new Map(BLANK_PROFILE_BATCH_01_MERGES.map((merge) => [
        merge.duplicateId,
        "already_merged" as const,
      ])),
      new Map(BLANK_PROFILE_BATCH_01_RENAMES.map((rename) => [
        rename.id,
        "already_current" as const,
      ])),
    );

    const result = await applyBlankProfileBatch01(repository);

    expect(result.merged).toEqual([]);
    expect(result.alreadyMerged).toEqual(
      BLANK_PROFILE_BATCH_01_MERGES.map((merge) => merge.duplicateId),
    );
    expect(result.renamed).toEqual([]);
    expect(result.alreadyCurrent).toEqual(
      BLANK_PROFILE_BATCH_01_RENAMES.map((rename) => rename.id),
    );
    expect(result.skipped).toEqual([]);
  });
});
