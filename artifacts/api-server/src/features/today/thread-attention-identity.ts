import type { MasterWorkCandidate } from "./master-work-queue";
type AttentionIdentity = {
  followup_id: string | null;
  profile_id: string;
  gmail_connection_id: string;
  thread_id: string;
};
// Only an explicitly linked reminder proves a generic reply card is this thread.
// A profile or opportunity alone can cover several conversations.
export function attachVerifiedAttentionIdentity(
  candidates: MasterWorkCandidate[],
  rows: AttentionIdentity[],
) {
  for (const candidate of candidates) {
    if (candidate.sourceType !== "follow_up" || !["reply", "follow_up"].includes(candidate.kind))
      continue;
    const matches = rows.filter(
      (row) =>
        row.followup_id === candidate.sourceId &&
        row.profile_id === candidate.organizationId,
    );
    if (matches.length !== 1) continue;
    candidate.gmailConnectionId = matches[0].gmail_connection_id;
    candidate.threadId = matches[0].thread_id;
  }
}
