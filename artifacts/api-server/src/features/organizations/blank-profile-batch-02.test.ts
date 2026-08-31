import { describe, expect, it } from "vitest";

import {
  BLANK_PROFILE_BATCH_02_RENAMES,
  applyBlankProfileBatch02,
  type BlankProfileBatch02Rename,
  type BlankProfileBatch02RenameOutcome,
  type BlankProfileBatch02Repository,
} from "./blank-profile-batch-02";

class FakeRepository implements BlankProfileBatch02Repository {
  readonly calls: string[] = [];

  constructor(
    private readonly outcomes = new Map<string, BlankProfileBatch02RenameOutcome>(),
  ) {}

  async rename(input: BlankProfileBatch02Rename): Promise<BlankProfileBatch02RenameOutcome> {
    this.calls.push(input.id);
    return this.outcomes.get(input.id) ?? "renamed";
  }
}

describe("applyBlankProfileBatch02", () => {
  it("runs every reviewed identity correction exactly once", async () => {
    const repository = new FakeRepository();

    const result = await applyBlankProfileBatch02(repository);

    expect(BLANK_PROFILE_BATCH_02_RENAMES).toHaveLength(16);
    expect(new Set(BLANK_PROFILE_BATCH_02_RENAMES.map((entry) => entry.id)).size)
      .toBe(BLANK_PROFILE_BATCH_02_RENAMES.length);
    expect(repository.calls).toEqual(
      BLANK_PROFILE_BATCH_02_RENAMES.map((entry) => entry.id),
    );
    expect(result.renamed).toEqual(
      BLANK_PROFILE_BATCH_02_RENAMES.map((entry) => entry.id),
    );
    expect(result.alreadyCurrent).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("is repeat-safe for names already corrected", async () => {
    const repository = new FakeRepository(new Map(
      BLANK_PROFILE_BATCH_02_RENAMES.map((entry) => [
        entry.id,
        "already_current" as const,
      ]),
    ));

    const result = await applyBlankProfileBatch02(repository);

    expect(result.renamed).toEqual([]);
    expect(result.alreadyCurrent).toEqual(
      BLANK_PROFILE_BATCH_02_RENAMES.map((entry) => entry.id),
    );
    expect(result.skipped).toEqual([]);
  });

  it("surfaces missing and unsafe profiles without blocking the rest of the batch", async () => {
    const [missing, unsafe, safe] = BLANK_PROFILE_BATCH_02_RENAMES;
    const repository = new FakeRepository(new Map([
      [missing.id, "missing"],
      [unsafe.id, "unsafe"],
    ]));

    const result = await applyBlankProfileBatch02(repository);

    expect(result.skipped).toEqual([
      { id: missing.id, reason: "missing" },
      { id: unsafe.id, reason: "unsafe" },
    ]);
    expect(result.renamed).toContain(safe.id);
  });

  it("pins each rename to the exact reviewed ACT record and allows only old or target names", () => {
    for (const entry of BLANK_PROFILE_BATCH_02_RENAMES) {
      expect(entry.requiredActRecordId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(entry.expectedNames).toContain(entry.targetName);
      expect(entry.expectedNames.length).toBeGreaterThanOrEqual(2);
    }
  });
});
