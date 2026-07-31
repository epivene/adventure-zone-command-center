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

export function isExactDuplicatePlaceGroup(proposal: ActMigrationProposal) {
  return proposal.targetEntityType === "organization" &&
    proposal.state === "new" &&
    proposal.issueCode === null &&
    proposal.candidateLocalIds.length === 0 &&
    proposal.proposedLocalId === null &&
    proposal.duplicateGroupKey !== null &&
    proposal.duplicateGroupKey !== undefined &&
    (proposal.duplicateSourceIds?.length ?? 0) > 1;
}

/**
 * Decides only an exact duplicate-place group. Stable unchanged proposals are
 * reported as reconciliation candidates but retain their canonical-link gate
 * at the manifest boundary. Candidate matches, source conflicts, ordinary
 * new records, relationships, and changed records remain outside this policy.
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
  const approved = new Set(
    proposals.flatMap((proposal) =>
      isExactDuplicatePlaceGroup(proposal) ? [proposal.proposalKey] : [],
    ),
  );

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
