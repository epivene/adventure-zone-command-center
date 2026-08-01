import type {
  ActMigrationProposal,
  MigrationDecision,
  MigrationIssueCode,
  MigrationPreviewState,
  MigrationTargetEntityType,
} from "@/features/act-migration/migration-types";

export type BulkReviewScope = {
  runId: string;
  target: MigrationTargetEntityType;
  state: MigrationPreviewState;
  issue?: MigrationIssueCode | null;
  decision: "approve_proposed" | "ignore";
  reason?: string;
  actor: string;
};

export type BulkReviewDependencyStates = {
  appliedEntityIds: ReadonlySet<string>;
  frozenParentDecisions: ReadonlyMap<string, MigrationDecision | null>;
};

function dependenciesAreResolved(
  proposal: ActMigrationProposal,
  states: BulkReviewDependencyStates,
) {
  return proposal.dependencyProposalKeys.every((key) =>
    states.appliedEntityIds.has(key)
  );
}

function hasResolvedPrimarySource(proposal: ActMigrationProposal) {
  return proposal.targetEntityType !== "contact" ||
    proposal.sourceRecordKeys.length <= 1 ||
    proposal.proposedPrimarySourceId !== null;
}

export function bulkReviewEligibility(
  proposal: ActMigrationProposal,
  states: BulkReviewDependencyStates,
) {
  if (
    proposal.state === "new" &&
    proposal.issueCode === null &&
    proposal.candidateLocalIds.length === 0
  ) {
    return hasResolvedPrimarySource(proposal);
  }
  if (proposal.state !== "new_relationship" || !dependenciesAreResolved(proposal, states)) {
    return false;
  }
  if (proposal.issueCode === null) return true;
  if (
    proposal.targetEntityType !== "calling_list_member" ||
    proposal.issueCode !== "group_membership_semantics_unknown"
  ) {
    return false;
  }
  return proposal.dependencyProposalKeys.some((key) =>
    states.frozenParentDecisions.get(key) === "confirm_static_group"
  );
}
