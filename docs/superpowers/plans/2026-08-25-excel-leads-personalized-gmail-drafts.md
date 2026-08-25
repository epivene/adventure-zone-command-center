# Excel Leads to Personalized Gmail Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development while implementing each task and superpowers:verification-before-completion before claiming the feature is complete. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Amy's September/October 2026 Excel event lists, require per-event contact/date review, calculate package availability from real Google Calendar events, render a safe personalized Desiree introduction email, and create exactly one reviewed Gmail Draft per approved event.

**Architecture:** Add a dedicated lead-intake vertical slice that reuses the existing ACT review, CRM profile/contact, package, communication-template, audit, Office email, and Google Workspace foundations. Parse legacy Excel locally, persist source-provenance rows server-side, calculate readiness only on the server, and expose Gmail draft creation only after every safety gate passes.

**Tech Stack:** React + TypeScript + Vite, Express + TypeScript, PostgreSQL/Drizzle, Zod, Vitest/Testing Library, SheetJS `xlsx`, Google Calendar API, Gmail API.

**Spec:** `docs/superpowers/specs/2026-08-25-excel-leads-personalized-gmail-drafts-design.md`

## Global constraints

- Start with `Sept Week 3(3).xls`; apply the same workflow to Week 4 after the first vertical slice passes.
- Importing never creates a CRM profile, email, or Gmail Draft automatically.
- Every event requires explicit confirmation of dates, intended contact, role, and recipient email.
- Google Calendar is authoritative for availability.
- Expand only the proposed lead dates by two days before and one day after. Existing booked Calendar dates are already buffered.
- Normal capacity is 5 Adventure Zones, 3 Pirate's Rebellion units, and 1 Warrior's Playground.
- Fourth Pirate, Mini Zone, rentals, and overbooking are approval-only and never counted as normal availability.
- Ambiguous Calendar package usage blocks automatic readiness.
- Use the approved 2026 introduction template with Desiree in the opening and signature.
- Only available normal packages appear in the email.
- Unapproved commercial language remains excluded.
- No normal draft when nothing normal is available.
- `DO NOT SEND` is enforced server-side at every draft boundary.
- No Gmail send endpoint or client method may be added.

---

## Task 1: Add legacy Excel parsing and deterministic import preview

**Files:**
- Modify: `artifacts/adventure-zone/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `artifacts/adventure-zone/src/features/lead-intake/excel-lead-parser.ts`
- Create: `artifacts/adventure-zone/src/features/lead-intake/excel-lead-parser.test.ts`
- Create: `artifacts/adventure-zone/src/components/lead-intake/lead-import-panel.tsx`
- Create: `artifacts/adventure-zone/src/components/lead-intake/lead-import-panel.test.tsx`
- Add test fixtures derived from the supplied headers only; do not commit private spreadsheet contents.

**Interfaces:**

```ts
type LeadSourceRow = {
  sheetName: string;
  rowNumber: number;
  company: string;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  website: string | null;
  industry: string | null;
  originalValues: Record<string, string | null>;
};

type ParsedLeadWorkbook = {
  fileName: string;
  fileSha256: string;
  rows: LeadSourceRow[];
  warnings: string[];
};
```

- [ ] Write failing tests proving `.xls` and `.xlsx` parsing, exact source row numbers, header normalization, blank-cell handling, formula values treated as display text, and rejection of an unrelated workbook.
- [ ] Add `xlsx` to the frontend package and lockfile.
- [ ] Implement browser-local parsing and SHA-256 fingerprinting.
- [ ] Enforce accepted extensions, maximum file size, maximum row count, and maximum cell length.
- [ ] Build a dry-run panel that shows detected rows/warnings and requires `Import for review`.
- [ ] Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/lead-intake/excel-lead-parser.test.ts src/components/lead-intake/lead-import-panel.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

- [ ] Commit: `feat: preview Excel lead lists safely`

---

## Task 2: Persist import batches, source rows, states, and provenance

**Files:**
- Create: `lib/db/migrations/069_excel_lead_intake.sql`
- Create: `lib/db/src/lead-intake-schema.ts`
- Modify: `lib/db/src/index.ts`
- Modify: `lib/db/src/schema/index.ts` only for established aggregate exports/relations
- Create: `artifacts/api-server/src/features/lead-intake/lead-import-types.ts`
- Create: `artifacts/api-server/src/features/lead-intake/lead-import-input.ts`
- Create: `artifacts/api-server/src/features/lead-intake/lead-import-repository.ts`
- Create: `artifacts/api-server/src/features/lead-intake/lead-import-service.ts`
- Create: `artifacts/api-server/src/features/lead-intake/lead-import-service.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Create: `artifacts/api-server/src/routes/lead-intake.ts`
- Create: `artifacts/api-server/src/routes/lead-intake.test.ts`

**Persistence:**
- `lead_import_batches`: file name, SHA-256, actor, timestamps, totals.
- `lead_import_rows`: batch, sheet, source row number, source fingerprint, original/normalized JSON, state, warnings, selected profile/contact references, confirmed dates/email/role, skip/block reasons, timestamps.
- `lead_import_evidence`: row, field, candidate value, source kind, source reference/URL, confidence, selected flag, actor/timestamp.
- `lead_availability_checks`: row, proposed window, checked time, Calendar snapshot JSON, package result JSON, readiness.
- `lead_gmail_draft_links`: row, internal email draft, Google connection, Gmail draft/message IDs, idempotency key, template version, created timestamp.

Use foreign keys to existing profile/contact/email/audit entities. Do not copy those entities.

- [ ] Write failing repository/service tests for 59-row Week-3-shaped input, source provenance, duplicate batch fingerprint, duplicate source fingerprint, invalid row preservation, and one-row failure isolation.
- [ ] Add migration and Drizzle schema with unique constraints for batch fingerprint and batch/source-row identity.
- [ ] Add Zod request limits and normalize nullable optional strings consistently.
- [ ] Implement `POST /api/lead-intake/imports`, `GET /api/lead-intake/imports/:id`, and paginated row listing.
- [ ] Record import actor and row decisions through the existing audit service.
- [ ] Run DB schema tests, focused API tests, and API typecheck.
- [ ] Commit: `feat: persist reviewed lead imports`

---

## Task 3: Build the Week 3 lead-review queue

**Files:**
- Create: `artifacts/adventure-zone/src/pages/LeadIntakePage.tsx`
- Create: `artifacts/adventure-zone/src/pages/LeadIntakePage.test.tsx`
- Create: `artifacts/adventure-zone/src/components/lead-intake/lead-review-queue.tsx`
- Create: `artifacts/adventure-zone/src/components/lead-intake/lead-review-card.tsx`
- Create focused component tests beside both components.
- Create: `artifacts/adventure-zone/src/features/lead-intake/lead-intake-client.ts`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify the existing Booking/Marketing navigation component that currently links Office emails, following its established pattern.

**Review card content:**
- spreadsheet provenance and original values;
- configurable territory status;
- fit warnings;
- suggested profile match;
- date/contact/email evidence status;
- Calendar/availability status;
- draft readiness blockers;
- `Review`, `Hold`, and `Skip` actions.

- [ ] Write failing routing, empty-state, status-filter, and review-card tests.
- [ ] Add the authenticated page under Booking/Marketing without adding a second Google workspace or email area.
- [ ] Preserve filters and selected row in the URL so review can resume.
- [ ] Make all warnings readable on mobile and dark mode.
- [ ] Wire import submission and batch refresh.
- [ ] Run focused frontend tests, typecheck, and build.
- [ ] Commit: `feat: add lead list review queue`

---

## Task 4: Reuse CRM/ACT matching and require contact/date confirmation

**Files:**
- Create: `artifacts/api-server/src/features/lead-intake/lead-review-service.ts`
- Create: `artifacts/api-server/src/features/lead-intake/lead-review-policy.ts`
- Create matching tests beside those files.
- Modify/reuse: `artifacts/api-server/src/features/assistant/profile-search-repository.ts`
- Modify/reuse: `artifacts/api-server/src/features/act-replacement/matching/contact-matcher.ts`
- Modify/reuse ACT Description/Business Card projection through existing ACT archive/profile repositories.
- Modify: `artifacts/api-server/src/routes/lead-intake.ts`
- Create: `artifacts/adventure-zone/src/components/lead-intake/lead-contact-date-review.tsx`
- Create its focused tests.

**Rules:**
- profile suggestions never silently create or merge records;
- preserve original ACT Description/Business Card text;
- extract candidate emails/contact clues without replacing better data;
- evidence priority: CRM/ACT structured fields, ACT Description, official site, manual;
- recipient must have confirmed contact ID or explicit reviewed manual contact, role, email, and introduction suitability;
- date start/end must be verified and `end >= start`.

- [ ] Write failing tests for fuzzy profile matching including `aspen film fest` → `Aspen Filmfest (Aspen) CO`.
- [ ] Write failing tests for Description email extraction, conflicting emails, multiple contacts with roles, missing dates, and explicit confirmation.
- [ ] Implement suggestion endpoints and a single reviewed-decision endpoint with optimistic concurrency/version checking.
- [ ] Reuse the existing contact editor for adding/correcting contacts; fix nullable optional inputs if that bug blocks this flow.
- [ ] Show source and confidence beside every candidate fact.
- [ ] Prove a suggested website email cannot advance without user confirmation.
- [ ] Run focused backend/frontend tests and both typechecks.
- [ ] Commit: `feat: verify lead contacts and event dates`

---

## Task 5: Fetch and normalize real Google Calendar booking windows

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-types.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-calendar-events.test.ts`
- Create: `artifacts/api-server/src/features/lead-intake/calendar-window.ts`
- Create: `artifacts/api-server/src/features/lead-intake/calendar-window.test.ts`
- Create: `artifacts/api-server/src/features/lead-intake/calendar-booking-classifier.ts`
- Create: `artifacts/api-server/src/features/lead-intake/calendar-booking-classifier.test.ts`
- Create: `artifacts/api-server/src/features/lead-intake/lead-availability-service.ts`
- Create its focused tests.
- Modify: `artifacts/api-server/src/routes/lead-intake.ts`

**Interfaces:**

```ts
type DateOnlyWindow = { startDate: string; endDate: string };

type CalendarPackageReservation = {
  calendarEventId: string;
  iCalUid: string | null;
  occupiedWindow: DateOnlyWindow;
  packages: Array<{ packageKey: string; quantity: number }>;
  confidence: "explicit" | "ambiguous";
  evidence: string[];
};
```

- [ ] Write failing tests for event list pagination, `timeMin`/`timeMax`, selected calendar IDs, token refresh/reauthorization, all-day exclusive end dates, timed events in Calendar timezone, and API failure.
- [ ] Add Calendar `events.list` to the existing read client using current selected Calendar configuration.
- [ ] Implement date-only arithmetic: proposed window = public start minus 2 through public end plus 1.
- [ ] Confirm existing Calendar event windows are normalized but never expanded.
- [ ] Write classifier fixtures for explicit package names/quantities, multiple packages, separate older entries, duplicate copies, and ambiguous notes.
- [ ] Return ambiguity rather than guessing.
- [ ] Persist availability snapshot evidence and checked time.
- [ ] Run focused Google/availability tests and API typecheck.
- [ ] Commit: `feat: check lead dates against Google Calendar`

---

## Task 6: Update package capacity and calculate safe availability

**Files:**
- Create: `lib/db/migrations/070_lead_inventory_policy.sql`
- Modify: `lib/db/migrations/20260822_package_reviewed_defaults.sql` only through a new forward migration; never rewrite an applied migration.
- Modify: `artifacts/api-server/src/features/packages/package-policy.ts`
- Modify: `artifacts/api-server/src/features/packages/package-repository.ts`
- Modify: `artifacts/adventure-zone/src/features/packages/package-policy.ts`
- Modify: `artifacts/adventure-zone/src/components/packages/package-template-editor.tsx`
- Add focused package policy/editor tests.
- Create: `artifacts/api-server/src/features/lead-intake/package-availability.ts`
- Create: `artifacts/api-server/src/features/lead-intake/package-availability.test.ts`

- [ ] Write failing seed/policy tests for 5 Adventure Zones, 3 normal Pirates plus 1 restricted Pirate, 1 Warrior, and 0 normal Mini Zones.
- [ ] Correct Pirate's standard description so the massive pool/flat-ground requirement belongs to the restricted fourth-unit metadata, not every standard Pirate offer.
- [ ] Add audited admin-editable normal capacity and temporary unavailable/maintenance quantity.
- [ ] Calculate availability from normal capacity minus explicit overlapping reservations minus maintenance quantity.
- [ ] Treat ambiguity as `unresolved`, never `available`.
- [ ] Keep restricted options visibly separate and approval-required.
- [ ] Run package/availability tests, typechecks, and package settings UI tests.
- [ ] Commit: `feat: enforce Adventure Zone package capacity`

---

## Task 7: Add hard communication blocks and safe email rendering

**Files:**
- Create: `lib/db/migrations/071_communication_blocks.sql`
- Create: `lib/db/src/communication-block-schema.ts`
- Modify: `lib/db/src/index.ts`
- Create: `artifacts/api-server/src/features/communications/communication-block-repository.ts`
- Create: `artifacts/api-server/src/features/communications/communication-block-policy.ts`
- Add focused tests.
- Modify/reuse: `artifacts/api-server/src/features/communication-templates/communication-template-renderer.ts`
- Add versioned 2026 introduction template through a forward seed/migration.
- Create: `artifacts/api-server/src/features/lead-intake/lead-email-renderer.ts`
- Create: `artifacts/api-server/src/features/lead-intake/lead-email-renderer.test.ts`
- Create: `artifacts/api-server/src/features/lead-intake/draft-readiness-policy.ts`
- Create its tests.
- Create: `artifacts/adventure-zone/src/components/lead-intake/lead-email-preview.tsx`
- Create its tests.

- [ ] Write failing block tests for profile, contact, normalized recipient email, import row, inactive block, and exact stable-ID targeting.
- [ ] Add admin controls to create/remove a communication block; do not seed a name-only Colleen block.
- [ ] Add template sections for Adventure Zone, Pirate's Rebellion, and Warrior's Playground using the approved full 2026 wording.
- [ ] Render subject with profile name plus the full verified date range.
- [ ] Render Desiree in opening and signature and confirmed first-name greeting when known.
- [ ] Include only package sections with positive normal availability.
- [ ] Exclude no-upfront/percentage/guarantee copy without an applicable approved commercial rule.
- [ ] Block readiness for missing confirmation, stale/failed availability, ambiguity, no normal package, territory/fit review, restricted option without approval, or `DO NOT SEND`.
- [ ] Show all blockers in final preview.
- [ ] Run focused backend/frontend tests and typechecks.
- [ ] Commit: `feat: render safe personalized lead emails`

---

## Task 8: Extend Google OAuth and create idempotent Gmail Drafts

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-types.ts`
- Modify existing Google connection/scope status displays and tests.
- Create: `artifacts/api-server/src/features/google-workspace/google-gmail-draft.test.ts`
- Create: `artifacts/api-server/src/features/lead-intake/gmail-draft-service.ts`
- Create: `artifacts/api-server/src/features/lead-intake/gmail-draft-service.test.ts`
- Modify: `artifacts/api-server/src/routes/lead-intake.ts`
- Modify: `artifacts/adventure-zone/src/components/lead-intake/lead-email-preview.tsx`
- Modify: `artifacts/adventure-zone/src/pages/OfficeEmailDraftsPage.tsx` to display linked Gmail draft state without pretending the internal draft was sent.
- Add route/UI tests.

- [ ] Write failing OAuth tests showing existing readonly connections require explicit reauthorization for the added Gmail compose scope.
- [ ] Add MIME message construction tests for Unicode names, multiline bodies, links, headers, and header-injection rejection.
- [ ] Add Gmail `users.drafts.create`; do not add `messages.send` or `drafts.send`.
- [ ] Write failing service tests proving the server rechecks recipient confirmation, communication blocks, template version, and availability freshness immediately before the API call.
- [ ] Add a database-backed idempotency key and prove retries return the existing Gmail draft link.
- [ ] Associate the internal email record and Gmail IDs with the import row, profile, contact, and history.
- [ ] Expose a single `Create Gmail Draft` action only when ready.
- [ ] Preserve review state and retry safely on Google errors.
- [ ] Run Google, service, route, and UI tests plus both typechecks.
- [ ] Commit: `feat: create reviewed Gmail drafts`

---

## Task 9: Validate both Amy workbooks and add regression CI

**Files:**
- Create: `scripts/verify-excel-lead-import.ts`
- Create: `scripts/verify-excel-lead-import.test.ts`
- Create: `.github/workflows/excel-lead-drafts-ci.yml`
- Update documentation only if verification reveals a real rule correction.

- [ ] Run the verifier locally against copies of both supplied workbooks without committing their contents.
- [ ] Assert 59 Week 3 rows, 65 Week 4 rows, 124 total rows, exact provenance, and zero silent drops.
- [ ] Re-import both and assert zero duplicate rows.
- [ ] Exercise representative tests: multi-day subject, missing email, conflicting ACT/website email, restricted state, ambiguous Calendar entry, one package unavailable, all packages unavailable, maintenance reduction, `DO NOT SEND`, Google reauthorization, and Gmail retry.
- [ ] Run:

```bash
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone exec vitest run
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
pnpm --filter @workspace/db typecheck
```

- [ ] Add CI using the repository's existing pnpm/setup/cache pattern. CI uses synthetic fixtures, not private Amy spreadsheets.
- [ ] Perform the live-app acceptance pass:
  1. upload Week 3;
  2. open the first row;
  3. verify date/contact/role/email;
  4. run Google Calendar availability;
  5. inspect package calculation;
  6. inspect Desiree email preview;
  7. create one Gmail Draft;
  8. confirm it appears in the business Gmail Drafts folder;
  9. confirm it was not sent;
  10. retry and confirm no duplicate.
- [ ] Fix any defect found and rerun the full verification.
- [ ] Commit: `ci: verify Excel lead draft workflow`

---

## Delivery order

Tasks 1-3 deliver the import and review queue. Tasks 4-7 make a row safely draft-ready. Task 8 creates the real Gmail Draft. Task 9 validates both source files and the live business-account flow.

Do not shortcut directly to Task 8. A Gmail Draft is only trustworthy after contact verification, Calendar interpretation, package availability, template gating, and `DO NOT SEND` are enforced.

## Plan self-review

- The plan uses existing architectures rather than a second CRM, package model, email editor, or Google integration.
- Every uncertain business rule becomes a visible block or approval requirement.
- Both new-lead and existing-booking buffer behavior are explicitly distinguished.
- One entry-per-leg and multi-package Calendar ambiguity are covered.
- Contact and email suggestions require human confirmation.
- Gmail draft creation is idempotent and has no send path.
- Private spreadsheets are used for local acceptance only and are not committed.
- Each task starts with failing tests, ends with focused verification, and has a scoped commit.
