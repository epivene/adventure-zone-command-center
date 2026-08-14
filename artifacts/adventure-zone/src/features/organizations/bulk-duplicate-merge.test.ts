import { describe, expect, it, vi } from "vitest";
import {
  BulkDuplicateMergeError,
  mergeDuplicateGroups,
  type MergeRequest,
} from "./bulk-duplicate-merge";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const groups = [
  {
    normalizedName: "alpha",
    classification: "duplicate" as const,
    organizations: [{ id: "primary-a" }, { id: "duplicate-a" }],
  },
  {
    normalizedName: "bravo",
    classification: "duplicate" as const,
    organizations: [{ id: "primary-b" }, { id: "duplicate-b" }],
  },
];

describe("mergeDuplicateGroups", () => {
  it("merges groups sequentially and reports progress", async () => {
    const first = deferred();
    const second = deferred();
    const merge = vi
      .fn<(request: MergeRequest) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const onProgress = vi.fn();

    const run = mergeDuplicateGroups(
      groups,
      { alpha: "primary-a", bravo: "primary-b" },
      merge,
      onProgress,
    );

    expect(merge).toHaveBeenCalledTimes(1);
    expect(merge).toHaveBeenNthCalledWith(1, {
      primaryId: "primary-a",
      duplicateIds: ["duplicate-a"],
    });

    first.resolve();
    await Promise.resolve();

    expect(merge).toHaveBeenCalledTimes(2);
    expect(merge).toHaveBeenNthCalledWith(2, {
      primaryId: "primary-b",
      duplicateIds: ["duplicate-b"],
    });

    second.resolve();
    await run;

    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { completed: 1, total: 2, groupName: "alpha" },
      { completed: 2, total: 2, groupName: "bravo" },
    ]);
  });

  it("stops at the first failure and reports resumable progress", async () => {
    const merge = vi
      .fn<(request: MergeRequest) => Promise<void>>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("offline"));
    const thirdGroup = {
      normalizedName: "charlie",
      classification: "duplicate" as const,
      organizations: [{ id: "primary-c" }, { id: "duplicate-c" }],
    };

    await expect(
      mergeDuplicateGroups(
        [...groups, thirdGroup],
        { alpha: "primary-a", bravo: "primary-b", charlie: "primary-c" },
        merge,
        vi.fn(),
      ),
    ).rejects.toMatchObject({
      name: "BulkDuplicateMergeError",
      groupName: "bravo",
      completed: 1,
      total: 3,
      cause: expect.objectContaining({ message: "offline" }),
    } satisfies Partial<BulkDuplicateMergeError>);

    expect(merge).toHaveBeenCalledTimes(2);
  });

  it("skips location candidates and counts progress only for eligible duplicate groups", async () => {
    const locationCandidate = {
      normalizedName: "lantern festival",
      classification: "location_candidate" as const,
      organizations: [
        { id: "lantern-a" },
        { id: "lantern-b" },
      ],
    };
    const merge = vi.fn<(request: MergeRequest) => Promise<void>>().mockResolvedValue();
    const onProgress = vi.fn();

    await mergeDuplicateGroups(
      [groups[0]!, locationCandidate],
      { alpha: "primary-a", "lantern festival": "lantern-a" },
      merge,
      onProgress,
    );

    expect(merge).toHaveBeenCalledTimes(1);
    expect(merge).toHaveBeenCalledWith({
      primaryId: "primary-a",
      duplicateIds: ["duplicate-a"],
    });
    expect(onProgress).toHaveBeenCalledWith({
      completed: 1,
      total: 1,
      groupName: "alpha",
    });
  });
});
