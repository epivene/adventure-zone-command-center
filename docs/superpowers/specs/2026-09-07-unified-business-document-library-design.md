# Unified Business Document Library Design

**Date:** 2026-09-07  
**Status:** Approved in chat; awaiting written-spec review

## Purpose

Create one private, searchable home in the Adventure Zone app for company business documents. The library will preserve copies of relevant files from Google Drive and Gmail, connect event-specific documents to CRM profiles and bookings, retain specialist COI tracking, and route uncertain automated matches to a dedicated review queue.

This design covers contracts, proposals, certificates of insurance (COIs), insurance policies and renewals, W-9 and tax forms, permits, vendor applications, inspection records, deposit records, operational templates, marketing documents, and other Adventure Zone business files. Personal files and unrelated email attachments are out of scope.

## Existing Capabilities

The app currently stores or displays documents in several separate systems:

- **Boss Business Documents** aggregates prepared Design Studio contract outputs, COI certificate records, and operational email drafts.
- **COI Management** uses Design Studio assets plus `design_certificates` to track certificate ownership, dates, expiration state, and review state.
- **Business Sources** stores protected source-document files and can link them to profiles and bookings.
- **Google Workspace profile files** can copy approved Gmail thread attachments into private object storage and associate them with one organization.
- **Profile pages** expose some source documents and Gmail files, but there is no complete, shared profile-document view.

The new library will unify these capabilities rather than introduce another disconnected storage silo.

## Confirmed Product Decisions

- The app stores a protected copy of each business document; Drive and Gmail originals remain unchanged.
- Business Documents is the canonical app library and the main navigation destination.
- Every profile has a Documents section backed by the same library.
- A document may link to multiple profiles, bookings, or events.
- Company-wide documents may remain unlinked to a profile.
- Strong automated classifications and profile matches are accepted automatically.
- Uncertain classifications, links, or extracted dates go to Document Review.
- The COI page remains as a specialized view of the same underlying documents.
- Private document contents are restricted to owners/administrators by default. Staff access can be granted later through an explicit document-access permission.
- Removing a relationship does not delete a document.
- Email and Drive copies are deduplicated by content.

## User Experience

### Business Documents

Business Documents becomes the primary library with four initial views:

1. **All Documents** — all authorized company files.
2. **Templates** — reusable contracts, proposals, forms, and current company documents such as the W-9.
3. **COIs & Insurance** — insurance documents with COI status and expiration information.
4. **Needs Review** — files awaiting classification, relationship matching, or metadata confirmation.

The library supports search and filters for category, profile/event, booking, year, source, review state, and expiration state. A document row or detail panel shows filename, category, source, linked records, created/imported time, document dates when applicable, version, and review state.

Authorized users can upload a document, link or unlink records, change category, confirm extracted metadata, replace a file with a new version, archive a document, or open the preserved source when the source is still available.

### Profile Documents

Each CRM profile gains a Documents section showing all library documents linked to that profile, including documents linked through a relevant booking. Authorized users can:

- open a document;
- upload a new document directly to the profile;
- link an existing library document;
- remove an incorrect link without deleting the file;
- inspect category, source, dates, and COI status; and
- navigate to the document in the central library.

The library document links back to every associated profile and booking so navigation is bidirectional.

### COI Management

COI Management remains optimized for insurance work: current, expiring, expired, incomplete, and review-needed states. It reads from the shared document records and COI metadata instead of requiring a separate user-managed asset copy. A COI attached from Gmail can therefore appear on its profile, in Business Documents, and in COI Management without storing three binaries.

### Document Review and Today

Document Review is a dedicated queue, separate from calls and follow-ups. Each item presents the file, source context, proposed category, proposed profile/booking links, extracted dates, confidence explanations, and the available corrections.

The Today page displays a document-attention count and opens the dedicated queue. A review item can be approved, corrected and approved, marked as non-business, deferred, or retried when source retrieval failed.

## Canonical Data Model

The exact table and column names may follow existing repository conventions, but the domain model must contain these concepts:

### Document

One logical business document with:

- stable identifier;
- display name and original filename;
- category;
- lifecycle state: active, archived, or deleted;
- review state;
- current version identifier;
- created/imported timestamps and actor;
- optional effective, issue, and expiration dates;
- optional notes; and
- visibility policy.

Initial categories are contract, proposal, COI, insurance policy, W-9/tax, permit, vendor application, inspection, deposit/receipt, operational template, marketing, and other.

### Document Version and Blob

Each replacement creates an immutable version. The binary blob has a SHA-256 checksum, size, MIME type, storage object key, creation time, and malware/validation state if such scanning is available. Multiple logical documents or versions may reference one physical blob when the checksum is identical.

### Document Relationship

A many-to-many relationship connects a document to an organization/profile, booking, or event family. Each relationship records whether it was manual or automatic, its confidence and evidence when automatic, the actor or process that confirmed it, and timestamps.

### Document Source

A document may have multiple source records. A source records Gmail attachment identifiers, Drive file identifiers, existing Business Source identifiers, existing Design Studio asset identifiers, or manual upload provenance. Source records allow the app to recognize a file already imported from another channel and to open an original when permitted.

### COI Metadata

COI-specific fields remain separate from generic document fields: certificate holder/account, organization and booking relationships, issue and expiration dates, status, and review state. Existing `design_certificates` data will be preserved or migrated into this extension without losing history.

### Review Item and Audit Event

Review items store proposed changes and reasons without mutating authoritative relationships until accepted. Audit events record import, classification, link/unlink, metadata correction, version replacement, archive, restore, and deletion actions.

## Ingestion Architecture

The ingestion pipeline is source-independent and contains focused stages:

1. **Discover** source candidates and stable source identifiers.
2. **Retrieve** bytes and source context without altering the source.
3. **Validate** allowed size and MIME type and reject empty or unsupported payloads.
4. **Fingerprint** bytes with SHA-256 and reuse an existing blob when present.
5. **Classify** the business-document category using filename, MIME type, surrounding email/Drive metadata, and readable file content when supported.
6. **Extract** applicable names, dates, certificate-holder information, and event clues.
7. **Match** profiles, bookings, and events using existing CRM identities, known email addresses, source thread relationships, event names, locations, and dates.
8. **Decide** whether confidence is strong enough to file automatically or requires review.
9. **Persist** the canonical document, source, version, relationships, and COI metadata atomically.
10. **Report** imported, deduplicated, linked, review-needed, skipped, and failed counts.

Each stage exposes a small interface so Gmail, Drive, manual upload, and legacy migrations share classification, matching, deduplication, and review behavior.

## Initial Migration

### Google Drive

The initial Drive inventory targets known Adventure Zone business folders, including Contracts and its General, Schools, Vendor Applications, Proposal Drafts & Requests, COIs & Insurance Stuff, and Deposit Photos content, plus other clearly business-oriented top-level folders such as inspections, passes, scheduling, promotions, and events/shows.

The migration must not sweep all of My Drive indiscriminately because the account contains personal and school material. It uses an explicit allowlist of approved folders, produces an inventory summary, and excludes temporary/system artifacts such as `~$*`, `.tmp`, and `desktop.ini`.

### Gmail

The historical Gmail pass considers business attachments, uses the message and thread context for matching, and preserves Gmail message/attachment identifiers. It does not alter labels, delete messages, or remove attachments. Attachments already copied through Google Workspace profile files are migrated by metadata/checksum rather than downloaded into a second binary when possible.

### Legacy App Records

Existing Business Source files, Google Workspace profile files, Design Studio document assets, and COI certificate records are mapped into the canonical library. Migration records preserve their legacy identifiers for traceability and idempotency.

### Execution Rules

- Inventory and import are separate operations.
- The operator sees the approved source scope before import.
- Imports run in resumable batches with checkpoints.
- Stable source identifiers and checksums make reruns idempotent.
- Partial failures do not roll back successful unrelated files.
- A final reconciliation report compares discovered candidates with imported, duplicate, skipped, review, and failed outcomes.
- No source file is deleted or moved.

## Future Gmail Automation

The existing regular Google Workspace synchronization discovers new messages and attachments. Document processing is incremental and does not repeatedly scan the entire mailbox.

For each attachment:

- obvious non-business or unsupported attachments are ignored with a recorded reason;
- exact duplicate content adds source provenance and any newly supported relationships without adding another blob;
- strong category and record matches are filed automatically;
- ambiguous documents create a Document Review item;
- COIs create or update COI metadata when certificate identity and dates are reliable;
- uncertain COI dates remain unconfirmed and visible in review; and
- retrieval failures enter a retryable state with a safe error code.

Processing is idempotent by Google connection, message ID, and attachment ID. The ordinary hourly sync cadence is sufficient initially; the design does not require a new high-frequency worker.

## Matching and Confidence

Automatic relationship creation requires positive CRM evidence. Strong evidence includes an already-approved Gmail thread-to-profile relationship, an exact known contact email, an exact existing profile/event name combined with compatible location or date, or an existing source relationship being migrated.

Fuzzy name similarity alone is not sufficient for automatic linking. Conflicting strong signals always produce a review item. Multi-profile relationships may be suggested or created only when the source explicitly supports multiple records or the document is a known shared company document.

The UI explains the evidence behind every automatic proposal or decision. Thresholds and rule versions are recorded so decisions can be audited and improved without silently rewriting history.

## Security and Privacy

- Business-document metadata and contents require authenticated access.
- File contents default to owner/administrator access.
- A later explicit document-access permission may grant trusted staff access; ordinary profile access alone does not grant document-content access.
- Signed download URLs are short-lived and issued only after an authorization check.
- Storage object keys are not exposed as public URLs.
- Logs contain identifiers and safe error codes, not document bytes or extracted sensitive text.
- Gmail and Drive tokens continue to use the existing protected Google Workspace connection flow.
- Import scope excludes personal files by folder allowlist and review controls.
- Deletion requires administrator confirmation and an audit event. Prefer archive for routine removal.

## Failure Handling

- Source unavailable: keep a retryable source/review record and do not create a falsely available file.
- Unsupported or oversized file: skip with a visible reason and include it in the migration report.
- Empty/corrupt file: quarantine from normal opening and route to review when business relevance is plausible.
- Classification uncertain: store the file safely as unclassified and create a review item.
- Relationship uncertain or conflicting: store the document without the disputed relationship and create a review item.
- Metadata extraction uncertain: never invent dates; leave fields unconfirmed and route applicable fields to review.
- Duplicate detected: reuse the blob, add missing provenance and relationships, and record a deduplicated outcome.
- Database failure after storage write: retry or garbage-collect unreferenced objects safely; never expose a half-created document.
- Worker interruption: resume from the last checkpoint without duplicating earlier work.

## Observability and Operations

Each import or sync run records start/end time, source, discovered count, downloaded count, imported count, duplicate count, automatically linked count, review count, skipped count, retry count, and failure count. Administrators can inspect safe failure reasons and retry eligible items.

The Today notification count represents unresolved review items, not transient worker failures that are still retrying automatically. Repeated permanent failures are promoted to review.

## Testing Strategy

### Unit Tests

- checksum and blob reuse;
- category classification rules;
- strong versus ambiguous profile matching;
- multi-profile relationship creation;
- COI status/date derivation;
- permission decisions;
- source idempotency; and
- safe error classification.

### Integration Tests

- Gmail attachment to canonical document and profile relationship;
- Drive file to canonical document;
- Gmail/Drive duplicate convergence on one blob;
- legacy Business Source, profile file, Design asset, and COI migration;
- automatic COI creation and uncertain-date review;
- resumable batch behavior after interruption;
- signed URL authorization; and
- unlink, archive, restore, version replacement, and audited deletion behavior.

### UI Tests

- Business Documents filters and details;
- Profile Documents bidirectional navigation;
- linking one document to multiple profiles;
- COI visibility across profile, library, and COI tracker;
- Document Review approve/correct/defer/non-business actions;
- Today attention count; and
- unauthorized users seeing neither file contents nor usable download links.

### Migration Verification

A controlled dry inventory and a small pilot batch precede the full import. The final verification reconciles source candidate counts with every terminal outcome, samples opened files from each category/source, verifies representative profile relationships, and confirms that Drive and Gmail originals remain present.

## Rollout

1. Add the canonical library and compatibility adapters while existing screens continue to work.
2. Migrate existing app document records and verify permissions and opening behavior.
3. Enable the unified Business Documents and Profile Documents views.
4. Run the approved Drive and historical Gmail pilot imports.
5. Review pilot results and matching thresholds.
6. Complete the historical import and reconciliation.
7. Enable incremental Gmail automation and Today notifications.
8. Retire redundant legacy UI paths only after their records are represented in the shared library.

Rollback disables new ingestion and returns the UI to legacy adapters; it does not delete imported blobs or relationships. This preserves recoverability while migration discrepancies are corrected.

## Success Criteria

- Authorized users can find all imported Adventure Zone business documents in Business Documents.
- A profile's Documents section shows every document linked directly or through a relevant booking and links back to the central record.
- One document can be linked to multiple profiles without duplicate storage.
- The same Gmail and Drive file produces one stored blob with both sources recorded.
- COIs appear consistently on profiles, in Business Documents, and in COI Management.
- Strong future Gmail matches file automatically; uncertain items appear in Document Review and on the Today attention count.
- Owners/administrators can open files; users without document permission cannot.
- The historical migration is resumable, auditable, reconciled, and leaves Gmail and Drive originals unchanged.

## Out of Scope

- Editing Google Docs or Office documents inside the app.
- Deleting or reorganizing the source Drive or Gmail archive.
- Importing personal or unrelated account content.
- Replacing Google Drive as a collaborative authoring tool.
- Granting all office staff document access by default.
- Building real-time mailbox push notifications; the existing scheduled sync is sufficient initially.
