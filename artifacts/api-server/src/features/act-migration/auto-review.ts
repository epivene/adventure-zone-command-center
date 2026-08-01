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
 * Auto-approves all proposals that are safe to import without manual review:
 * - New records with no ambiguous candidates and no blocking issues
 * - Changes to existing records with no blocking issues
 * - New relationships whose parent entities are already resolved
 * - Calling lists: always auto-confirmed as static groups
 *
 * Proposals that stay pending (require manual decisions):
 * - Records with ambiguous candidate matches (issueCode blocks auto-approval)
 * - possible_duplicate / needs_review states
 * - Any relationship whose parent entity is still unresolved
 */
export function autoReviewMigrationProposals(
  proposals: readonly ActMigrationProposal[],
): AutomaticMigrationReview {
  // Stable unchanged proposals are reconciled, not approved — they just need
  // a canonical-link check before being written.
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
  const isResolved = (key: string) => approved.has(key) || reconciled.has(key);

  function isSafeToApprove(proposal: ActMigrationProposal): boolean {
    if (proposal.state === "error" || proposal.state === "ignored") return false;
    if (
      proposal.state === "matched_unchanged" ||
      proposal.state === "possible_duplicate" ||
      proposal.state === "needs_review"
    ) return false;

    // Calling lists: always approve as static groups (the
    // "group_membership_semantics_unknown" issue just asks us to confirm
    // static semantics — we always want that here).
    if (proposal.targetEntityType === "calling_list") return true;

    // All other proposals need no blocking issues and no ambiguous candidates.
    if (proposal.issueCode !== null) return false;
    if (proposal.state === "new" && proposal.candidateLocalIds.length > 0) return false;

    // Safe: new (no candidates), change, new_relationship
    return true;
  }

  // Iteratively approve proposals whose dependencies are all already resolved.
  // First iteration approves root-level entities (no dependencies). Subsequent
  // iterations climb the dependency tree so relationships, bookings, and
  // calling-list memberships are approved once their parents are.
  let changed = true;
  while (changed) {
    changed = false;
    for (const proposal of proposals) {
      if (approved.has(proposal.proposalKey)) continue;
      if (!isSafeToApprove(proposal)) continue;
      if (proposal.dependencyProposalKeys.every(isResolved)) {
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
