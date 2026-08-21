export type DuplicateReviewGroupLike = {
  candidateIds: string[];
  organizations: Array<{ id: string }>;
};

/**
 * Duplicate review is an unresolved-cleanup queue. If any member of a group has
 * already been intentionally resolved (merged/retired, placed under another
 * profile, or grouped in an Event Family), hide the whole stale candidate group.
 * Discovery will produce a fresh unresolved group later if one still exists.
 */
export function filterGroupsContainingResolvedProfiles<
  T extends DuplicateReviewGroupLike,
>(groups: readonly T[], resolvedProfileIds: ReadonlySet<string>): T[] {
  return groups.filter((group) =>
    !group.candidateIds.some((id) => resolvedProfileIds.has(id))
    && !group.organizations.some((profile) => resolvedProfileIds.has(profile.id)),
  );
}
