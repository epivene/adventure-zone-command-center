# ACT Note Ownership Repair V2 Design

## Problem

The ACT migration still has two related data-integrity failures:

1. Some ACT company notes/history are missing from the matching Adventure Zone profile even though they exist in ACT/archive data.
2. Some imported ACT notes/history are attached to the Adventure Zone company profile or another wrong profile instead of their actual ACT company/contact/opportunity.

A concrete symptom is a company that shows two Notes in ACT but zero Notes in Adventure Zone, while the Adventure Zone profile itself contains unrelated imported notes/history.

## User-approved behavior

- ACT **Notes** must appear in the profile's normal **Notes** count/list.
- ACT **History** must remain in profile **History**.
- Original ACT provenance must remain preserved.
- Existing wrong assignments must be repaired, not merely hidden.
- Missing imported records must be recovered when the archive contains enough evidence.
- Automatic repair may only use exact archived ACT relationship evidence.
- Text similarity, event-name similarity, city similarity, or AI guesses must never auto-move a timeline record.
- Ambiguous or unresolved records must go to the existing ACT recovery review queue.
- The repair must not delete the underlying ACT source/archive record.

## Architecture

Reuse the existing ACT archive recovery subsystem. `ActTimelineRecovery` already resolves exact archived parent relationships, creates missing timeline activities, adds canonical associations, clears legacy direct-parent columns, and removes stale associations. `ActRecoveryReviewService` already exposes `needs_review` items and manual assign/retry/drop decisions.

V2 will strengthen and expose that existing path rather than introducing another importer.

### Repair run

Create a new request key, `act-note-profile-repair-v2`, scoped to timeline streams:

- `note`
- `history`
- `activity`

The run scans archived timeline source records and categorizes each as:

- `recovered` — missing local record created or wrong ownership repaired
- `already_present` — local record already exists with canonical associations
- `needs_review` — exact parent cannot be uniquely resolved
- `dropped_unusable` — source cannot form a usable timeline record
- `retryable_failed` — transient execution failure

The repair remains idempotent. Re-running it must not duplicate notes/history.

## Exact ownership rules

For an archived timeline record, canonical parents come only from:

1. archived relationship source records such as `note_company`, `note_contact`, `history_company`, etc.; or
2. exact inline ACT relationship IDs that resolve through archived ACT source records and local `act_external_links`; or
3. an explicit owner decision already stored as `assign_parent` in `act_archive_recovery_decisions`.

When one or more exact canonical parents resolve:

- ensure `activity_associations` contains those exact parents;
- clear legacy direct `activities.organization_id`, `contact_id`, and `booking_id` ownership fields;
- remove stale `activity_associations` that are not among the canonical exact parents;
- preserve the activity/source provenance and ACT record identity.

When no exact parent resolves, the record becomes `needs_review`; it must not remain attached to a guessed profile.

## Missing-record recovery

If an archived ACT Note/History has exact ownership but no local activity exists:

- normalize it using the existing timeline normalizer;
- create the activity with source provenance (`source_record_id`, `source_version_id`, `source_type`, ACT timeline key);
- associate it to the exact canonical parent(s);
- do not create duplicate activities if the same source has already been recovered.

## Notes vs History presentation

The profile API/UI must treat ACT timeline source type separately from activity display category:

- source type `note` is included in the normal Notes collection/count and marked imported from ACT;
- source type `history` remains in History;
- source type `activity` follows its normalized activity category.

The raw Imported ACT history/source area may remain for provenance/reference, but ACT Notes must not be visible only there.

## Adventure Zone profile cleanup

Adventure Zone is not a special hard-coded destination. It is a regression case proving the general ownership repair works.

If a timeline record is currently associated to Adventure Zone but exact archived relationship evidence identifies another profile, V2 must remove the Adventure Zone association and keep only the canonical exact association(s).

If no exact archived parent is available, V2 must not automatically move it anywhere; it becomes `needs_review`.

## Review workflow

Reuse the existing ACT recovery review queue and `ActRecoveryReviewService`:

- unresolved ownership appears in `needs_review`;
- owner can assign a canonical organization/contact/booking;
- assignment stores an `assign_parent` recovery decision;
- item returns to pending and re-runs through normal recovery;
- retry/drop behavior remains unchanged.

No separate review table or second admin queue is introduced.

## Reporting

The repair status UI/API should make timeline repair outcomes understandable by showing at least:

- candidate count
- recovered
- already correct/present
- needs review
- dropped unusable
- retryable failed

Where practical, label the V2 run as a note/history ownership repair so it is distinguishable from full ACT archive recovery.

## Safety constraints

- Never delete ACT archive/source records.
- Never auto-assign based on fuzzy text/name/location matching.
- Never duplicate a local timeline item for the same ACT source record.
- Never turn historical ACT notes into bookings or follow-ups.
- Preserve source record/version provenance during moves and repairs.
- Ambiguous ownership is reviewable, not guessed.

## Verification

Tests must cover:

1. a missing ACT Note with exact company ownership is created and associated to the correct organization;
2. a legacy note attached to the wrong organization has the stale association removed and the exact organization association added;
3. Adventure Zone as the wrong legacy owner is cleaned up by the same generic rule;
4. unresolved/ambiguous relationship evidence results in `needs_review` and no guessed association;
5. rerunning repair is idempotent and creates no duplicate activity;
6. an imported ACT `note` is returned in the normal profile Notes collection/count;
7. an imported ACT `history` remains History and is not counted as a Note;
8. the V2 timeline-only repair run is scheduled/available with `note`, `history`, and `activity` streams only.
