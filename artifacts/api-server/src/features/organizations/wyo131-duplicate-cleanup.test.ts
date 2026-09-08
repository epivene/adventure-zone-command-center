import { describe, expect, it } from "vitest";

import {
  WYO131_DUPLICATE_GROUP,
  applyWyo131DuplicateCleanup,
  type Wyo131DuplicateMergeOutcome,
  type Wyo131DuplicateRepository,
} from "./wyo131-duplicate-cleanup";

class FakeRepository implements Wyo131DuplicateRepository {
  readonly calls: Array<typeof WYO131_DUPLICATE_GROUP> = [];

  constructor(private readonly outcome: Wyo131DuplicateMergeOutcome) {}

  async mergeExactGroup(
    group: typeof WYO131_DUPLICATE_GROUP,
  ): Promise<Wyo131DuplicateMergeOutcome> {
    this.calls.push(group);
    return this.outcome;
  }
}

describe("applyWyo131DuplicateCleanup", () => {
  it("merges only the reviewed Lander WYO131 duplicate into the profile with the contact and booking", async () => {
    const repository = new FakeRepository("merged");

    const result = await applyWyo131DuplicateCleanup(repository);

    expect(repository.calls).toEqual([WYO131_DUPLICATE_GROUP]);
    expect(WYO131_DUPLICATE_GROUP).toEqual({
      survivorName: "WYO-131 Biketoberfest Gravel Race",
      duplicateName: "WYO131 Gravel Race, The (Lander) ) WY",
      city: "Lander",
      region: "WY",
      websiteHost: "wyo131.com",
    });
    expect(result).toEqual({ outcome: "merged" });
  });

  it.each(["already_merged", "unsafe"] as const)(
    "is repeat-safe and reports %s without forcing a merge",
    async (outcome) => {
      const result = await applyWyo131DuplicateCleanup(
        new FakeRepository(outcome),
      );

      expect(result).toEqual({ outcome });
    },
  );
});
