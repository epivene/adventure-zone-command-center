# Contract Builder and Adobe Handoff Design

> Rollout gate (2026-09-08): Keep `CONTRACT_BUILDER_ENABLED=false` and template v1 in `reviewed` state until [the acceptance checklist](../../acceptance/contract-builder-v1-checklist.md) has recorded owner approval. Dave's saved signature remains solely in Adobe; the CRM stores no signature image or signature bytes.

**Date:** 2026-09-08  
**Status:** Approved design  
**Product:** Adventure Zone Command Center

## Purpose

Add a profile-to-contract workflow that creates accurate Adventure Zone contracts from approved language and existing CRM data, preserves every generated version, and makes the final manual handoff to Adobe Acrobat Sign as short and reliable as possible without depending on the Adobe Sign API.

After a completed contract is uploaded, the workflow must also prepare a COI request draft in the connected Adventure Zone Gmail account. The draft is addressed by default to Sara Toone at `sara@protectiveins.net`, remains editable, and is never sent automatically.

## Background and constraints

The reviewed Adventure Zone contracts share a core structure but differ materially by payment arrangement and event obligations. In particular:

- The Meeteetse Annual Labor Day Celebration contract uses pay-for-play with a percentage of ticket-box sales returned to the event.
- The Dinosaur Stone Age Stampede contract uses a guaranteed event payment with deposit and remaining-payment terms.
- Other Adventure Zone contracts use prepaid event-fee structures.

The existing CRM already stores the organization, contacts, booking dates and location, selected packages, attraction count, travel leg, activities, follow-ups, and booking status. It does not currently store all contract-specific commercial and operational terms.

The Adobe Sign API is not a dependency for this release. A normal CRM browser page cannot securely place a locally generated file and recipient configuration inside Adobe's authenticated send form. The handoff therefore prepares everything possible, opens Adobe, and gives the user a short confirmation checklist.

## Scope

### Included

- A prominent **Create contract** action on an event profile and booking.
- Selection of a booking when a profile has more than one.
- Three contract arrangements:
  1. prepaid or guaranteed event fee;
  2. pay-for-play with a percentage returned to the event;
  3. guarantee plus ticket-sales percentage.
- Autofill from the selected profile and booking.
- An editable review experience for contract-specific terms.
- Server-generated PDF output with signature and date areas for the event representative and Dave Gordon.
- An immutable contract snapshot and version history.
- A guided Adobe Acrobat Sign handoff.
- Manual contract lifecycle statuses while the Adobe API is unavailable.
- Upload and storage of the completed signed PDF beside the unsigned PDF.
- Automatic creation of an editable Gmail COI request draft after a signed contract is uploaded.
- A configurable default internal signer and insurance recipient.
- Activity/audit history for material actions.

### Not included

- Sending agreements or reading agreement status through the Adobe API.
- Applying Dave's signature automatically or storing his signature image in the CRM.
- Automatically sending the COI request.
- Automatically interpreting a returned signed PDF as valid or complete.
- A general-purpose legal-document editor.
- Bulk contract generation.
- Replacing event-provided contracts with Adventure Zone language.

## User workflow

### 1. Start from a profile or booking

The profile exposes **Create contract** as a primary action. If the profile has multiple bookings, the user chooses one before entering the builder. The booking detail page can open the same builder with its booking preselected.

If there is an unfinished draft for that booking, the action offers **Continue draft**. Existing finalized versions are not silently reopened for editing.

### 2. Review autofilled identity and event details

The builder loads:

- event and organization name;
- venue name and address;
- event start and end dates;
- primary event representative's name, role, phone, and email;
- selected packages and current physical attraction count;
- travel leg for internal context only.

Missing or ambiguous data is visibly flagged. The builder never selects an arbitrary signer when no primary contact exists.

### 3. Choose the commercial arrangement

The user chooses one of the three approved arrangements. Only fields relevant to that arrangement appear.

#### Prepaid or guaranteed event fee

- total event fee;
- deposit amount and due date;
- remaining balance and payment timing;
- any approved discount wording.

#### Pay-for-play with event percentage

- percentage returned to the event;
- timing of the settlement payment;
- public ticket-price authority and collection arrangement;
- any approved upfront charge.

#### Guarantee plus ticket-sales percentage

- guarantee amount;
- deposit amount and due date;
- remaining guaranteed balance and payment timing;
- percentage and the precise threshold/base to which it applies;
- ticket-price authority and collection arrangement.

Money is stored as integer cents. Percentages are stored in a bounded decimal representation. The server validates that deposit and remaining-payment amounts are consistent with the stated total or guarantee.

### 4. Confirm operational terms

The review captures or confirms:

- attraction/package description;
- operating dates, daily hours, and work-day count;
- arrival and departure dates;
- space requirement;
- exclusivity;
- power requirements;
- water requirement;
- forklift availability/requirement;
- lodging or camping requirement;
- restroom access;
- licensing, permit, and inspection responsibilities;
- setup/teardown and equipment-move clause;
- event-specific additional terms.

Arrival and departure dates may be suggested from the event dates using the template defaults, but the user must confirm them. The builder never invents a fee, deposit, percentage, physical requirement, or party obligation.

### 5. Preview and generate

Before generation, the user sees a human-readable preview of the complete agreement. Validation errors link directly to the field that needs attention.

**Generate contract** creates an immutable version containing:

- a snapshot of all rendered field values;
- the exact template version used;
- the rendered legal text;
- the unsigned PDF;
- signer names, email addresses, roles, and order;
- creator and creation timestamp.

The first finalized version is version 1. Corrections use **Create replacement**, producing the next version and marking the earlier version superseded. Editing the profile or booking later cannot mutate any finalized contract.

### 6. Continue to Adobe

The handoff screen:

- opens or downloads the generated PDF;
- displays and copies the agreement name;
- displays and copies the event signer's name and email;
- displays and copies Dave's saved default name and email;
- opens Adobe's **Request e-signatures** page in a new tab or hands the file to Acrobat on supported mobile devices;
- shows the required sequential order: event representative first, Dave second;
- reminds the user to place/confirm both signature and date fields;
- requires an explicit **I sent it through Adobe** confirmation before advancing CRM status.

Dave stores and controls his own signature inside Adobe. The CRM stores only his signer identity and default routing position. Adobe prompts him when his turn arrives, and he applies his saved Adobe signature himself.

## Contract data model

Use a dedicated contract subsystem rather than overloading source documents or design-studio outputs.

### Contract template

A versioned, owner-controlled template record contains:

- stable template key;
- version number;
- active/retired state;
- fixed Adventure Zone clauses;
- arrangement-specific clauses;
- operational defaults;
- render metadata;
- effective timestamp and creator.

The first production template is transcribed from the reviewed Amy/Adventure Zone contract language. It must be reviewed as rendered before activation. Activating a new version does not change older contracts.

### Contract draft

One editable draft may exist for a booking at a time. It stores normalized builder values, validation state, selected template version, selected arrangement, and last editor. Autosave allows work to resume after navigation or PDF-generation failure.

### Contract version

A finalized contract version stores immutable JSON snapshots plus unsigned-file metadata. It belongs to exactly one booking and organization and records its predecessor/superseding version where applicable.

### Contract file

Files are stored using the app's existing protected object-storage pattern. Each file is classified as `unsigned_generated` or `signed_completed`, includes content type, size, checksum, storage key, upload/generation actor, and timestamp, and is accessible only through authorized signed read URLs.

### Settings

Owner settings include:

- internal signer name, default `Dave Gordon`;
- internal signer email;
- internal signer default order, `2`;
- insurance recipient name, default `Sara Toone`;
- insurance recipient email, default `sara@protectiveins.net`.

The insurance recipient is editable because the historical mailbox shows that the agency contact has changed. A settings change applies only to future drafts.

## Status model

The contract lifecycle is separate from, but coordinated with, booking status:

- `draft`
- `ready_for_adobe`
- `sent_for_signature`
- `partially_signed`
- `completed`
- `declined`
- `cancelled`
- `superseded`

Because Adobe status is not integrated, transitions after `ready_for_adobe` are explicit user actions. Uploading a signed PDF transitions that contract version to `completed` after user confirmation.

Booking coordination:

- Confirming **I sent it through Adobe** changes the booking to `pending_contract` unless it is already further along.
- Uploading the signed contract changes the booking to `contract_received` unless it is already `confirmed`, `completed`, `cancelled`, or otherwise further along.
- Contract status changes never regress a later booking status.

Every transition creates an activity and an audit entry with actor, prior state, next state, contract version, and timestamp.

## Signed-contract upload

From the contract record, **Upload signed contract** accepts PDF only and shows the selected filename and contract version before confirmation. The server checks the declared file type, PDF file-header bytes, size limit, checksum, authorization, and the relationship to the selected contract version. These checks establish that the upload is a plausible PDF; the user's confirmation establishes that it is the completed agreement.

The unsigned file is retained. Replacing a mistakenly uploaded signed file creates a new file revision and audit event rather than silently overwriting the prior bytes.

After a successful upload, the user confirms that the uploaded file is the completed agreement. The status and booking transitions, activity creation, and COI-draft request are handled idempotently so a retry cannot create duplicate history or duplicate Gmail drafts.

## Automatic COI request draft

### Trigger

The trigger is successful confirmation of a signed-contract upload, not merely a manual status change. This provides concrete evidence that a completed document was received.

### Required COI fields

The profile/contract must provide:

- event name;
- event dates;
- certificate holder/additional insured legal name;
- certificate-holder mailing address;
- exact additional-insured wording requested by the sponsoring body.

The event signer and contract party are used as suggestions but are not assumed to be the correct certificate holder. If COI fields are missing, the app still completes the contract upload and creates a visible **COI details needed** task instead of fabricating language or failing the upload.

### Draft content

The Gmail draft follows the recent Adventure Zone request format:

- To: configured insurance recipient, initially Sara Toone at `sara@protectiveins.net`;
- Subject: `COI Request for {event name} – {city} {state} {year}`;
- short introduction from Desiree/The Adventure Zone;
- exact additional-insured language;
- event dates;
- certificate-holder name and mailing address;
- Adventure Zone signature block.

The generated draft remains editable and unsent. The profile shows **Review COI draft** and records the connected Gmail draft identifier without exposing mailbox credentials.

### Failure behavior

Contract completion is not rolled back if Gmail draft creation fails. The app records `coi_draft_pending` with a safe error summary and offers **Retry COI draft**. The operation uses an idempotency key based on contract version and trigger type so retries cannot create multiple drafts.

## API and component boundaries

### Server modules

- `contract-template-service`: selects and validates active template versions.
- `contract-draft-service`: creates, autofills, validates, and saves drafts.
- `contract-renderer`: converts a validated immutable snapshot to deterministic document content.
- `contract-pdf-service`: generates and stores the PDF.
- `contract-lifecycle-service`: enforces transitions, replacement rules, booking coordination, activities, and audits.
- `contract-file-service`: validates and stores unsigned/signed file revisions.
- `coi-draft-service`: gathers COI data, creates one Gmail draft, records the provider ID, and handles retry state.

These services use explicit repository interfaces so rendering and lifecycle rules can be tested without network or object storage.

### Client components

- Profile/booking contract action.
- Booking selector when needed.
- Contract builder with arrangement-specific sections.
- Full preview and validation summary.
- Adobe handoff checklist.
- Contract history/status card.
- Signed-contract upload dialog.
- COI next-action and retry card.
- Owner contract settings.

The builder is mobile-first: one column on phones, persistent save state, large controls, and no dependence on hover or side-by-side editing.

## Authorization and security

- Contract creation, replacement, status mutation, file upload, settings, and COI draft creation are owner/admin operations.
- File download endpoints issue short-lived signed URLs only after authorization.
- Server logs and API responses do not expose Gmail tokens, Adobe credentials, object-storage credentials, or signature images.
- Dave's signature is never uploaded to or stored by the CRM.
- Template activation and modification are audited.
- User-entered text is escaped during HTML/document rendering.
- PDF and upload limits protect server and storage resources.

## Validation and safeguards

Generation is blocked when any applicable required field is missing, including signer email, event dates, arrangement terms, or unconfirmed operational terms.

Server validation checks:

- valid date ordering;
- arrival no later than event start and departure no earlier than event end, unless an explicit override reason is recorded;
- nonnegative monetary values;
- deposit plus remaining balance consistency;
- bounded percentages and an explicit percentage base;
- at least one selected package/attraction description;
- valid signer order and distinct signer identities;
- valid email addresses;
- required COI data separately from contract-generation data.

Warnings are used for unusual but permitted terms; errors are used for internally inconsistent or missing required terms. No validation failure discards a saved draft.

## Testing

### Unit tests

- Autofill mapping and missing-data flags.
- All three arrangement validators and render branches.
- Money, percentage, and date consistency rules.
- Deterministic rendering from an immutable snapshot.
- Version and supersession rules.
- Lifecycle transitions and booking-status non-regression.
- COI body rendering and missing-detail behavior.
- Idempotent signed-upload and COI-draft orchestration.

### Integration tests

- Draft persistence and resume.
- PDF generation and protected file storage.
- Signed-PDF validation and revision storage.
- Authorized versus unauthorized API access.
- Activity/audit creation.
- Gmail draft creation through a fake provider adapter, including retry and duplicate prevention.

### UI tests

- Profile and booking entry points.
- Booking selection.
- Arrangement-specific field visibility.
- Validation navigation and preview.
- Adobe handoff checklist and explicit sent confirmation.
- Contract history and replacement flow.
- Signed upload and COI next action.
- Narrow mobile viewport usability.

### Acceptance checks

For one representative booking per arrangement, compare the rendered contract against the approved Adventure Zone language and verify names, dates, money, percentages, operational terms, and both signature blocks. Upload a test signed PDF, confirm exactly one COI Gmail draft is produced, and verify the draft remains unsent.

## Rollout

1. Add the schema, settings, storage, services, and owner-only API behind a feature flag.
2. Transcribe and review the initial contract template with Amy's existing wording.
3. Enable the builder for owner/admin users and validate representative contracts for all three arrangements.
4. Enable the Adobe handoff and manual lifecycle tracking.
5. Enable signed uploads and COI draft creation after Gmail adapter verification.
6. Retain the prior manual contract workflow as a temporary fallback until real contracts have passed acceptance checks.

## Success criteria

- A user can start from a profile, generate a correct reviewed contract without retyping known CRM data, and reach Adobe with the PDF and signer order prepared.
- No price, percentage, deposit, obligation, or COI wording is invented.
- Dave signs second using his own Adobe-saved signature.
- Every finalized and signed contract remains retrievable from its profile and booking.
- Uploading a completed signed contract creates exactly one editable, unsent COI request draft to the configured insurance recipient.
- Failures are recoverable without losing draft work, duplicating files, duplicating Gmail drafts, or regressing booking state.
