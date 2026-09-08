export const WYO131_DUPLICATE_GROUP = {
  survivorName: "WYO-131 Biketoberfest Gravel Race",
  duplicateName: "WYO131 Gravel Race, The (Lander) ) WY",
  city: "Lander",
  region: "WY",
  websiteHost: "wyo131.com",
} as const;

export type Wyo131DuplicateMergeOutcome =
  | "merged"
  | "already_merged"
  | "unsafe";

export interface Wyo131DuplicateRepository {
  mergeExactGroup(
    group: typeof WYO131_DUPLICATE_GROUP,
  ): Promise<Wyo131DuplicateMergeOutcome>;
}

export async function applyWyo131DuplicateCleanup(
  repository: Wyo131DuplicateRepository,
): Promise<{ outcome: Wyo131DuplicateMergeOutcome }> {
  return {
    outcome: await repository.mergeExactGroup(WYO131_DUPLICATE_GROUP),
  };
}
