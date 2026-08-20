# Paper Notes Importer Design

## Goal

Add an admin-only **Paper Notes Importer** under **Menu → Imports & Data → Paper notes** so old handwritten booking-agent call sheets can be photographed on a phone, read by the configured image-capable AI provider, checked against existing Command Center records, corrected, and imported safely.

The feature is for working paper such as dated phone-call lists, event names, contact names, phone numbers, extensions, event dates, outcomes, shorthand, crossed-out values, stars, and old reminders such as `call Monday`.

The importer must preserve the difference between historical paper context and current CRM work:

- A page heading such as `Phone Calls — April 22, 2026` may provide the historical activity date for entries beneath it.
- A heading such as `Monday Call List` is page context, not an event and not a current task.
- `Left message`, `sent email`, or `talked with Morgan` are historical activities.
- `Call Monday`, `try again`, or `call after the 15th` are old written reminders. They remain in the imported historical note unless the user explicitly creates a new current follow-up with a new absolute due date.
- A star has no CRM status, priority, icon, or favorite behavior. When confirmed, it contributes only the sentence `Starred on original paper.` to the imported note.
- Phone numbers, extensions, labels, contacts, and calling instructions remain separate structured values.

Nothing extracted from a page may change a profile, contact, phone record, location, history, or follow-up until the user reviews the full batch and presses **Import Approved Entries**.

## Confirmed product decisions

1. The feature lives in **Imports & Data**.
2. Release 1 accepts phone-camera images and multiple **JPEG, PNG, and WebP** files.
3. PDF support is deferred.
4. Imports are persistent saved batches; closing or refreshing the browser does not lose uploaded pages or review work.
5. Review is batch-first. Corrections and approvals are saved, but CRM writes happen only at the final import step.
6. An unmatched entry can create a new event profile and contact during the final import.
7. Existing profiles, contacts, and locations can be selected when they are the right destination.
8. Original page images remain private and available as provenance after import.
9. Old reminder text does not become a current follow-up automatically.
10. Stars are recorded only in the historical note.
11. Phone extensions and calling instructions are structured, not flattened into generic note text.
12. Approved CRM changes are imported in one database transaction and are safe to retry.

## Product principles

### Source preserving

The original page is the evidence. Every extracted entry retains a link to its source page, the original transcription, and the relevant page region when available. User corrections do not destroy the extraction that produced them.

### No silent writes

AI may segment and transcribe a page, and deterministic matching may rank possible destinations, but neither may create, link, overwrite, deactivate, merge, or schedule anything without an explicit review decision.

### Uncertainty is visible

Unreadable digits, questionable names, partial dates, crossed-out text, conflicting values, and weak matches are highlighted. Missing characters stay missing; the system never fills them by guessing.

### Historical and current work stay separate

Paper reminders are historical source text. Creating a current follow-up is a separate opt-in control that starts off and requires a new absolute date.

### Phone fidelity

A phone number is not one generic string. Number, extension, type, label, contact/location ownership, calling instructions, primary status, and active/questionable/inactive status are represented separately.

### Mobile first

The upload and review experience must work comfortably from a phone. Dense pages are shown as one review card at a time, with clear save state and large controls.

### Persistent and retry safe

Uploads, extraction progress, corrections, approvals, and import results are server-backed. Browser refreshes, temporary disconnection, server restarts, and repeated final-import requests must not create duplicates.

### Private by default

Real handwritten pages contain personal and business contact information. Images are private objects, signed links are short-lived, page contents are not logged, and real user pages are never committed as test fixtures.

## Release 1 scope

### Included

- Admin-only navigation and API access.
- Optional batch naming.
- Phone camera and multi-select JPEG, PNG, and WebP upload.
- Page preview, removal, reordering, and 90-degree rotation before extraction.
- Private original-image storage plus a normalized analysis derivative.
- Persistent batches, pages, entries, progress, corrections, decisions, and results.
- Background page extraction with restart-safe leases.
- Page-heading recognition and per-entry segmentation.
- Structured extraction of event, location, contact, date, phone, extension, call outcome, reminder, star, crossed-out, and general-note information.
- Field-level warnings and deterministic validation.
- Existing-profile, location, and contact matching with evidence explanations.
- New standalone event profile creation.
- New organization location creation under an existing profile when that is the correct model.
- Optional existing event-family assignment when creating a new profile.
- New contact creation and organization/contact relationship creation.
- Structured contact and organization/location phone imports.
- Explicit conflict decisions for saved versus paper values.
- Historical paper-note activity creation.
- Optional current follow-up creation, off by default.
- All-or-nothing final CRM import with idempotency and stale-data preflight.
- Completed-batch summaries and source links from imported profile history.
- Retry, manual-entry, skip, and page-reviewed-with-no-entries recovery paths.

### Deferred

- PDF and multi-page document upload.
- Automatic bulk approval.
- Manager-portal access.
- Fully offline extraction.
- Automatic handwriting learning.
- Automatic multi-page entry merging.
- Automatic decisions about crossed-out values.
- Automatic creation of bookings/calendar events from dates found on paper.
- Automatic conversion of relative reminders into due dates.
- Deleting completed source records.
- Advanced cleanup beyond orientation, rotation, bounded resizing, and compression for analysis.

## User experience

## Navigation and routes

Add **Paper notes** to the existing **Imports & Data** menu group.

Recommended routes:

- `/settings/paper-notes` — Paper Notes Inbox
- `/settings/paper-notes/:batchId` — Batch Review

The route naming follows the existing Act! import and recovery placement without treating paper imports as part of Act! migration.

## Paper Notes Inbox

The inbox has three sections.

### New import

The user can:

1. Enter an optional name such as `Old Monday call lists`.
2. Take a photo or select multiple images.
3. Preview pages.
4. Remove accidental photos.
5. Reorder pages.
6. Rotate a page in 90-degree increments.
7. Press **Read Paper Notes**.

The first release should use a conservative configurable batch limit, defaulting to 25 pages, and the existing 12 MB per-image limit. The UI explains that a larger stack can be divided into multiple batches.

The browser uploads pages one at a time so a failed upload can be retried without restarting the entire batch. A batch remains `draft` until every retained page is safely stored.

### In review

Each active batch card shows:

- batch name or generated date label,
- number of pages,
- current extraction stage,
- extracted entry count,
- needs-review count,
- ready count,
- approved count,
- skipped count,
- failed/retry page count,
- last updated time.

Opening the card resumes exactly where the user left off.

### Completed

Completed cards show:

- imported date,
- number of profiles created,
- number of existing profiles updated,
- contacts created or linked,
- phones added or changed,
- historical notes created,
- current follow-ups explicitly created,
- skipped entries,
- source pages.

Completed batches can be archived from the active list but not deleted in release 1.

## Upload and page preparation

The file input accepts `image/jpeg`, `image/png`, and `image/webp`, supports multiple selection, and uses `capture="environment"` where the browser supports it.

The server validates both the declared MIME type and the file signature. User filenames are metadata only and are never used as object keys.

The original bytes are stored unchanged. The server also creates a bounded analysis derivative that applies EXIF orientation and the user-selected rotation, then resizes/compresses the image within provider-safe limits. Extraction uses the derivative; source viewing can switch between the normalized page and the untouched original.

Changing rotation after extraction invalidates that page's extracted entries and requires a clearly confirmed re-read. It does not mutate or replace the original object.

## Extraction progress

After **Read Paper Notes**, the batch can be left open or closed. Progress is saved on the server and can display messages such as:

- `Preparing page 3 of 12`
- `Finding entries on page 3`
- `Reading entry 7 of 18`
- `12 pages complete · 2 entries need extra review`

A failure on one page does not discard successfully processed pages. The page offers:

- **Retry reading**,
- **Add entry manually**,
- **Mark page reviewed — no importable entries**.

The batch moves to review when every page is in a terminal reviewable state: extracted, needs retry, or explicitly reviewed/ignored.

## Two-stage handwriting extraction

Dense call sheets should not rely on one giant full-page transcription. Extraction uses two stages.

### Stage 1: page context and segmentation

The provider receives the normalized page and returns bounded JSON containing:

- page heading,
- explicit page activity date when present,
- page-level notes,
- ordered entry regions using normalized `x`, `y`, `width`, and `height` values,
- a rough transcription for each region,
- an indication that an entry may continue outside its region or onto another page.

Coordinates are suggestions, not trusted facts. They are validated to remain inside the page. Invalid or missing regions fall back to the full-page viewer.

### Stage 2: per-entry structured extraction

The server crops each valid region from the normalized page and asks the provider for structured entry data. This second pass improves readability and gives the review UI a meaningful source crop.

Each result contains raw text plus structured candidates. A strict schema parser rejects malformed output. The service may make at most one bounded automatic retry for malformed JSON or a transient provider failure; it does not loop indefinitely.

The AI client image-completion contract should be extended to accept an optional token budget because dense paper entries need more output than receipt extraction. Existing receipt extraction keeps its current behavior and tests.

## Extracted entry data

The immutable extraction payload should represent the following concepts without pretending every page supplies every field:

```ts
export type PaperNoteExtraction = {
  transcription: string;
  sourceRegion: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  event: {
    name: string | null;
    city: string | null;
    region: string | null;
    venue: string | null;
  };
  eventDates: Array<{
    rawText: string;
    startsOn: string | null;
    endsOn: string | null;
    derivedFromPageYear: boolean;
  }>;
  activity: {
    rawDateText: string | null;
    occurredOn: string | null;
    dateSource: "entry" | "page_heading" | "unknown";
    method: "call" | "email" | "mail" | "text" | "unknown";
    outcome: string | null;
    summary: string | null;
  };
  contacts: Array<{
    name: string | null;
    role: string | null;
    email: string | null;
    phones: Array<{
      number: string | null;
      extension: string | null;
      type: "mobile" | "office" | "alternate" | "unknown";
      label: string | null;
      instructions: string | null;
      crossedOut: boolean;
    }>;
  }>;
  organizationPhones: Array<{
    number: string | null;
    extension: string | null;
    type: "mobile" | "office" | "alternate" | "unknown";
    label: string | null;
    instructions: string | null;
    crossedOut: boolean;
  }>;
  oldReminder: string | null;
  starredOnPaper: boolean;
  generalNotes: string[];
  warnings: Array<{
    fieldPath: string;
    message: string;
    severity: "warning" | "blocking";
  }>;
};
```

The provider may label uncertain text, but deterministic validators create the authoritative warnings used by the UI. Examples include:

- a phone number with too few or too many digits,
- an extension containing implausible characters,
- an invalid email shape,
- an unparseable date,
- a state that is not a two-letter code,
- crossed-out information,
- an entry name missing entirely,
- a page-derived year that needs confirmation.

No numeric model confidence score is treated as proof.

## Date handling

Dates on these pages have different meanings and must remain separate.

### Page activity dates

A full page heading such as `Phone Calls April 22, 2026` can suggest April 22, 2026 as the historical activity date for an entry that has no more specific activity date. The review card labels this as **From page heading**.

A heading such as `Monday Call List` does not supply a date.

### Event dates

An entry may say `June 22` while the page heading says April 2026. The importer may suggest June 22, 2026 as an event-date interpretation, but it must mark `derivedFromPageYear=true` and require review. It is not silently confirmed.

Event dates imported in release 1 are preserved in the historical note. They do not create a booking, calendar entry, or route segment.

### Relative reminders

`Call Monday`, `try next week`, and `call after the 15th` are never resolved into dates. The exact old wording is preserved.

### Unknown historical dates

A paper note can still be imported when its historical date is unknown. The resulting activity uses:

- `occurredAt = null`,
- `timelineSortAt = importedAt`,
- `dateIsImportFallback = true`,
- `sourceType = "paper_note"`.

The timeline displays **Historical date unknown · imported [date]**, not the import date as though it were the call date.

This requires paper-note provenance to be an allowed exception to the current local-activity `occurredAt` constraint.

## Batch review screen

The review screen is optimized for one card at a time on mobile, with a compact list/filter drawer for navigation.

Filters:

- Needs review
- Ready
- Approved
- Skipped
- All

Each entry card contains four areas.

### 1. Source

- cropped normalized page region when available,
- **View full page**,
- **View original image**,
- page heading and page activity date,
- page number and original filename,
- original rough transcription,
- a warning when content may continue outside the crop.

### 2. Editable paper interpretation

The user can correct:

- event/profile name,
- city, state, and venue,
- event-date text and normalized date suggestion,
- historical activity date and method,
- contact names and roles,
- emails,
- phone numbers,
- extensions,
- phone types and labels,
- calling instructions,
- call/email outcome,
- general note text,
- old reminder,
- `Starred on original paper` checkbox,
- whether a value was crossed out or unreadable.

Edits autosave to the server with a visible **Saving / Saved / Retry** state. Every entry has a `reviewVersion`; stale saves receive a conflict response instead of overwriting newer edits.

Changing an approved card invalidates its approval and returns it to Ready or Needs review.

### 3. Destination and matching

The user chooses one destination mode:

- **Link to existing profile**
- **Add as a location under an existing profile**
- **Create new standalone event profile**
- **Skip this entry**

When creating a profile, an existing event family may optionally be selected. The importer does not create new event families.

For an existing profile, the card can also choose an existing organization location or create a new location when the paper clearly refers to a separate city/venue occurrence.

Contacts are reviewed individually:

- link an existing contact,
- create a new contact,
- omit the contact from structured import while retaining its text in the note.

### 4. Plain-language import preview

The card states exactly what approval will do, for example:

> Add one historical paper note to Emmett Cherry Festival. Create Tina Morgan and link her to the profile. Add office number 208-555-0142, extension 3115. Create no current follow-up.

This preview is produced from server validation, not solely from client state.

## Matching behavior

Matching is deterministic and evidence based. AI extraction supplies candidate values, but the matching service owns ranking.

Search existing:

- organizations/event profiles,
- organization locations,
- contacts,
- contact phones,
- organization/location phones,
- current legacy organization and contact phone fields,
- event-family names and membership context,
- parent/brand organization context.

Ranking evidence, strongest first:

1. exact normalized phone plus compatible extension,
2. exact email,
3. exact normalized event/profile name plus city/state,
4. strong event name plus venue or contact evidence,
5. strong contact name plus organization/location evidence,
6. conservative fuzzy name/location similarity,
7. weak name-only possibility.

The UI explains each result, for example:

> Strong match: same event name, city, and phone number.

> Possible brand/location match: same parent organization name; this paper entry is in a new city.

The service returns a bounded list, normally no more than five strong or plausible choices. A weak result is shown as a possibility and never preselected as an approved destination.

The user always makes the final link/create/location decision.

## Conflict review

The importer never silently overwrites saved data.

When reviewed paper data differs from the selected target, the card shows both versions and requires an explicit decision for each writable field.

### Phone decisions

- Keep saved phone
- Treat as the same phone and update extension/label/instructions
- Add paper phone as alternate
- Replace primary phone
- Mark saved phone inactive and add paper phone
- Add paper phone as questionable
- Ignore paper phone
- Keep crossed-out value in the historical note only

`Bad number` or `mailbox full` is first saved as historical outcome text. Changing a phone's active/questionable/inactive state is a separate explicit decision. `Bad number` never becomes Do Not Call automatically.

### Contact/email decisions

- Keep saved value
- Replace saved value
- Ignore paper value and retain it in the historical note

Release 1 does not add a multi-email table. An additional conflicting email can replace the existing email, be used on a new contact, or remain note-only.

### Profile/location decisions

- Keep saved value
- Replace saved value
- Create/use a separate organization location
- Ignore paper value and retain it in the historical note

Crossed-out data starts as blocking or warning review data and never causes automatic deletion, replacement, or deactivation.

## Entry states and approval

Entry states:

- `needs_review` — blocking validation, unresolved destination, or unresolved conflict
- `ready` — valid and fully decided, but not approved
- `approved` — explicitly approved for final import
- `skipped` — intentionally excluded
- `imported` — successfully applied with the batch

An entry can be approved only when server validation finds:

- a destination or explicit skip,
- required new-profile/location/contact names,
- valid IDs for linked targets,
- every conflict decision resolved,
- no unreadable value being treated as a required structured value,
- a current absolute due date when current follow-up is enabled.

The final batch import is available only when every extracted/manual entry is either approved or skipped, every failed page has been retried or explicitly reviewed, and at least one entry is approved.

## Historical note format

Every imported entry creates one source-linked history activity. The body is composed from reviewed values and preserves historical context.

Example:

> **Imported from paper notes**  
> Historical activity: Called April 22, 2026. Spoke with Tina. No room this year; requested information by email.  
> Event date noted: June 22, 2026 (year interpreted from page context and confirmed during review).  
> Phone noted: Fair office 208-555-0142, extension 3115. Ask for events department.  
> Original reminder: Call Monday. This was a historical reminder and was not added as a current task.  
> Starred on original paper.  
> Original transcription: …

Rules:

- The star sentence appears only when the reviewed checkbox is on.
- No favorite, priority, or special star metadata is written to the CRM.
- The old reminder appears even when the user separately creates a current follow-up.
- When a new follow-up is created, the note states its actual new date rather than suggesting the old relative reminder was reused.
- The original transcription is retained even when fields were corrected.
- The activity links back to the paper-note entry/page rather than copying the image into each profile.

Use `kind = "note"`, `subject = "Imported from paper notes"`, and `sourceType = "paper_note"`. A nullable unique `paperNoteEntryId` on activities provides provenance and duplicate protection.

Profile timelines should show a **View source paper** action for paper-note activities. The action obtains a new owner-authorized short-lived signed URL.

## Current follow-up behavior

Each entry has **Create a current follow-up** off by default.

Turning it on requires:

- an absolute due date selected now,
- a follow-up kind,
- an organization destination,
- optional linked contact/location.

The due date is never inferred from `Monday`, `next week`, `after the 15th`, or the upload date.

The follow-up is created separately from the historical activity and is included in the plain-language preview and final summary.

## Data model

The feature adds three core paper-note tables plus structured organization phones and small provenance/phone extensions to existing tables.

## `paper_note_batches`

Suggested fields:

- `id`
- `name` nullable
- `status`: `draft | queued | extracting | review | importing | imported | failed | archived`
- `created_by` or owner actor label
- `page_count`
- `import_request_key` nullable unique
- `import_summary` JSONB nullable
- `failure_code` nullable
- `failure_message` nullable safe text
- `extraction_started_at` nullable
- `review_started_at` nullable
- `import_started_at` nullable
- `imported_at` nullable
- `created_at`
- `updated_at`

Counts shown by the UI may be queried from pages/entries rather than trusted from denormalized counters. Any counters stored for performance must be transactionally maintained or treated as cache only.

## `paper_note_pages`

Suggested fields:

- `id`
- `batch_id` foreign key, cascade for draft deletion
- `sort_order`
- `original_filename`
- `mime_type`
- `size_bytes`
- `width` nullable
- `height` nullable
- `rotation_degrees`: `0 | 90 | 180 | 270`
- `original_object_key`
- `analysis_object_key` nullable
- `sha256`
- `status`: `uploading | uploaded | queued | extracting | extracted | needs_retry | reviewed_empty`
- `current_stage`: `prepare | segment | extract_entries | complete` nullable
- `page_heading` nullable
- `page_activity_date` nullable
- `page_context` JSONB
- `rough_transcription` nullable
- `attempt_count`
- `lease_token` nullable
- `lease_expires_at` nullable
- `last_error_code` nullable
- `last_error_message` nullable safe text
- `extracted_at` nullable
- `created_at`
- `updated_at`

Use a unique `(batch_id, sort_order)` constraint and duplicate-file protection with `(batch_id, sha256)`.

## `paper_note_entries`

Suggested fields:

- `id`
- `batch_id`
- `page_id`
- `source_order`
- `source_region` JSONB nullable
- `extraction_payload` JSONB immutable after extraction/retry replacement
- `review_payload` JSONB
- `review_version` integer
- `state`: `needs_review | ready | approved | skipped | imported`
- `destination_mode`: `existing_profile | existing_profile_new_location | new_profile | skip`
- `selected_organization_id` nullable
- `selected_organization_location_id` nullable
- `target_snapshot` JSONB nullable
- `validation_issues` JSONB
- `approved_at` nullable
- `imported_organization_id` nullable
- `imported_organization_location_id` nullable
- `imported_activity_id` nullable
- `import_result` JSONB nullable
- `created_at`
- `updated_at`

`review_payload`, `destination_mode`, and selected IDs are validated together on every mutation. Client-supplied `validation_issues`, state transitions, import previews, and import results are never trusted.

Manual entries use the same table with an extraction payload indicating `source = "manual"`; they still retain a page link and source transcription.

## `organization_phones`

A structured organization/location phone table is required because a main office or event hotline should not require a fake contact.

Suggested fields:

- `id`
- `organization_id`
- `organization_location_id` nullable
- `number`
- `normalized_number`
- `type`: `mobile | office | alternate | unknown`
- `extension` nullable
- `label` nullable
- `instructions` nullable
- `status`: `active | questionable | inactive`
- `primary` boolean
- `source`: `local | legacy_backfill | paper_note`
- `source_paper_note_entry_id` nullable
- `created_at`
- `updated_at`

Constraints:

- nonblank number,
- a location must belong to the same organization,
- normalized-number indexes for matching,
- uniqueness for the same organization/location, normalized number, and normalized extension,
- one active primary general phone per organization,
- one active primary phone per organization location.

The migration backfills existing `organizations.phone` values as active primary general organization-phone records when possible. The legacy `organizations.phone` and `normalized_phone` fields remain synchronized from the active primary general phone for compatibility.

## Existing phone-table extensions

Extend `contact_phones` with:

- `instructions` nullable,
- `status`: `active | questionable | inactive`, default active,
- `source_paper_note_entry_id` nullable.

Existing Do Not Call fields remain distinct. An invalid, old, or questionable number is not automatically a legal/preference Do Not Call number.

Legacy `contacts.phone` synchronization should use the active primary contact phone. Inactive numbers remain visible in profile details and provenance but are excluded from default dial actions.

## Activity provenance

Extend `activities` with:

- `paper_note_entry_id` nullable unique foreign key,
- allow `source_type = "paper_note"`,
- allow `occurred_at` to be null when `paper_note_entry_id` is present,
- retain required `timeline_sort_at` and `date_is_import_fallback` behavior.

The timeline/repository response should expose enough paper-note source metadata to render **View source paper** and the correct unknown-date label without exposing storage object keys.

## Architecture

## Frontend

Recommended components:

- `PaperNotesInboxPage`
- `PaperNoteBatchReviewPage`
- `PaperNoteUploadPanel`
- `PaperNoteBatchCard`
- `PaperNoteProgress`
- `PaperNoteEntryNavigator`
- `PaperNoteEntryCard`
- `PaperNoteSourceViewer`
- `PaperNoteDestinationPicker`
- `PaperNoteContactEditor`
- `PaperNotePhoneEditor`
- `PaperNoteConflictReview`
- `PaperNoteImportPreview`
- `PaperNoteBatchPreflightDialog`
- `PaperNoteImportSummary`

A feature-local client module owns request/response schemas and API calls. React Query handles inbox/batch loading and polling. Draft field edits use versioned autosave rather than keeping the only copy in component state.

The upload screen may retain not-yet-uploaded local files in memory, but once a page upload succeeds, the server is the source of truth.

## API routes

All paper-note routes are mounted after owner authentication middleware.

Recommended contract:

- `POST /paper-notes/batches`
- `GET /paper-notes/batches`
- `GET /paper-notes/batches/:batchId`
- `DELETE /paper-notes/batches/:batchId` — draft/unimported only
- `POST /paper-notes/batches/:batchId/pages`
- `PUT /paper-notes/batches/:batchId/pages/:pageId/image` — raw image body
- `PATCH /paper-notes/batches/:batchId/pages` — order/rotation metadata
- `DELETE /paper-notes/batches/:batchId/pages/:pageId` — before extraction/import
- `POST /paper-notes/batches/:batchId/extract`
- `POST /paper-notes/batches/:batchId/pages/:pageId/retry`
- `POST /paper-notes/batches/:batchId/pages/:pageId/manual-entry`
- `POST /paper-notes/batches/:batchId/pages/:pageId/reviewed-empty`
- `PATCH /paper-notes/entries/:entryId` — versioned reviewed payload and destination
- `POST /paper-notes/entries/:entryId/approve`
- `POST /paper-notes/entries/:entryId/unapprove`
- `POST /paper-notes/entries/:entryId/skip`
- `GET /paper-notes/entries/:entryId/matches`
- `GET /paper-notes/entries/:entryId/source-url`
- `POST /paper-notes/batches/:batchId/preflight`
- `POST /paper-notes/batches/:batchId/import`
- `POST /paper-notes/batches/:batchId/archive`

The exact endpoint grouping may be adjusted during planning, but the behavioral boundaries remain: upload, extraction, review, matching, preflight, and import are separate operations.

## Private object storage

Create a paper-note storage adapter using the existing Google Cloud credentials and bucket configuration, with object keys under a dedicated prefix such as:

```text
paper-notes/{batchId}/{pageId}/original
paper-notes/{batchId}/{pageId}/analysis
```

Requirements:

- private objects only,
- no public ACL,
- non-guessable UUID path segments,
- short-lived signed read URLs, default 15 minutes,
- `private, max-age=0, no-store` metadata,
- delete support for draft cleanup,
- no object key returned directly to the browser,
- no real image bytes in logs.

The upload operation is complete only after storage succeeds and the database page row is updated. Draft deletion removes objects first; if object deletion fails, the database record remains so cleanup can be retried.

## Extraction provider

Add a feature-specific `PaperNoteExtractionProvider` interface over the existing configured AI completion client.

Responsibilities:

- build unambiguous segmentation and entry-extraction prompts,
- send only the current analysis image/crop,
- request JSON only,
- parse strict schemas,
- bound output size and retries,
- strip code fences but not attempt speculative text repair,
- return provider-unavailable separately from malformed-output and transient failures,
- avoid logging prompts, images, or output containing contact details.

Prompt rules explicitly state:

- webpages or external instructions are irrelevant; read only the supplied image,
- page headings are context, not event entries,
- do not invent missing digits or letters,
- separate event dates from communication dates,
- preserve extensions and calling instructions,
- identify old reminder wording without scheduling it,
- star means only `starredOnPaper=true`,
- crossed-out text is evidence to review, not a replacement decision,
- return raw text alongside structured fields.

## Background worker

Extraction uses a database-backed worker in the existing API process.

Worker properties:

- single-flight startup,
- default concurrency of one page,
- short transactions to claim work,
- lease token and expiry on claimed pages,
- no connection held during model calls,
- `FOR UPDATE SKIP LOCKED` or equivalent claim behavior,
- expired leases become retryable after a server restart,
- bounded polling with no overlapping loop,
- page-level attempt limits,
- structured logs containing IDs, stage, duration, and counts but no paper content.

Recent database-pressure protections must not be bypassed. The worker should sleep when no queued page exists and avoid spawning one worker per browser request.

## Matching service

The matching service receives a validated reviewed candidate and returns ranked existing targets plus evidence strings.

It should reuse existing normalization helpers and relationship/profile query patterns where possible. It must not call the AI provider to make the final match decision.

The service should query exact phone/email candidates first, then bounded name/location candidates, and score them in application code. This avoids an unbounded scan and does not require a new fuzzy-search extension solely for release 1.

Brand/parent/location and event-family context are returned to help avoid duplicate local profiles such as one profile per city for the same multi-location organization.

## Review service

The review service owns:

- extraction-to-review payload initialization,
- typed review-payload validation,
- deterministic warnings,
- destination validation,
- conflict detection,
- target snapshots,
- import-preview generation,
- state transitions,
- approval invalidation after edits.

A target snapshot stores fingerprints only for values that informed a conflict decision, such as the selected organization's name/city/phone or selected contact's email/phones. Unrelated profile updates do not block import.

## Final import service

The final import is one protected database transaction for every approved entry in the batch.

High-level sequence:

1. Lock the batch and verify it is reviewable, not already imported, and not currently importing under another key.
2. Validate the supplied request key and persist/reuse it for idempotency.
3. Lock approved entries and re-run server validation.
4. Verify every other entry is skipped and every page is resolved.
5. Re-read selected target fields and compare review fingerprints.
6. Stop before any write when a target changed in a way that invalidates a decision; return the affected entries to `needs_review` with a specific issue.
7. For each approved entry:
   - link or create the organization profile,
   - use or create the organization location,
   - assign an existing event family when explicitly chosen,
   - link or create contacts and relationships,
   - apply only explicit profile/contact conflict decisions,
   - add/update structured contact and organization/location phones,
   - create one paper-note activity with `paperNoteEntryId`,
   - create a current follow-up only when explicitly enabled,
   - write audit/provenance information,
   - store the entry import-result summary.
8. Mark entries imported.
9. Store the batch import summary and mark the batch imported.
10. Commit.

No storage write or AI request happens inside this final transaction.

If any write fails, the transaction rolls back. Review work, images, approvals, and the request key remain available for a safe retry. A repeated successful request returns the stored summary rather than importing again.

## Import semantics

## Profiles and locations

### Existing profile

Attach the historical activity to the selected organization and optional location. Apply only explicitly approved field changes.

### New standalone profile

Create an organization with `placeType = "festival_event"`, reviewed name, and optional reviewed location fields. Do not create a booking automatically.

### New location under existing profile

Create an `organization_locations` row under the chosen organization using reviewed label/city/state/venue/address/phone context. Attach the history and location-scoped phone records to that location.

### Event family

When creating a standalone profile, the user may choose an existing event family. No family is inferred or created automatically.

## Contacts

For each reviewed contact:

- link an existing contact or create a new one,
- preserve role through the existing organization-contact relationship,
- set primary only when explicitly selected,
- do not overwrite existing name/email/phone without the reviewed conflict decision,
- permit omission from structured records while retaining the contact text in the historical note.

## Phones

Phone import uses a single application service for normalization, duplicate detection, primary selection, legacy-field synchronization, and status changes.

Rules:

- number and extension are separate,
- labels and instructions remain separate,
- general office/event numbers use `organization_phones`,
- named-person numbers use `contact_phones`,
- location-specific numbers include `organization_location_id`,
- exact existing number/extension pairs are enriched only with explicit review choices,
- a new primary demotes the previous primary in the same scope,
- inactive numbers are not default dial targets,
- questionable numbers remain dialable only with a visible warning,
- crossed-out numbers are note-only unless the user explicitly imports or deactivates them,
- `bad number` never sets Do Not Call automatically.

## Activities

One historical activity is created per approved paper entry, even when the entry creates several contacts or phones. This keeps the page narrative intact and prevents a noisy timeline of one activity per field.

The activity links to the organization and, when applicable, the primary reviewed contact, location, and paper-note entry.

## Follow-ups

A current follow-up is separate and optional. It links to the selected organization, optional contact/location, and has a new absolute due date. No current follow-up is created by default.

## Stale-data and concurrency protection

Review can last days while the CRM changes elsewhere.

Each conflict decision stores fingerprints of the exact values reviewed. Final preflight compares those fingerprints to current values.

When a relevant value changed, import stops before writes and the card receives a message such as:

> This phone number changed after you reviewed the paper entry. Choose which version to keep.

The system does not block on unrelated `updatedAt` changes alone.

Entry edits use optimistic versioning. Batch import uses row locks plus a unique request key. Activity `paperNoteEntryId` and phone source/deduplication constraints provide additional duplicate protection.

## Error handling

### AI unavailable

Keep all images and batch metadata. Mark queued pages retryable and show **AI reading is unavailable right now** rather than losing the batch.

### Page extraction failure

Continue other pages. Preserve a safe error code and retry count. Offer retry, manual entry, or reviewed-empty.

### Malformed model output

Reject it. Make at most one bounded automatic retry. Do not save partially parsed guesses as reviewed facts.

### Upload failure

Keep successful page uploads. Retry only the failed page. A page is not marked uploaded until private storage succeeds.

### Lost browser connection

Server-backed extraction continues. Previously acknowledged review saves remain. Unsaved field edits show a retry state rather than pretending they were saved.

### Stale review

Return specific entry IDs and issues. Do not partially import other entries.

### Final transaction failure

Roll back all CRM changes. Leave the batch in review with a safe error and the same idempotency key available for retry.

### Missing source object

Block approval/import for affected entries until the source is restored, the page is retried, or the entry is skipped. Imported history must never claim source provenance that cannot be opened.

## Security and privacy

- All routes require owner/admin authentication.
- Validate MIME header, signature, size, dimensions, and decoded-image safety.
- Reject unsupported or corrupt files with plain-language errors.
- Store original and analysis images privately.
- Use UUID object keys, never contact/event names.
- Signed URLs are short-lived and owner-authorized.
- Do not log image bytes, base64, transcription, phone numbers, emails, or note bodies.
- Store only bounded safe provider error excerpts, never raw provider payloads containing page content.
- Do not send an entire batch to the model; send one page or crop at a time.
- Do not commit real pages to GitHub, snapshots, fixtures, or CI artifacts.
- Synthetic fixtures must use fictional names and non-routable/example contact data.
- Draft deletion is explicit and removes storage objects before database rows.
- Completed batches are archived, not deleted, in release 1 so imported provenance remains valid.

## Accessibility and mobile behavior

- Controls meet touch-target expectations.
- Status is communicated by text/icon, not color alone.
- Every input has a visible label.
- The source viewer has alt text and keyboard-close behavior.
- Entry filters and next/previous controls are keyboard accessible.
- Focus returns to the invoking control after dialogs.
- The final import dialog announces blocking issues and summary counts.
- The mobile layout shows source first, then fields, destination, conflicts, and preview; desktop may use a split source/review layout.
- Long phone numbers, emails, and transcriptions wrap without horizontal page scrolling.

## Observability

Structured logs may include:

- batch ID,
- page ID,
- entry ID,
- worker stage,
- provider name,
- attempt number,
- duration,
- extracted-entry count,
- validation count,
- import entity counts,
- safe error code.

Logs must not include handwritten content or extracted personal data.

Operational metrics should make it possible to answer:

- how many pages are queued/extracting/retryable,
- average page/entry extraction duration,
- malformed-response rate,
- provider-unavailable rate,
- batches waiting for review,
- import success/rollback count.

## Testing strategy

Development follows test-first implementation.

## Extraction/parser tests

- page heading is not treated as an event,
- multiple event regions are ordered correctly,
- invalid regions fall back safely,
- `Phone Calls April 22, 2026` becomes page context,
- `Monday Call List` does not invent a date,
- event date and call date remain separate,
- page-derived event year is flagged,
- `call Monday` becomes `oldReminder`, not a due date,
- star becomes only `starredOnPaper=true`,
- phone number and extension are separate,
- office/mobile/alternate labels are preserved,
- calling instructions are preserved,
- crossed-out values are warnings and not decisions,
- unreadable digits remain null/partial and blocking,
- malformed JSON is rejected,
- bounded retry behavior,
- provider-unavailable behavior,
- existing receipt extraction remains unchanged after image-client token-budget extension.

## Matching tests

- exact contact phone and extension ranks first,
- exact organization phone ranks first,
- exact email match,
- same event name/city/state match,
- similar names in different cities remain separate possibilities,
- parent organization plus new city suggests location mode,
- event-family context helps explain but never auto-links,
- existing event plus new contact,
- weak name-only match remains unselected,
- inactive/questionable phone behavior,
- legacy organization/contact phone fields remain matchable during transition.

## Review-service tests

- extraction payload remains immutable,
- corrections persist through reload,
- stale review versions are rejected,
- editing invalidates approval,
- unresolved destination blocks approval,
- unresolved conflict blocks approval,
- current follow-up requires an absolute date,
- skipped entries need no destination,
- server-generated import preview matches decisions,
- real source object is required.

## Import-service tests

- create standalone event profile,
- link existing profile,
- create location under existing profile,
- optional existing event-family membership,
- create/link contacts and roles,
- create contact phone with extension,
- create organization/location phone with extension and instructions,
- keep/add/replace/inactivate/questionable phone choices,
- legacy primary phone synchronization,
- historical note composition,
- star sentence appears only when selected,
- old reminder remains historical,
- no follow-up by default,
- explicit current follow-up creation,
- unknown historical date behavior,
- source-linked activity and signed-source authorization,
- stale target fingerprint stops all writes,
- one-entry failure rolls back the batch,
- repeated request key returns prior summary,
- unique paper-note activity prevents duplicates,
- completed batch cannot be imported again.

## API and frontend tests

- admin authentication on every route,
- multi-image selection and sequential upload,
- unsupported/corrupt/oversized image errors,
- remove/reorder/rotate draft pages,
- leave and resume a batch,
- extraction polling and partial page failure,
- source crop/full-page viewer,
- edit and autosave state,
- match explanation display,
- destination modes,
- conflict controls,
- filters and entry navigation,
- all entries approved/skipped requirement,
- final preflight dialog,
- completed summary and profile source link,
- accessible labels/focus for dialogs and status messages.

Real user pages are never test fixtures. Unit tests use mocked provider JSON. Integration/UI tests use synthetic images with fictional events, extensions, stars, crossed-out values, and old reminders.

## Migration and rollout

1. Add schema migration for paper-note tables, organization phones, contact-phone status/instructions/provenance, and activity paper-note provenance.
2. Backfill existing organization main phones without replacing current legacy values.
3. Update phone services and profile/calling reads to understand structured organization phones and phone status.
4. Add storage adapter and extraction provider contract.
5. Add worker with single-flight and low-pressure defaults.
6. Add owner API routes and feature services.
7. Add inbox/review UI and Imports & Data navigation.
8. Add profile-timeline source viewing.
9. Run focused tests, package typechecks/builds, database migration tests, and full relevant regression suites.

The page remains visible when AI or storage configuration is missing, but it shows an actionable configuration/unavailable state. Existing CRM, Act! import, receipt extraction, and manager features must continue to operate.

## Acceptance criteria

The release is complete when:

1. An admin can open **Imports & Data → Paper notes** on a phone.
2. The admin can photograph or select several supported images and safely resume after leaving the screen.
3. The app preserves private originals and reads dense pages into separate source-linked event cards.
4. Page headings, activity dates, event dates, old reminders, stars, crossed-out values, phone numbers, and extensions are represented according to this design.
5. Low-quality or uncertain handwriting is visible and never silently guessed.
6. Existing profiles/locations/contacts are ranked with explanations, but the user chooses the destination.
7. An unmatched entry can create a new standalone profile, a new location under an existing profile, and new contacts during final import.
8. General office/event phones and named-contact phones retain number, extension, type, label, instructions, status, and provenance.
9. Saved values are not overwritten or deactivated without explicit conflict decisions.
10. `Call Monday` and similar wording remain historical unless the user separately creates a current follow-up with a new date.
11. A confirmed star contributes only `Starred on original paper.` to the historical note.
12. No CRM record changes before **Import Approved Entries**.
13. Final import is all-or-nothing, stale-data aware, and idempotent.
14. Imported timeline items can open the private source page with a short-lived authorized link.
15. A failed page, provider outage, browser refresh, server restart, or repeated import request does not lose work or duplicate CRM data.
16. Completed batches show exactly what was created, linked, updated, skipped, and scheduled.
17. CI uses only synthetic/redacted fixtures and no real paper-note images or extracted personal data.
