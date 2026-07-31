import type { ActMigrationProposal } from "@/features/act-migration/migration-types";

export type AutomaticMigrationReview = {
  /** Structural proposals with review state updated for deterministic storage. */
  proposals: readonly ActMigrationProposal[];
  /** Proposals that can use the safe, implicit approve-proposed decision. */
  approvedProposalKeys: readonly string[];
  /** Stable, unchanged proposals that still require canonical-link reconciliation. */
  reconciledProposalKeys: readonly string[];
  /** Proposals that remain visible review work. */
  pendingProposalKeys: readonly string[];
};

function hasResolvedContactPrimary(proposal: ActMigrationProposal) {
  return proposal.targetEntityType !== "contact" ||
    proposal.sourceRecordKeys.length <= 1 ||
    proposal.proposedPrimarySourceId !== null;
}

function canApproveNewProposal(proposal: ActMigrationProposal) {
  return proposal.state === "new" &&
    proposal.issueCode === null &&
    proposal.candidateLocalIds.length === 0 &&
    proposal.proposedLocalId === null &&
    hasResolvedContactPrimary(proposal);
}

function canApproveRelationship(
  proposal: ActMigrationProposal,
  approved: ReadonlySet<string>,
  reconciled: ReadonlySet<string>,
) {
  return proposal.state === "new_relationship" &&
    proposal.issueCode === null &&
    proposal.dependencyProposalKeys.length > 0 &&
    proposal.dependencyProposalKeys.every((key) =>
      approved.has(key) || reconciled.has(key)
    );
}

/**
 * Decides only proposals whose identity was already proven by matching:
 * collision-free new records, their dependency-ready relationships, and
 * unchanged stable links. Candidate matches, source conflicts, and changed
 * records deliberately remain outside this bounded policy.
 */
export function autoReviewMigrationProposals(
  proposals: readonly ActMigrationProposal[],
): AutomaticMigrationReview {
  const reconciled = new Set(
    proposals.flatMap((proposal) =>
      proposal.state === "matched_unchanged" &&
      proposal.issueCode === null &&
      proposal.proposedLocalId !== null
        ? [proposal.proposalKey]
        : [],
    ),
  );
  const approved = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const proposal of proposals) {
      if (approved.has(proposal.proposalKey)) continue;
      if (
        canApproveNewProposal(proposal) ||
        canApproveRelationship(proposal, approved, reconciled)
      ) {
        approved.add(proposal.proposalKey);
        changed = true;
      }
    }
  }

  const reviewed = proposals.map((proposal) =>
    approved.has(proposal.proposalKey)
      ? { ...proposal, reviewState: "decided" as const }
      : proposal,
  );
  return {
    proposals: reviewed,
    approvedProposalKeys: [...approved].toSorted(),
    reconciledProposalKeys: [...reconciled].toSorted(),
    pendingProposalKeys: reviewed
      .filter(({ reviewState }) => reviewState === "pending")
      .map(({ proposalKey }) => proposalKey)
      .toSorted(),
  };
}
