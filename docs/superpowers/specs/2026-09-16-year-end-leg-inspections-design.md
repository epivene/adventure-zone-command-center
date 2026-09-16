# Year-End Leg Inspections and Reusable Inflatable Pieces

**Date:** September 16, 2026  
**Status:** Approved design, awaiting written-spec review

## Purpose

Add a mobile-friendly year-end inspection workflow for every travel leg. A leg manager can inspect every physical inflatable piece, record extensive notes, take multiple photos, optionally circle areas in a photo, and describe the pictured issue underneath it. Completed inspections become part of the existing maintenance records visible to admin and boss users.

The equipment count is intentionally unlimited. The current estimate of roughly 58 pieces is starting data, not a schema or interface limit.

## Approved Product Decisions

- A piece is an individual physical component that can be combined with other pieces into a whole attraction.
- Each travel leg maintains its own inspection list rather than inheriting a company-wide master checklist.
- A prior year's leg inspection can be copied forward to avoid re-entering the same equipment.
- Photos support optional freehand circles. The meaningful explanation remains in a description field displayed beneath the photo.
- The leg manager performs the inspection. Admin and boss users receive the finished record in the existing maintenance-record area.
- Inspection and piece history must remain available across seasons, transfers, repairs, and regrouping.

## Recommended Architecture

Extend the existing resource, travel-leg, manager photo-upload, private-object-storage, and maintenance-record systems. Do not create a disconnected checklist or encode all pieces in one notes field.

Existing `resources` remain the records for complete attractions and other operational equipment. New reusable piece records sit beneath those resources:

```text
Travel leg
  -> yearly leg inspection
      -> inspection entries
          -> reusable equipment piece
              -> current parent attraction (optional)
              -> notes, condition, repair state
              -> photos and photo descriptions
```

A piece can exist without a parent attraction while it is stored as a spare, being repaired, or waiting to be regrouped.

## Data Model

### Equipment pieces

Create an equipment-pieces table with:

- Stable UUID and editable piece code/label
- Name
- Optional parent resource/attraction ID
- Current travel-leg ID
- Optional storage-location text
- Piece type/category
- General identity notes
- Current lifecycle status: `active`, `stored_spare`, `needs_repair`, `replace`, or `retired`
- Created, updated, and archived timestamps

Codes should be unique among non-archived pieces. Archiving preserves inspection and maintenance history.

### Attraction composition history

Store dated piece-to-attraction assignments separately rather than only overwriting a parent ID. This records when a piece joined or left an attraction. The active assignment powers the current inventory view; historical assignments explain older inspections.

### Yearly leg inspections

Create one inspection record per leg and year, with:

- Leg ID and inspection year
- Status: `draft`, `in_progress`, or `completed`
- Started, completed, and last-edited timestamps
- Manager identity snapshot
- Overall leg notes
- Optional admin/boss maintenance follow-up note
- Link to the copied source inspection when a prior year was copied

Only one non-archived inspection may exist for the same leg and year.

### Inspection entries

Each entry is a snapshot of one piece during that inspection. It stores:

- Inspection ID and piece ID
- Piece name/code and parent-attraction snapshot
- Sort order
- Inspection state: `not_started`, `inspected`, or `not_present`
- Condition: `good`, `needs_cleaning`, `minor_repair`, `major_repair`, `replace`, or `retired`
- Detailed inspection notes
- Repair-needed flag and repair notes
- Retain-for-future-use flag
- Inspected-at timestamp and inspector identity snapshot

Snapshot fields keep old inspections understandable after a piece is renamed, moved, or regrouped.

### Inspection photos

Each entry accepts unlimited photos within sensible per-file size and MIME-type limits. Store:

- Private object-storage key
- Original MIME type and upload status
- Description displayed beneath the photo
- Optional annotation data
- Sort order and timestamps

Annotation data is a small JSON document containing normalized freehand circle/ellipse coordinates. Keeping coordinates normalized allows the circles to render correctly at different phone and desktop sizes without creating a second edited image file.

## Manager Workflow

Add **Year-End Inspection** to the leg manager's maintenance area.

1. The manager opens the current year's inspection for their assigned leg.
2. If none exists, they can start blank, copy the prior year's list, or build the list from pieces currently assigned to their leg.
3. The inspection dashboard shows total pieces and counts for not started, inspected, needs attention, and missing/not present.
4. The manager opens a piece card, chooses its condition, adds long-form notes, and records repair details.
5. The manager can take or upload multiple photos. For each photo they may draw one or more circles and enter a description below it.
6. The manager can add a newly discovered piece, regroup a piece under an attraction, or mark it as a stored spare.
7. Work autosaves locally first and syncs through the existing manager offline queue when a connection is available.
8. Completion is blocked until every entry is inspected or deliberately marked not present.
9. The manager reviews a summary and selects **Complete Inspection**.

Completion does not freeze the record forever. Admin or boss can reopen it when a correction is required. The reopen action is audited.

## Admin and Boss Workflow

Completed and in-progress year-end inspections appear in the existing maintenance records, grouped by leg and year. Admin and boss users can:

- See completion progress and the latest update time
- Open every piece, note, photo, description, and annotation
- Filter attention items by condition or repair state
- Add maintenance follow-up notes
- Mark a repair complete without erasing the original inspection finding
- Reopen a completed inspection
- Move or regroup pieces for the next season
- Print or export a leg inspection summary later without changing the underlying records

The normal leg cards should show a compact current-year inspection summary, such as `42 of 58 inspected` and `6 need repair`, with a link into the maintenance record.

## Piece Inventory Interface

Add a reusable-pieces view alongside the existing resource inventory. It supports search, filters, and grouping by:

- Travel leg
- Whole attraction
- Stored spare/unassigned
- Condition or lifecycle status
- Storage location

Adding, archiving, transferring, or regrouping a piece changes current inventory only. It never deletes prior inspection results.

## Photo Experience

The phone camera remains the primary capture path. After capture:

- Show the full photo and an optional **Circle an area** action.
- Freehand drawing creates one or more visible circles/loops; undo and clear are available before saving.
- The description box sits immediately below the image and supports detailed notes.
- A photo can be saved without a circle, but it must have a description when the piece condition indicates repair or replacement.
- Admin and boss views overlay the saved circles while displaying the written description beneath the image.

The original photo must remain intact. Annotations are stored separately and can be hidden or corrected without damaging the evidence image.

## Maintenance Integration

An inspection finding is evidence; a repair is subsequent work. They must remain separate but linked.

When an entry is marked minor repair, major repair, replace, or retired, the system creates or updates a linked maintenance attention item. Admin/boss maintenance records show:

- Original condition and inspection date
- Piece, attraction, and leg
- Inspection notes and photos
- Repair status, repair notes, costs/documents when available, and completion date

Completing a repair does not rewrite the old inspection condition. The piece's current status may be updated independently.

## Permissions and Audit Rules

- A leg manager can create and edit inspections and pieces only for their assigned leg.
- A manager cannot move a piece to another leg; admin/boss handles cross-leg transfers.
- Admin and boss can view all legs, edit inventory, add follow-up records, reopen inspections, and transfer/regroup pieces.
- Completion, reopening, transfer, regrouping, archiving, and repair-status changes record actor and timestamp.
- Photos remain private and are delivered through short-lived signed URLs, matching existing leg-manager storage behavior.

## API and Service Boundaries

Keep the feature divided into focused units:

- Piece inventory repository/service: identity, current assignment, history, archive/restore
- Inspection repository/service: yearly inspection lifecycle, copying, entry progress, completion validation
- Inspection photo service: metadata, object storage, descriptions, annotation validation
- Maintenance projection service: converts attention findings into linked maintenance items without duplicating them
- Manager routes: scoped to the authenticated manager's leg
- Admin/boss routes: company-wide review, reopen, transfer, regroup, and repair follow-up

All write endpoints use client mutation IDs or another idempotency key so offline retries cannot create duplicate entries or photos.

## Validation and Failure Handling

- Reject unsupported image formats and oversized files before upload when possible and again on the server.
- Preserve notes and inspection answers if a photo upload fails; display the photo as needing attention and allow retry.
- Prevent final completion while unsynced required changes or required repair-photo descriptions remain.
- Prevent duplicate active piece codes.
- Prevent active piece assignment to archived attractions or legs.
- Use transactions for copying inspections, transfers, and attraction regrouping.
- Never delete an original photo merely because its annotation or description is edited.

## Migration and Initial Setup

- Add database migrations and matching required-startup safeguards following the app's existing deployment pattern.
- Create the new tables empty; do not hardcode 58 placeholder rows.
- Admin can bulk-add the initial pieces with a lightweight repeated-entry interface or CSV import.
- Existing complete attractions remain intact and can be selected as parent attractions for new pieces.
- No existing maintenance, resource, leg, checklist, or photo records are rewritten.

## Testing and Acceptance Criteria

### Data and service tests

- Unlimited pieces can be created; no 58-piece assumption exists.
- Piece composition history survives regrouping.
- Copying a prior year creates independent entries with correct snapshots.
- Offline retries are idempotent.
- A manager cannot access another leg's inspection or pieces.
- Completion fails while entries remain unresolved.
- Maintenance attention items are linked once, not duplicated.
- Inspection history survives piece archive, transfer, and rename.

### Interface tests

- A manager can complete the full workflow on a narrow mobile viewport.
- The progress counts and attention filters are accurate.
- Multiple photos can be captured per piece.
- Circles scale correctly when the photo is resized.
- The description appears directly under its photo.
- Failed uploads retain the rest of the inspection data and can be retried.
- Admin and boss can find the record under maintenance, reopen it, and complete repair follow-up.

### Definition of done

The feature is complete when a leg manager can build or copy a leg-specific annual list, inspect every component, save extensive notes and annotated photos offline or online, complete the inspection, and have the full record and repair needs appear reliably in admin and boss maintenance records.
