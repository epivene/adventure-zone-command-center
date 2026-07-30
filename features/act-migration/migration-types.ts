export const actSourceEntityTypeValues = [
  "company",
  "contact",
  "opportunity",
  "group",
] as const;
export type ActSourceEntityType =
  (typeof actSourceEntityTypeValues)[number];

export const actRelationshipTypeValues = [
  "company_contact",
  "opportunity_company",
  "opportunity_contact",
  "group_contact",
] as const;
export type ActRelationshipType =
  (typeof actRelationshipTypeValues)[number];

export const actMigrationStreamTypeValues = [
  ...actSourceEntityTypeValues,
  ...actRelationshipTypeValues,
] as const;
export type ActMigrationStreamType =
  (typeof actMigrationStreamTypeValues)[number];

export const actMigrationRunStatusValues = [
  "snapshotting",
  "snapshot_complete",
  "matching",
  "previewed",
  "failed",
] as const;
export type ActMigrationRunStatus =
  (typeof actMigrationRunStatusValues)[number];

export const actMigrationCheckpointStatusValues = [
  "pending",
  "fetching",
  "complete",
  "failed",
] as const;
export type ActMigrationCheckpointStatus =
  (typeof actMigrationCheckpointStatusValues)[number];

export const actQueryModeValues = ["projected", "plain"] as const;
export type ActQueryMode = (typeof actQueryModeValues)[number];

export const migrationPreviewStateValues = [
  "new",
  "matched_unchanged",
  "change",
  "new_relationship",
  "possible_duplicate",
  "needs_review",
  "ignored",
  "error",
] as const;
export type MigrationPreviewState =
  (typeof migrationPreviewStateValues)[number];

export const migrationDecisionValues = [
  "approve_proposed",
  "link_existing",
  "keep_separate",
  "ignore",
] as const;
export type MigrationDecision = (typeof migrationDecisionValues)[number];

export const migrationReviewStateValues = [
  "not_required",
  "pending",
  "decided",
  "ignored",
] as const;
export type MigrationReviewState =
  (typeof migrationReviewStateValues)[number];

export const migrationTargetEntityTypeValues = [
  "organization",
  "contact",
  "booking",
  "organization_contact",
  "booking_contact",
  "calling_list",
  "calling_list_member",
] as const;
export type MigrationTargetEntityType =
  (typeof migrationTargetEntityTypeValues)[number];

const decisionsByPreviewState: Record<
  MigrationPreviewState,
  readonly MigrationDecision[]
> = {
  new: ["approve_proposed", "ignore"],
  matched_unchanged: [],
  change: ["approve_proposed", "ignore"],
  new_relationship: ["approve_proposed", "ignore"],
  possible_duplicate: ["link_existing", "keep_separate", "ignore"],
  needs_review: ["link_existing", "keep_separate", "ignore"],
  ignored: [],
  error: [],
};

export function migrationStreamRank(stream: ActMigrationStreamType) {
  return actMigrationStreamTypeValues.indexOf(stream);
}

export function allowedDecisionsForPreviewState(
  state: MigrationPreviewState,
) {
  return [...decisionsByPreviewState[state]];
}

export function isMigrationDecision(
  value: unknown,
): value is MigrationDecision {
  return (
    typeof value === "string" &&
    (migrationDecisionValues as readonly string[]).includes(value)
  );
}

export function isMigrationTargetEntityType(
  value: unknown,
): value is MigrationTargetEntityType {
  return (
    typeof value === "string" &&
    (migrationTargetEntityTypeValues as readonly string[]).includes(value)
  );
}

export type ActPageRequest = {
  skip: number;
  top: number;
  queryMode: ActQueryMode;
};

export type ActPage = {
  items: unknown[];
  nextSkip: number | null;
  queryMode: ActQueryMode;
};

function safeSourceId(value: string) {
  const sourceId = value.trim();
  if (!sourceId) {
    throw new Error("Act! source identifiers must be nonblank.");
  }
  if (sourceId.includes(":")) {
    throw new Error("Act! source identifiers cannot contain colons.");
  }
  return sourceId;
}

export function sourceRecordKey(
  type: ActSourceEntityType,
  sourceId: string,
) {
  return `${type}:${safeSourceId(sourceId)}`;
}

export function relationshipSourceKey(
  type: ActRelationshipType,
  sourceId: string,
  targetId: string,
) {
  return `${type}:${safeSourceId(sourceId)}:${safeSourceId(targetId)}`;
}
