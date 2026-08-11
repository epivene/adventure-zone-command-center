# Act Automatic Safe Context Resolution

**Date:** 2026-08-10

**Status:** Approved

## Goal

Remove page-by-page review from the one-time Act import. Rebuilding the saved archive will automatically turn every context match that already satisfies the strict safety model into a safe import operation. Uncertain records remain archived and do not block the safe import.

## Chosen Approach

Promote proven context matches inside the existing organizer instead of submitting thousands of review decisions from the browser.

The alternatives were rejected because browser-driven batches are fragile and a single large decision request risks request timeouts and another memory spike. Organizer-native promotion reuses the durable, restart-safe archive rebuild and creates the replacement manifest once.

This is deterministic automation, not generative AI. The same archived data and local records must always produce the same result.

## Safety Contract

A context match may become an automatic operation only when:

- a valid durable Act-to-local link is authoritative; or
- at least two independent clue families agree on one compatible target;
- no equally strong candidate is tied;
- no clue family contradicts the selected target;
- shared contact details are not treated as unique identity evidence;
- the operation does not replace a different non-empty local value; and
- every required relationship dependency is resolved.

Clue families remain the existing identity, direct-contact, web-identity, location, archive-relationship, event-context, and exact narrative-context families. Multiple values from one family still count as one clue.

Any weak, tied, contradictory, incompatible, or dependency-blocked record remains archived. It is excluded from automatic import and does not require the user to review it before importing the safe set.

## Organizer and Manifest Behavior

The existing context resolver continues to produce a target, confidence class, and sanitized evidence. The manifest builder will recognize qualifying `link_existing` context matches as automatic-safe outcomes and materialize their operations without requiring a review-decision row.

The automatic operation keeps provenance identifying it as a context resolution and preserves its evidence summary. Existing valid manual decisions remain authoritative. A later rebuild against changed source or local fingerprints re-evaluates inferred matches instead of blindly replaying stale inference.

The organizer builds and publishes one replacement manifest. It must not create one transaction or manifest rebuild per resolved record. Existing organizer leases and recovery behavior continue to handle process restarts.

## User Experience

The archive action remains one click and is relabeled clearly around the outcome, such as **Auto-review saved archive**. It reruns organization without fetching Act again.

After completion, the review screen shows:

- the number of context matches automatically resolved;
- the total safe operations ready to import; and
- the number of uncertain records left safely archived.

The screen no longer asks the user to select proven matches page by page. Per-record controls may remain available for optional exception handling, but they are not required to continue.

Import remains a separate final action. Automatic review prepares operations but does not change live profiles by itself.

## Data and API Shape

No new long-running browser loop or unbounded decision endpoint is introduced.

The organized outcome/manifest projection will distinguish automatic context resolution from manual review and expose aggregate counts through the existing run/review response. Evidence remains sanitized; raw narrative bodies and sensitive source values are not added to logs or summaries.

A database migration is unnecessary unless implementation proves the existing persisted match/provenance shape cannot represent the automatic classification. Prefer the current JSON match/evidence and manifest summary structures.

## Failure and Recovery

- The prior completed manifest stays available until the replacement manifest is fully built.
- A restart during organization is recovered through the existing organizer lease worker.
- Repeating the archive rebuild is idempotent.
- A failed rebuild does not partially publish automatic operations.
- Errors report the phase and counts without logging complete source notes.

## Testing

Unit and manifest tests will prove that:

- authoritative links and two independent agreeing clues become automatic-safe operations;
- two clues from one family do not qualify;
- ties, contradictions, shared email/phone values, and incompatible entity types remain archived;
- non-empty local values are never overwritten automatically;
- relationship operations appear only after dependencies resolve;
- existing manual decisions retain authority;
- input ordering does not change output or digest; and
- a repeated rebuild produces the same manifest.

API and UI tests will prove that:

- one archive action starts the durable organizer;
- aggregate auto-resolved, ready, and archived counts are displayed;
- proven matches require no page selection or bulk-decision calls;
- uncertain records do not block safe import; and
- the action and progress state work on mobile.

Production-oriented tests will enforce bounded context indexes and one manifest rebuild so the current archive remains within Render's 256 MB Node heap.

## Success Criteria

- The user can prepare all safe imports with one archive rebuild and no record-by-record review.
- Every automatically linked record has authoritative evidence or two independent agreeing clue families.
- No automatic operation overwrites populated local data.
- Ambiguous records remain preserved in the archive and do not block safe import.
- Rebuilds are deterministic, restart-safe, and complete without an out-of-memory failure.
- The final import remains a separate explicit user action.
