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
  "applying",
  "partially_applied",
  "applied",
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
  "confirm_static_group",
  "ignore",
] as const;
export type MigrationDecision = (typeof migrationDecisionValues)[number];

export const migrationApplyBatchStatusValues = [
  "pending",
  "applying",
  "partially_applied",
  "applied",
  "failed",
] as const;
export type MigrationApplyBatchStatus =
  (typeof migrationApplyBatchStatusValues)[number];

export const migrationApplyOperationStatusValues = [
  "pending",
  "leased",
  "blocked",
  "applied",
  "ignored",
  "failed",
] as const;
export type MigrationApplyOperationStatus =
  (typeof migrationApplyOperationStatusValues)[number];

export const migrationReviewStateValues = [
  "not_required",
  "pending",
  "decided",
  "ignored",
] as const;
export type MigrationReviewState =
  (typeof migrationReviewStateValues)[number];

export const migrationIssueCodeValues = [
  "ambiguous_person_match",
  "ambiguous_place_match",
  "company_only_contact_unresolved",
  "duplicate_source_id_conflict",
  "group_dynamic_unsupported",
  "group_membership_semantics_unknown",
  "group_target_unavailable",
  "needs_person",
  "opportunity_place_ambiguous",
  "opportunity_place_errored",
  "opportunity_place_location_incomplete",
  "opportunity_place_missing",
  "orphaned_external_link",
  "parent_proposal_unresolved",
  "shared_mailbox_match_blocked",
  "source_record_error",
] as const;
export type MigrationIssueCode =
  (typeof migrationIssueCodeValues)[number];

export const migrationTargetEntityTypeValues = [
  "organization",
  "contact",
  "organization_contact",
  "booking",
  "booking_contact",
  "calling_list",
  "calling_list_member",
] as const;
export type MigrationTargetEntityType =
  (typeof migrationTargetEntityTypeValues)[number];

export type LocalPlaceCandidate = {
  id: string;
  name: string;
  normalizedName: string;
  placeType: string;
  actIndustry: string | null;
  phone: string | null;
  normalizedPhone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  normalizedCity: string | null;
  normalizedRegion: string | null;
  postalCode: string | null;
  website: string | null;
  normalizedWebsiteHost: string | null;
};

export type LocalPersonCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  normalizedName: string;
  email: string | null;
  normalizedEmail: string | null;
  sharedEmail: boolean;
  phone: string | null;
  normalizedPhone: string | null;
  jobTitle: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
};

export type LocalBookingCandidate = {
  id: string;
  organizationId: string | null;
  primaryContactId: string | null;
  name: string;
  venueName: string | null;
  address1: string | null;
  city: string;
  region: string;
  postalCode: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: string;
  probability: string;
  notes: string | null;
};

export type LocalMigrationCandidateSnapshot = {
  places: readonly LocalPlaceCandidate[];
  people: readonly LocalPersonCandidate[];
  bookings: readonly LocalBookingCandidate[];
  placePeople: readonly {
    organizationId: string;
    contactId: string;
    active: boolean;
    isPrimary: boolean;
    role: string | null;
    source: string;
  }[];
  bookingPeople: readonly {
    bookingId: string;
    contactId: string;
    isPrimary: boolean;
    role: string | null;
    source: string;
  }[];
  externalLinks: readonly {
    entityType: "organization" | "contact" | "booking" | "calling_list";
    entityId: string;
    sourceEntityType: ActSourceEntityType;
    actRecordId: string;
    isPrimary: boolean;
    syncMode: "two_way" | "pull_only";
  }[];
};

export type ActMigrationProposal = {
  proposalKey: string;
  state: MigrationPreviewState;
  reviewState: MigrationReviewState;
  targetEntityType: MigrationTargetEntityType;
  sourceRecordKeys: readonly string[];
  candidateLocalIds: readonly string[];
  proposedLocalId: string | null;
  proposedPrimarySourceId: string | null;
  /** Present only when exact Act! place rows were consolidated in preview. */
  duplicateGroupKey?: string | null;
  /** All Act! company IDs represented by an exact duplicate-place proposal. */
  duplicateSourceIds?: readonly string[];
  matchReason: string;
  issueCode: MigrationIssueCode | null;
  dependencyProposalKeys: readonly string[];
  displaySnapshot: Record<string, string | number | boolean | null>;
};

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

export function migrationTargetRank(target: MigrationTargetEntityType) {
  return migrationTargetEntityTypeValues.indexOf(target);
}

export function allowedDecisionsForPreviewState(
  state: MigrationPreviewState,
) {
  return [...decisionsByPreviewState[state]];
}

const unresolvedProposalIssues = new Set<MigrationIssueCode>([
  "opportunity_place_ambiguous",
  "opportunity_place_errored",
  "opportunity_place_location_incomplete",
  "opportunity_place_missing",
  "parent_proposal_unresolved",
  "group_target_unavailable",
]);

export function allowedDecisionsForProposal(input: {
  state: MigrationPreviewState;
  targetEntityType: MigrationTargetEntityType;
  issueCode: MigrationIssueCode | null;
  candidateLocalIds: readonly string[];
}): readonly MigrationDecision[] {
  if (input.state === "error" || input.state === "ignored") return [];
  if (
    input.state === "needs_review" &&
    input.targetEntityType === "calling_list" &&
    input.issueCode === "group_membership_semantics_unknown"
  ) {
    return ["confirm_static_group", "ignore"];
  }
  if (
    input.issueCode !== null &&
    unresolvedProposalIssues.has(input.issueCode)
  ) {
    return ["ignore"];
  }

  const decisions = allowedDecisionsForPreviewState(input.state).filter(
    (decision) =>
      decision !== "link_existing" || input.candidateLocalIds.length > 0,
  );
  if (
    input.state === "needs_review" &&
    input.targetEntityType === "contact" &&
    input.issueCode === "ambiguous_person_match" &&
    input.candidateLocalIds.length === 0
  ) {
    decisions.unshift("approve_proposed");
  }
  return decisions.filter(
    (decision) =>
      decision !== "keep_separate" ||
      (input.targetEntityType === "contact" &&
        (input.state === "possible_duplicate" ||
          input.issueCode === "ambiguous_person_match" ||
          input.issueCode === "shared_mailbox_match_blocked")),
  );
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
  /** Optional OData $filter string applied to the request (e.g. for date range scans). */
  filter?: string;
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
