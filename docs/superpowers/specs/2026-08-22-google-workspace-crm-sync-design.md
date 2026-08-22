# Google Workspace CRM Sync Design

**Status:** User-approved design; pending implementation plan  
**Date:** 2026-08-22

## Goal

Connect the Adventure Zone company Google account to the existing Command Center so approved business Gmail, Google Calendar events, accessible Gmail attachments, and accessible Google Drive files become organized CRM context.

The system must:

- connect business conversations, files, and calendar events to the correct organization, contact, booking, or internal filing area;
- reconstruct complete Gmail conversations using received and sent messages;
- categorize business conversations by purpose;
- copy accessible files into the Command Center's existing durable storage while preserving the original Google link;
- use email, file, and calendar information to suggest profile completion and corrections;
- perform a full historical backfill newest-first, then continue syncing changes;
- leave Gmail and Google Calendar unchanged in Release 1;
- exclude personal mail before its content is stored in the CRM;
- prevent leg-manager access to all email, file, note, and sync data;
- use deterministic rules as the authority and AI only as a limited assistant.

## Approved product decisions

### Google account and Release 1 permissions

- Gmail, Google Drive access, and Google Calendar are reached through one connected company Google account.
- Release 1 is read-only on Google's side.
- The Command Center may read approved Gmail, Calendar, and accessible Drive content.
- It may not send email, move or archive messages, change Gmail labels, delete Google content, or create/update/delete Google Calendar events.
- Gmail itself remains untouched. All organization happens inside the Command Center.

### Historical and continuous sync

- Scan the full approved Gmail and Google Calendar history.
- Process newest items first so active work becomes useful before older history finishes.
- Include both received mail and Sent Mail for complete conversations.
- After the historical backfill catches up, continuously sync new and changed business items.
- Work must be restart-safe and continue after a browser close or Render restart.

### Gmail business scope

Only the following Gmail label roots and all labels nested under them are in scope:

- `Shows`
- `Receipts`
- `Off Season Business Opportunities`
- `Employees`
- `Associations`

Personal labels and all unrelated mail are excluded by default.

Sent messages are included when they belong to an included business thread. A standalone sent message may also qualify when it is under an approved business label or is addressed to an already-known CRM contact or an explicitly approved business domain.

Exclusion is authoritative: a message under a personal exclusion must never be imported merely because its text resembles business content.

### Google Calendar scope

The following four calendar sources are included independently:

- Adventure Zone Calendar
- Pirates Rebellion Calendar
- Warriors Playground Calendar
- the separate calendar identified by `zone.pirate.warrior@gmail.com`

The fourth calendar has its own events and is not treated as a combined duplicate of the other three.

Each synchronized event preserves its source calendar. The source may be useful package or brand evidence, but it does not override conflicting event details.

### Access

- **Administrator:** full access to Google connection settings, sync status, business email, files, calendar items, internal filing areas, matching review, and profile suggestions.
- **Office Coordinator:** access to profile-related business email, complete threads, files, calendar items, internal filing areas, categories, matching review, and profile-update suggestions.
- **Leg managers:** no access to email bodies, email metadata, files, notes, Google sync status, internal filing areas, or email-derived information. This restriction must be enforced server-side, not only hidden in the UI.

## Recommended architecture

Use a **durable Google archive with profile-first presentation**.

The Command Center quietly stores normalized metadata and approved business content for Gmail threads/messages, Calendar events, and accessible files. Users primarily encounter that data through profiles and bookings rather than through a second general-purpose inbox.

A central Google Sync area exists only for:

- connection and scope settings;
- sync progress;
- unmatched or ambiguous records;
- conflicting profile facts;
- unavailable files;
- internal employee, receipt, and association filing;
- recoverable sync errors.

This architecture keeps durable identities and auditability without making the user operate a second Gmail application.

## Mechanical authority and limited AI assistance

### Mechanical responsibilities

The following behavior is deterministic and authoritative:

- included/excluded Gmail labels and Calendar sources;
- Gmail message and thread identity;
- Inbox/Sent thread reconstruction;
- Google Calendar event identity;
- file download, storage, checksums, and version identity;
- exact contact-email matching;
- approved organization-domain matching;
- previously approved thread/profile relationships;
- duplicate prevention;
- permissions;
- pause/resume and retry state;
- audit history;
- protection against silent profile overwrites;
- all writes to CRM associations and durable storage.

### AI responsibilities

AI may assist only after deterministic processing has run. It may:

- categorize a conversation as Promo & Brochures, Direct Contact, Quote or Pricing, Contract, Invoice or Payment, Vendor Application, Event Logistics, Association, Employee, Receipt, or General Business;
- summarize long threads;
- extract possible contact names, phone numbers, extensions, job titles, addresses, venues, dates, deadlines, attendance figures, quote amounts, deposits, invoice numbers, payment status, and package references;
- rank plausible profile matches when exact evidence is insufficient;
- identify a likely next follow-up date.

AI may not, by itself:

- establish ownership of a message, file, or event;
- override contradictory exact evidence;
- update CRM fields;
- send email;
- alter Google content;
- delete or hide source records;
- invent contacts, bookings, dates, or amounts.

An AI-ranked ownership candidate remains a review item unless sufficient deterministic evidence also supports the match. Extracted facts are always presented as suggestions with their source evidence.

## Data model and provenance

The implementation should add durable records conceptually equivalent to the following units. Exact table and type names may follow current repository conventions.

### Google connection and scope

Store:

- encrypted Google authorization credentials;
- connected account identity;
- selected Gmail label IDs and parent/child relationships;
- selected Calendar IDs;
- current read-only permission state;
- last successful Gmail, Drive, and Calendar cursors/tokens;
- connection errors and reauthorization state.

Google's internal label and calendar IDs are authoritative. Display names are retained for the UI, but renaming a label or calendar must not silently change scope.

### Sync runs and item processing

A sync run records:

- mode: scope preview, historical backfill, or incremental;
- source: Gmail, Calendar, Drive/file copy, or combined;
- status and stage;
- cursor/checkpoint;
- discovered, processed, connected, reviewed, ignored, unavailable, and failed counts;
- start, pause, resume, completion, and failure timestamps;
- last visible error.

Each source item has an idempotent processing record so one bad message, event, or file cannot block the entire run.

### Gmail threads and messages

Store each Google message once by Google message ID and each thread once by Google thread ID.

A thread contains:

- participants and normalized email addresses;
- subject and latest-message date;
- received/sent direction across its messages;
- approved business-scope evidence;
- full message bodies for approved business content;
- category and optional tags;
- match confidence and evidence;
- original Gmail links;
- profile/contact/booking/internal-area associations;
- source availability state;
- AI summary and extraction provenance when used.

One thread may be associated with both an organization and a specific booking without duplicating its messages.

### Calendar events

Store each Calendar event once using its Google calendar ID and event ID, with recurring-series/instance identity where applicable.

Retain:

- title, description, organizer, attendees, location, start/end, recurrence, cancellation state, and original Google link;
- source calendar;
- linked organization, contact, booking, or internal context;
- match evidence and review state;
- source-update timestamps.

A Google event linked to an existing booking remains one source event associated with that booking; it does not create a duplicate booking.

### Files and file versions

An accessible Gmail attachment or Drive-linked file is copied into the Command Center's existing Google Cloud storage.

Store:

- one logical file record;
- one or more immutable imported versions;
- content fingerprint/checksum;
- filename, MIME type, size, source date, sender/owner, and source kind;
- durable storage reference;
- original Gmail or Drive link;
- message/thread/calendar/profile/contact/booking/internal-area associations;
- availability and download error state.

The same attachment forwarded repeatedly is stored once when its content fingerprint is identical, with multiple source references. A changed Drive document creates a new imported version rather than silently replacing a prior contract, quotation, or application.

No metadata-only fake file is created when bytes cannot be obtained.

### Associations, reusable rules, and suggestions

Associations are explicit and auditable. A reusable rule may represent:

- exact email address belongs to contact;
- approved domain belongs to organization;
- Gmail thread belongs to organization or booking;
- recurring Calendar naming pattern belongs to a profile or package context.

Rules must be visible, reversible, and attributable to either deterministic import evidence or an administrator/Office Coordinator decision.

Profile suggestions retain:

- target profile/contact/booking and field;
- current value;
- suggested value;
- confidence;
- source message/file/event;
- relevant evidence excerpt;
- accepted, rejected, or pending state;
- reviewer and timestamp.

## Business-scope filtering

### Gmail

1. Resolve the configured Gmail label IDs and all descendant labels.
2. Identify messages/threads that belong to those included business labels.
3. Apply personal exclusions before storing full message content.
4. Include the Sent side of included business threads.
5. Permit qualifying standalone Sent items only through deterministic business evidence.
6. Store the scope reason for every included item.
7. Record excluded items only as aggregate counts when possible; do not retain personal content in CRM tables or AI prompts.

### Calendar

Read only the four approved Calendar IDs. Ignore calendars outside scope before event content is archived.

## Matching strategy

Matching is conservative about ownership and generous about preserving useful evidence.

### Evidence order

1. **Existing approved association:** a previously confirmed thread, address, domain, event, or recurring pattern.
2. **Exact contact email:** sender, recipient, CC, organizer, or attendee matches a saved CRM contact.
3. **Exact approved business domain:** the domain is already associated with one organization and is not a generic public provider.
4. **Exact source relationship:** a Google event/thread/file is already connected through another approved Google item.
5. **Booking evidence:** event name, event family, venue, city, address, dates, application deadline, or known booking contact agrees with one booking.
6. **Content/signature evidence:** exact organization name, phone, address, job title, or event details.
7. **AI ranking:** optional assistance for ordering unresolved candidates, never sole authority.

### Automatic filing

Automatic association is allowed only when deterministic evidence reaches a documented high-confidence threshold and no contradictory evidence exists.

Examples:

- exact saved contact email with one active organization relationship;
- previously approved thread relationship;
- exact unique approved domain plus agreeing company/event details;
- exact Calendar attendee and booking date/venue match.

### Review

Send an item to review when:

- multiple profiles remain plausible;
- evidence conflicts;
- only generic/public email domains exist;
- a new contact has no proven organization relationship;
- a Calendar event may be a booking but dates or venue disagree;
- AI suggests a match without sufficient deterministic proof.

A reviewer may connect the item, create/approve a reusable rule, leave it in an internal area, or explicitly ignore it as out of scope.

## Conversation organization

Threads receive one main category:

- Promo & Brochures
- Direct Contact
- Quote or Pricing
- Contract
- Invoice or Payment
- Vendor Application
- Event Logistics
- Association
- Employee
- Receipt
- General Business

Threads may also receive descriptive tags such as package/brand, year, needs follow-up, contract attached, or deadline approaching.

The thread stays intact even when its business stage changes. Individual messages and files preserve their own dates and source roles, while the thread displays its current category/stage and important documents.

## Internal filing areas

### Employees

Employee-related mail and files are filed in a private Employees area. They are not forced onto event profiles. An item may also link to a specific event only when clear event evidence exists.

### Business Receipts

Receipts, purchases, invoices, and expense files are filed in Business Receipts. They may additionally link to an organization, booking, trip, or package when proven.

### Associations

Association-related conversations may connect to an existing association profile. Unmatched association material remains in an Associations area until a clear profile/event relationship exists.

These areas remain visible only to the Administrator and Office Coordinator.

## Profile-first presentation

Each organization/event profile receives an **Emails & Files** area with four views.

### Conversations

Show complete Gmail threads with:

- participants;
- latest date;
- direction;
- category and tags;
- important attachments;
- associated contact, booking, and location;
- match source/confidence;
- original Gmail link.

### Files

Show durable files associated with the profile, including their versions, source conversations, original links, and any booking/contact associations.

### Calendar

Show linked Google Calendar events and their source calendar alongside relevant CRM bookings. Conflicts remain visible rather than silently resolved.

### Suggested Updates

Show proposed contact/profile/booking facts with source evidence and explicit accept/reject actions.

## ACT history deduplication

When a real Gmail message or thread clearly corresponds to an imported ACT email-history entry:

- preserve the ACT record as read-only provenance;
- link the ACT entry to the Google conversation;
- present the richer Gmail thread as the primary conversation;
- mark it as also recorded in ACT;
- avoid displaying two independent-looking copies of the same communication.

No source record is deleted to accomplish this.

## Calendar behavior

Google Calendar is read-only in Release 1.

The sync should:

- connect events to existing profiles and bookings;
- show source-calendar identity;
- recognize recurring series and instances;
- record updates and cancellations;
- surface date, venue, attendee, or description differences as review/suggestions;
- avoid creating duplicate bookings or duplicate schedule entries;
- preserve a CRM audit record if the Google event later becomes unavailable.

A conflict such as Google showing July 18–20 while the booking shows July 19–20 must be displayed for review. Neither side is silently overwritten.

## Historical backfill

The full approved history is processed newest-first in bounded, restart-safe batches.

Stages:

1. Discover message/thread/event metadata within approved scope.
2. Persist Google identities and item checkpoints.
3. Reconstruct complete Gmail threads.
4. Download accessible attachments and Drive-linked files.
5. Apply deterministic profile/contact/booking/internal-area matching.
6. Categorize conversations and optionally run the limited AI layer.
7. Create profile-update suggestions.
8. Automatically connect high-confidence deterministic matches.
9. Queue ambiguous matches, conflicts, and unavailable files.
10. Reconcile counts and advance the durable cursor.

The user can pause and resume. Closing the browser does not pause server work unless the user explicitly requests pause.

The UI displays counts such as discovered messages, processed conversations, automatic matches, review items, copied files, unavailable files, and Calendar progress.

## Incremental sync

After backfill, sync only changes since each source's saved cursor/token:

- new received and sent messages;
- replies in known threads;
- changed message/label scope state;
- new or changed attachments/Drive files;
- new, changed, cancelled, or recurring Calendar events.

Deleting or archiving something in Google does not automatically delete the durable CRM record or file copy. The Google source is marked unavailable or changed while the audit record remains.

## Review and visible states

Every synchronized item must reach a visible state:

- connected automatically;
- connected by review;
- internal filing;
- awaiting profile match;
- awaiting fact review;
- file unavailable;
- ignored as out of scope;
- retry required.

There is no hidden unlinked bucket.

Review tools support:

- choose organization/contact/booking;
- approve a reusable exact rule;
- move to Employees, Business Receipts, or Associations;
- accept/reject extracted profile facts;
- retry file download or source processing;
- explicitly ignore an out-of-scope item.

## Error handling and restart safety

- Use bounded work claims/leases so multiple workers do not double-process an item.
- Persist checkpoints before advancing a source cursor.
- Retry temporary Google, storage, AI, and database failures with increasing delay.
- A file failure does not block its conversation or the rest of the sync.
- An AI failure falls back to deterministic storage/matching and does not block the item.
- An unprocessable item remains visible with a safe error code and retry action.
- A run cannot report complete while pending/retryable work remains.
- Re-running any batch is idempotent.

## Security and privacy

- Store Google authorization credentials encrypted and server-side.
- Request only read access required for Release 1.
- Never expose credentials or refresh tokens to the browser.
- Apply Gmail/Calendar scope exclusion before storing personal content or sending text to AI.
- Store AI prompts/results only as necessary audit metadata and never include out-of-scope personal content.
- Enforce role authorization on every email, file, suggestion, internal-area, and sync endpoint.
- Leg-manager denial must be covered by direct endpoint tests, not only navigation tests.
- Log all automatic associations, reviewer decisions, fact approvals/rejections, file copies, and reusable-rule changes.

## Rollout

### Stage 1: Connection and scope preview

- Connect the company Google account with read-only permissions.
- Load Gmail label and Calendar inventories.
- Resolve the approved label descendants and four Calendar IDs.
- Show included counts and samples without beginning the full backfill.
- Confirm personal groups remain excluded.

### Stage 2: Recent-history validation

- Process the newest bounded portion of approved Gmail and Calendar history.
- Review real profile matches, categories, files, suggestions, and permissions.
- Correct rules before older history proceeds.

### Stage 3: Full historical backfill

- Continue through the complete approved business history newest-first.
- Preserve restart-safe progress and visible reconciliation counts.

### Stage 4: Continuous sync

- Enable incremental Gmail, Drive/file, and Calendar change processing.
- Monitor permission expiration, retry queues, and unmatched-item volume.

## Testing strategy

### Unit tests

Cover:

- Gmail label-tree inclusion and personal exclusion precedence;
- Sent-message inclusion rules;
- exact email/domain/thread matching;
- automatic-match confidence thresholds;
- category and tag mapping;
- AI-output validation and fallback;
- fact suggestion extraction boundaries;
- Calendar duplicate and conflict detection;
- attachment fingerprints and file-version rules;
- ACT/Gmail history linking;
- role authorization decisions.

### Database/integration tests

Prove:

- one Google message/thread/event/file identity creates one durable local record;
- replay creates no duplicates;
- forwarded identical attachments share one durable file;
- changed Drive content creates a new version;
- one thread may link to organization and booking without duplicating messages;
- exact matching files automatically while ambiguity remains in review;
- profile fields are never silently overwritten;
- pause/restart resumes from persisted checkpoints;
- a failed item does not stop neighboring work;
- totals reconcile with no hidden bucket.

### API/UI tests

Prove:

- connection scope preview lists only approved label roots/descendants and four Calendars;
- profile Conversations, Files, Calendar, and Suggested Updates views work;
- review decisions and reusable rules are durable;
- unavailable files display source context without fake placeholders;
- Employees, Business Receipts, and Associations remain private;
- Administrator and Office Coordinator have approved access;
- leg-manager endpoints return access denied even with manually constructed URLs;
- Gmail and Calendar remain unchanged during all Release 1 flows.

### Representative acceptance cases

1. A known contact's exact email automatically connects a complete Inbox/Sent thread to the profile.
2. A promotional blast is categorized as Promo & Brochures without creating a new contact for every recipient.
3. A direct reply later containing a contract stays in one thread and exposes the contract file.
4. A PDF forwarded several times is stored once and linked to each source message.
5. A quote-request email suggests deadline, contact, and booking facts but changes nothing without approval.
6. A Calendar event matches an existing booking and appears once on Schedule/profile.
7. A Calendar date conflict becomes a visible suggestion.
8. Employee and receipt mail remains in its internal area unless clear event evidence supports a secondary link.
9. A personal-labeled message is excluded even if it contains an event-like phrase.
10. A leg-manager session cannot retrieve any synced message, file, suggestion, or internal record.

## Out of scope for Release 1

- sending email;
- drafting through Gmail;
- moving, archiving, deleting, or relabeling Gmail messages;
- creating or editing Google Calendar events;
- replacing Gmail as the source mailbox;
- silently updating CRM data;
- AI-only ownership decisions;
- importing personal email;
- exposing email/files to leg managers;
- creating placeholders for inaccessible files.

## Completion criteria

Release 1 is complete when:

- the one company Google account connects with read-only Gmail, Calendar, and accessible Drive/file access;
- only approved business Gmail labels/descendants and the four approved Calendars are synchronized;
- Inbox and Sent messages form complete durable threads;
- profile-first Conversations, Files, Calendar, and Suggested Updates views are available;
- accessible files are durably copied and original links retained;
- high-confidence deterministic matches file automatically and ambiguous matches remain reviewable;
- AI categorization/extraction is limited, validated, auditable, and never authoritative for ownership or profile writes;
- Employees, Business Receipts, and Associations are separated appropriately;
- Google Calendar events connect without duplicating bookings;
- historical backfill completes newest-first and incremental sync continues;
- every item has a visible terminal or retry state;
- personal content remains excluded;
- Google content is unchanged;
- role restrictions are enforced server-side;
- all idempotency, restart, privacy, and acceptance tests pass.
