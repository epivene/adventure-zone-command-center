import { describe, expect, it } from "vitest";

import {
  filterGroupsContainingResolvedProfiles,
  type DuplicateReviewGroupLike,
} from "./duplicate-review-resolution-filter";

const group = (ids: string[]): DuplicateReviewGroupLike => ({
  candidateIds: ids,
  organizations: ids.map((id) => ({ id })),
});

describe("filterGroupsContainingResolvedProfiles", () => {
  it("keeps an unresolved duplicate group", () => {
    expect(filterGroupsContainingResolvedProfiles([group(["a", "b"])], new Set())).toHaveLength(1);
  });

  it("hides a group when one profile is already resolved", () => {
    expect(filterGroupsContainingResolvedProfiles(
      [group(["a", "b", "c"])],
      new Set(["c"]),
    )).toEqual([]);
  });

  it("does not mutate the original group list", () => {
    const groups = [group(["a", "b"])];
    filterGroupsContainingResolvedProfiles(groups, new Set(["a"]));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.candidateIds).toEqual(["a", "b"]);
  });
});
