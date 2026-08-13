export type BulkMergeGroup = {
  normalizedName: string;
  classification: "duplicate" | "location_candidate";
  organizations: Array<{ id: string }>;
};

export type MergeRequest = {
  primaryId: string;
  duplicateIds: string[];
};

export type BulkMergeProgress = {
  completed: number;
  total: number;
  groupName: string;
};

export class BulkDuplicateMergeError extends Error {
  readonly groupName: string;
  readonly completed: number;
  readonly total: number;
  override readonly cause: unknown;

  constructor({
    groupName,
    completed,
    total,
    cause,
  }: BulkMergeProgress & { cause: unknown }) {
    super(`Could not merge duplicate group ${groupName}`, { cause });
    this.name = "BulkDuplicateMergeError";
    this.groupName = groupName;
    this.completed = completed;
    this.total = total;
    this.cause = cause;
  }
}

export async function mergeDuplicateGroups(
  groups: BulkMergeGroup[],
  primaryIds: Readonly<Record<string, string>>,
  merge: (request: MergeRequest) => Promise<void>,
  onProgress: (progress: BulkMergeProgress) => void,
): Promise<void> {
  const eligibleGroups = groups.filter(
    (group) => group.classification === "duplicate",
  );
  const total = eligibleGroups.length;

  for (let index = 0; index < eligibleGroups.length; index += 1) {
    const group = eligibleGroups[index];
    const primaryId = primaryIds[group.normalizedName];

    try {
      if (
        !primaryId ||
        !group.organizations.some(
          (organization) => organization.id === primaryId,
        )
      ) {
        throw new Error(
          "The selected primary profile is no longer in this duplicate group.",
        );
      }

      const duplicateIds = group.organizations
        .filter((organization) => organization.id !== primaryId)
        .map((organization) => organization.id);

      await merge({ primaryId, duplicateIds });
    } catch (cause) {
      throw new BulkDuplicateMergeError({
        groupName: group.normalizedName,
        completed: index,
        total,
        cause,
      });
    }

    onProgress({
      completed: index + 1,
      total,
      groupName: group.normalizedName,
    });
  }
}
