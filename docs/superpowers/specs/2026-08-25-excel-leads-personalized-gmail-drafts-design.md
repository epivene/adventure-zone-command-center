# Excel Leads to Personalized Gmail Drafts Design

**Date:** 2026-08-25  
**Status:** Approved  
**Primary user:** Desiree  
**First production inputs:** `Sept Week 3(3).xls`, then `Sept Week 4(3).xls`

## Goal

Turn Amy's Excel event lists into individually reviewed, personalized Gmail Drafts in the Adventure Zone business Gmail account. A draft may be created only after the app verifies the event dates, intended contact, recipient email, Google Calendar availability, package availability, territory status, commercial-language approval, and `DO NOT SEND` protections.

The app never sends these emails automatically.

## Approved business rules

### Dates and Calendar

- Target events are in September and October 2026.
- New lead availability uses the public event start date minus two days through the public event end date plus one day.
- Existing Google Calendar booking entries already contain the travel/operating buffer. Use their stored start/end dates exactly; do not expand them again.
- Google Calendar, not the app's internal calendar, is authoritative for this workflow until calendar synchronization is complete.
- One calendar entry represents one booked leg. It does not automatically represent one package.
- Newer entries may describe multiple packages or quantities in the title/notes; older bookings may use separate entries.
- Explicit package/quantity information may be counted. Ambiguous overlapping entries block automatic availability and go to review.
- Google all-day event end dates are exclusive and must be normalized before date-only overlap checks.

### Normal inventory

| Package | Normal automatic capacity | Approval-only capacity |
|---|---:|---:|
| Adventure Zone | 5 | 0 |
| Pirate's Rebellion | 3 | 1 restricted fourth unit |
| Warrior's Playground | 1 | 0 |
| Mini Zone | 0 | Approval only |

The fourth Pirate unit uses the massive pool, requires extremely flat ground, and requires Dave's approval. Mini Zones are last-resort, estimated at $5,000-$6,000 with final pricing set by Dave. Rentals, overbooking, and Logan/Salt Lake equipment are never counted automatically.

Effective normal availability is:

`normal capacity - overlapping verified reservations - temporary unavailable/maintenance quantity`

If package use in an overlapping Calendar entry is ambiguous, the app must not claim that package is available.

### Territory and fit

Territory states are configurable with `Open`, `Ask Amy/Dave`, `Closed`, or `Licensing issue`.

Current hard territory holds are New Mexico, Kansas, Oklahoma, and Texas. California remains a licensing restriction. These states are not actively pursued unless a lead is specifically approved.

Oregon and Washington are **restricted, not on hold**. Because of weather risk, prepaid bookings are preferred in both states. Pay-for-play can still be considered when specifically approved. For Hulk's post-Labor-Day 2026 routing, pay-for-play in Oregon or Washington is allowed when it makes sense because he is already traveling back through the area.

Adult-focused, alcohol, cannabis, generic, or otherwise questionable-fit entries go to review. They are not permanently rejected by hard-coded rules.

### Contact verification

Every event requires an individual review before Gmail draft creation:

1. confirm the event/profile and verified 2026 date range;
2. select the intended event organizer/contact;
3. confirm the person's role;
4. confirm the recipient email;
5. record where the contact/email came from.

Recipient evidence order is:

1. existing CRM/ACT contact data;
2. email/contact information found in preserved ACT Description/Business Card text;
3. the event's official website;
4. manual entry or review when uncertain.

The original value and source evidence remain visible. Conflicting or uncertain contact information cannot be auto-approved.

### Email

- Use Amy's preferred 2026 introduction email as a versioned base template.
- The opening and closing signature use **Desiree**.
- Subject format uses the CRM/ACT profile name and full verified event date range, for example: `Aspen Filmfest (Aspen) CO SEPT 29 – OCT 4, 2026`.
- Greeting uses the confirmed contact's first name when known; otherwise `Hi,`.
- Personalize the event phrase and city.
- Include only normally available package paragraphs.
- When no normal package is available, create a review item—not a normal sales draft.
- The no-upfront-cost, percentage-of-ticket-sales, guarantee, and related terms are excluded unless a matching approved business rule exists.
- Fourth Pirate, Mini Zone, rental, and overbooking language is never inserted without recorded approval.
- Create one Gmail Draft per event in the Adventure Zone business Gmail account.
- Emails are never sent automatically.

### DO NOT SEND

`DO NOT SEND` is a hard block, not a warning. Protection applies at profile, contact, recipient email, import row, internal preview, Gmail draft creation, and any future send boundary.

The protected Colleen record must be identified by a stable CRM identifier; no person is blocked by first-name matching alone.

## Source-file findings

The two supplied legacy `.xls` files contain the `CompanyList` sheet and these columns:

- Company
- Phone
- Address 1
- Address 2
- City
- State
- ZIP Code
- Web Site
- Industry

They do not contain exact event dates, contact names, or email columns. Week 3 contains 59 rows and Week 4 contains 65 rows. Therefore the workflow is an import-and-enrichment review, not a direct mail merge.

## User workflow

### 1. Import preview

The user uploads an `.xls` or `.xlsx` file. The browser parses the workbook and sends normalized rows plus file name, sheet name, row number, source values, and a file fingerprint to the API. No profile, lead, email, or Gmail Draft is created at this stage.

Duplicate uploads reuse the prior batch or clearly identify already-imported rows.

### 2. Review queue

Each row appears as a review card with:

- source spreadsheet data and provenance;
- territory/fit warnings;
- suggested CRM/ACT profile match;
- candidate event dates with evidence;
- candidate contacts, roles, and emails with evidence;
- review status and blockers.

The user can correct values, choose a match, attach a different existing contact, add a new contact, hold the row, or skip it. User decisions are audited.

### 3. Contact and date confirmation

The row cannot proceed until a reviewer confirms:

- matched or newly created profile;
- public event start/end dates;
- intended contact and role;
- recipient email;
- introduction-email suitability.

A website or ACT-derived candidate is a suggestion, not confirmation.

### 4. Calendar and availability check

The server fetches events for the proposed buffered window from the selected Adventure Zone Google calendars through the existing OAuth connection. It normalizes date ranges, deduplicates calendar copies when possible, classifies packages/quantities from explicit calendar data, and returns:

- exact overlapping Calendar entries;
- package reservations attributed to each entry;
- ambiguity warnings;
- capacity, maintenance deduction, booked quantity, and available quantity for each normal package;
- approval-only options shown separately.

Calendar ambiguity blocks automatic draft readiness.

### 5. Email preview

The existing communication-template system renders the approved 2026 introduction template using:

- Desiree sender/signature;
- confirmed greeting;
- profile/event name;
- city;
- verified full date range for the subject;
- only the normally available package sections;
- only approved commercial language.

The final preview shows recipient, evidence, source row, Calendar conflicts, package calculation, approvals, subject, and body.

### 6. Gmail Draft creation

The user explicitly chooses `Create Gmail Draft`. The server rechecks all hard gates transactionally, renders from the current approved template, and calls Gmail `users.drafts.create`. It stores the Gmail draft/message identifiers against the import row, profile/event, contact, and internal draft record.

Repeated requests use an idempotency key and return the existing draft instead of creating duplicates.

There is no Gmail send endpoint in this feature.

## Architecture

### Frontend

Add a Booking workspace page for lead-list imports and review. Reuse the ACT import-review presentation patterns, Office profile/contact editors, package displays, and existing authenticated API clients.

Legacy Excel parsing happens locally in the browser so the server does not need a broad multipart upload path. The frontend supports both `.xls` and `.xlsx`, calculates a SHA-256 fingerprint, and submits normalized JSON. The API remains the authority for validation, persistence, safety checks, and draft creation.

### Backend

Add a dedicated `lead-intake` feature with small services:

- import batch/row repository;
- row normalization and fingerprinting;
- CRM/ACT match suggestions;
- evidence-backed enrichment state;
- contact/date confirmation service;
- Calendar availability service;
- draft-readiness policy;
- Gmail draft service;
- communication-block policy.

Extend the existing Google Workspace client for Calendar event listing and Gmail draft creation. Keep refresh-token encryption, account-subject checks, selected calendar configuration, and reauthorization behavior unchanged.

### Persistence

Add durable records for:

- lead import batches;
- lead import rows and source provenance;
- row evidence/candidate facts and review decisions;
- Calendar availability snapshots and their check time;
- communication blocks;
- Gmail draft links/idempotency.

Do not create duplicate profile/contact/package models. Store references to existing CRM entities.

### Google authorization

Calendar event reads continue to use Calendar readonly access. Gmail draft creation requires the narrow compose capability supported by Gmail. Because that OAuth capability can technically authorize more than creating drafts, the application exposes only draft creation, contains no send method/route, and enforces `DO NOT SEND` before any Gmail mutation.

Existing users must explicitly reauthorize when the scope changes.

## State model

A row moves through:

`imported → needs_review → verified → availability_checked → draft_ready → gmail_draft_created`

Alternative states:

- `blocked`: hard `DO NOT SEND` or policy block;
- `approval_required`: territory, fit, commercial, restricted package, or Calendar ambiguity;
- `skipped`: deliberate reviewer decision;
- `error`: retryable technical failure.

A failed row does not fail the whole batch.

## Safety and freshness

- Draft readiness is computed server-side; the browser cannot declare a row safe.
- Before Gmail draft creation, recheck communication blocks, confirmed recipient, template version, and availability freshness.
- Availability snapshots expire after a short configurable interval or any relevant inventory/calendar refresh.
- Never store Google access tokens in the browser.
- Never log email bodies, OAuth tokens, or raw Google authorization headers.
- Sanitize spreadsheet cells before rendering and treat formula-like values as text.
- Limit row count and field size per batch.
- Every mutation records actor, timestamp, prior value, and resulting value where the audit system supports it.

## Error handling

- Invalid workbook: show a file-level error without creating a batch.
- Invalid row: preserve it with correction warnings.
- Missing dates/contact/email: keep the row in review.
- Google reauthorization required: preserve all review work and show a reconnect action.
- Calendar API partial failure: do not calculate optimistic availability.
- No available normal packages: create a review item only.
- Gmail Draft API failure: retain `draft_ready` and allow retry with the same idempotency key.
- Duplicate draft request: return the existing linked draft.

## Testing and acceptance

The feature is complete when:

1. both supplied workbooks import with 124 traceable rows and no silent drops;
2. re-importing either workbook does not duplicate rows or drafts;
3. a reviewer can verify one Week 3 event's dates, contact, role, and recipient;
4. the proposed date window is expanded by two days before and one day after;
5. stored Google booking windows are not expanded again;
6. package availability reflects capacity, explicit overlapping reservations, and maintenance reductions;
7. ambiguous Calendar package usage blocks readiness;
8. the preview includes only available package sections;
9. commercial and restricted-package copy cannot appear without approval;
10. `DO NOT SEND` blocks Gmail draft creation;
11. a manually approved row creates exactly one Gmail Draft and never sends it;
12. the Gmail draft link is visible from the import row and related CRM history;
13. focused tests, API tests, typechecks, builds, and CI pass.

## Out of scope for this first slice

- Automatically sending email;
- two-way ACT synchronization;
- bulk approval or unattended bulk Gmail draft creation;
- automatic approval of researched contacts;
- automatic rentals, overbooking, fourth Pirate, or Mini Zone offers;
- using the internal CRM calendar as the availability authority;
- fully automatic package interpretation of ambiguous historical Calendar notes.
