import type { CandidateDTO } from "./outreach-dto";

/** Commitments retain priority even before any generic outreach is linked. */
export function hasActivePursuit(candidate: CandidateDTO): boolean {
  return (
    !candidate.releasedAt &&
    Boolean(
      candidate.liveHoldId ||
      candidate.decisionDueAt ||
      candidate.sources.manualNextActions.length ||
      candidate.attempts?.length ||
      candidate.sources.choices?.some((source) => source.eligible) ||
      candidate.sources.observedInterestAt ||
      candidate.sources.observedConversationAt ||
      candidate.meaningfulReplyAt ||
      ["interested", "booking_in_progress"].includes(
        candidate.opportunityStatus,
      ),
    )
  );
}
