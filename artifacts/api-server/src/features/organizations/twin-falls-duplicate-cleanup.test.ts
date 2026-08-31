import { describe, expect, it } from "vitest";

import {
  TWIN_FALLS_APPLICATION_NOTE,
  TWIN_FALLS_DUPLICATE_GROUPS,
  applyTwinFallsDuplicateCleanup,
  type TwinFallsDuplicateGroup,
  type TwinFallsDuplicateMergeOutcome,
  type TwinFallsDuplicateRepository,
  type TwinFallsNoteOutcome,
} from "./twin-falls-duplicate-cleanup";

class FakeRepository implements TwinFallsDuplicateRepository {
  readonly mergeCalls: TwinFallsDuplicateGroup[] = [];
  readonly noteCalls: Array<{
    organizationId: string;
    subject: string;
    body: string;
  }> = [];

  constructor(
    private readonly mergeOutcomes = new Map<string, TwinFallsDuplicateMergeOutcome>(),
    private readonly noteOutcome: TwinFallsNoteOutcome = "created",
  ) {}

  async mergeGroup(
    group: TwinFallsDuplicateGroup,
  ): Promise<TwinFallsDuplicateMergeOutcome> {
    this.mergeCalls.push(group);
    return this.mergeOutcomes.get(group.survivorId) ?? "merged";
  }

  async ensureNote(input: {
    organizationId: string;
    subject: string;
    body: string;
  }): Promise<TwinFallsNoteOutcome> {
    this.noteCalls.push(input);
    return this.noteOutcome;
  }
}

describe("applyTwinFallsDuplicateCleanup", () => {
  it("merges the two exact reviewed duplicate groups and adds the application note", async () => {
    const repository = new FakeRepository();

    const result = await applyTwinFallsDuplicateCleanup(repository);

    expect(TWIN_FALLS_DUPLICATE_GROUPS).toHaveLength(2);
    expect(repository.mergeCalls).toEqual(TWIN_FALLS_DUPLICATE_GROUPS);
    expect(result.merged).toEqual([
      "7e746d1b-a5dd-4c54-8b5e-fce8697f5af2",
      "0498cac2-4c90-46ab-a214-5c9dcf0775d1",
      "aab7b545-d065-441b-98c0-bef04f78f034",
    ]);
    expect(result.alreadyMerged).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.note).toBe("created");
    expect(repository.noteCalls).toEqual([TWIN_FALLS_APPLICATION_NOTE]);
  });

  it("is repeat-safe when the duplicates are already gone and the note already exists", async () => {
    const repository = new FakeRepository(
      new Map(
        TWIN_FALLS_DUPLICATE_GROUPS.map((group) => [
          group.survivorId,
          "already_merged" as const,
        ]),
      ),
      "existing",
    );

    const result = await applyTwinFallsDuplicateCleanup(repository);

    expect(result.merged).toEqual([]);
    expect(result.alreadyMerged).toEqual([
      "7e746d1b-a5dd-4c54-8b5e-fce8697f5af2",
      "0498cac2-4c90-46ab-a214-5c9dcf0775d1",
      "aab7b545-d065-441b-98c0-bef04f78f034",
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.note).toBe("existing");
  });

  it("safely skips a changed group without blocking the other merge or the note", async () => {
    const [countyFair, westernDays] = TWIN_FALLS_DUPLICATE_GROUPS;
    const repository = new FakeRepository(new Map([
      [countyFair.survivorId, "unsafe"],
      [westernDays.survivorId, "merged"],
    ]));

    const result = await applyTwinFallsDuplicateCleanup(repository);

    expect(result.merged).toEqual([...westernDays.duplicateIds]);
    expect(result.skipped).toEqual([
      { survivorId: countyFair.survivorId, reason: "unsafe" },
    ]);
    expect(result.note).toBe("created");
  });

  it("pins the reviewed survivors, duplicate IDs, ACT provenance, and logo source", () => {
    expect(TWIN_FALLS_DUPLICATE_GROUPS).toEqual([
      expect.objectContaining({
        survivorId: "b447c83c-6348-4fab-b850-0db7a5576a83",
        duplicateIds: [
          "7e746d1b-a5dd-4c54-8b5e-fce8697f5af2",
          "0498cac2-4c90-46ab-a214-5c9dcf0775d1",
        ],
        logoSourceId: "0498cac2-4c90-46ab-a214-5c9dcf0775d1",
      }),
      expect.objectContaining({
        survivorId: "8fc7bc14-ce90-4895-8ae0-8d870fb77459",
        duplicateIds: ["aab7b545-d065-441b-98c0-bef04f78f034"],
        logoSourceId: null,
      }),
    ]);

    const countyFair = TWIN_FALLS_DUPLICATE_GROUPS[0];
    const westernDays = TWIN_FALLS_DUPLICATE_GROUPS[1];
    expect(countyFair.expectedActRecordIdsByProfile).toEqual({
      "b447c83c-6348-4fab-b850-0db7a5576a83": [],
      "7e746d1b-a5dd-4c54-8b5e-fce8697f5af2": [
        "8498d62c-5993-4041-af8c-25704c3aabe4",
      ],
      "0498cac2-4c90-46ab-a214-5c9dcf0775d1": [],
    });
    expect(westernDays.expectedActRecordIdsByProfile).toEqual({
      "8fc7bc14-ce90-4895-8ae0-8d870fb77459": [
        "df430d7a-d278-46de-81c6-c2e5f121f9cd",
      ],
      "aab7b545-d065-441b-98c0-bef04f78f034": [],
    });
  });
});
