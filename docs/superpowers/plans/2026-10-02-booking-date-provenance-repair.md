# Booking Date Provenance and Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Prevent sales milestones and unresolved imports from masquerading as event reservations, and provide an audited owner repair preview.

**Architecture:** Add endpoint evidence without rewriting existing bookings. A shared resolver and equivalent SQL distinguish raw values from effective windows; an owner preview/apply service uses the existing allocation mutex and planning guards. Integrate the review workflow into Event Date Coverage.

**Tech Stack:** Node 22.x, pnpm, TypeScript, Express, Zod, Drizzle/PostgreSQL, React, TanStack Query, Vitest, PGlite.

**Spec:** `docs/superpowers/specs/2026-10-01-booking-date-provenance-repair-design.md` (approved in conversation October 2, 2026).

## Global Constraints

- Preserve leads, commercial status, history and commitments.
- No delete, bulk rollover, leg reassignment, commercial-status change or correspondence.
- No connector booking-date write tool or permission expansion is included.
- Existing booking rows remain untouched at migration time and legacy missing provenance resolves conservatively.
- No merge/deploy, live mass repair, customer email or paid provider calls.
- Applying individual live corrections requires verified evidence through the completed owner review flow.
- Do not modify synced project files under `sources/`; implementation belongs in the repository branch.

## Review Focus

1. Later manual/calendar correction on an ACT-linked booking must outrank old sales evidence (Tasks 1–2).
2. Partial dates and unknown committed windows must remain discoverable and block definitive free-capacity claims (Tasks 1, 3).
3. Verified cross-year and Google exclusive-end windows must survive Denver DST boundaries (Tasks 1, 3).
4. Same-profile multi-season/package records must require exact identity and preserve unrelated records (Tasks 4–5).
5. Concurrent writes, expired previews, duplicate request keys and audit failure must not partially apply (Task 4).

---

## File and interface map

New backend feature directory: `artifacts/api-server/src/features/booking-date-repair/`. Files: `date-evidence.ts` (types/resolver), `date-evidence-sql.ts` (SQL projection), `date-repair-dto.ts` (Zod transport schemas), `date-repair-repository.ts` (evidence/preview/audit persistence), `date-repair-service.ts` (preview/apply), and adjacent tests.

New migration: `lib/db/migrations/20261002_booking_date_provenance.sql`; register through `lib/db/src/migrations.ts`. New owner routes: `artifacts/api-server/src/routes/booking-date-repairs.ts`, mounted using the same router registration as `event-date-coverage.ts`. Frontend: `artifacts/adventure-zone/src/features/event-date-coverage/BookingDateRepairs.tsx` and `booking-date-repairs-api.ts`, integrated in `pages/EventDateCoveragePage.tsx`.

Shared contracts, defined in Task 1:
- `EvidenceKind = "verified_event" | "verified_reservation" | "sales_milestone" | "unknown_import" | "unresolved_conflict"`.
- `EndpointEvidence = { field: "public_start" | "public_end" | "reservation_start" | "reservation_end"; kind: EvidenceKind; value: string | null; sourceRef: { type: string; id: string; revision: string }; semantics: "instant" | "inclusive_date" | "exclusive_date"; revision: number }`.
- `DateEvidenceInput = { bookingId: string; rawPublic: { start: string | null; end: string | null }; rawReservation: { start: string | null; end: string | null }; evidence: EndpointEvidence[] }`.
- `ResolvedDates = { rawPublic: DateEvidenceInput["rawPublic"]; rawReservation: DateEvidenceInput["rawReservation"]; publicWindow: { start: string; end: string } | null; reservationWindow: { start: string; end: string } | null; evidenceState: "verified" | "needs_review"; reviewReasons: string[] }`.
- `resolveBookingDates(input: DateEvidenceInput): ResolvedDates`.
- `DateRepairProposal = { bookingId: string; reason: string; endpoints: EndpointEvidence[]; clearFields: EndpointEvidence["field"][] }`.
- `DateRepairPreview = { id: string; bookingId: string; actorId: string; expiresAt: string; fingerprint: string; before: DateEvidenceInput; after: DateEvidenceInput; impacts: { reasons: string[]; affectedBookingIds: string[]; blocked: boolean } }`.
- `ApplyDateRepairInput = { previewId: string; fingerprint: string; requestKey: string }`; `DateRepairReceipt = { id: string; bookingId: string; previewId: string; requestKey: string; appliedAt: string }`.

Evidence references reuse existing immutable source records, calendar references and saved business evidence; no new source snapshot store. Preview/audit JSON records store exact evidence references and before/after values.

### Task 1: Add evidence storage and shared resolver

**Files:** New migration, feature `date-evidence.ts`, `date-evidence-sql.ts`, `date-evidence.test.ts`, `date-evidence.pglite.test.ts`; modify migration registry.

**Interfaces:** Produces shared contracts above and `bookingDateProjectionSql(bookingAlias: string, windowAlias: string, evidenceAlias: string): SQL`. Alias arguments are internal constants, never HTTP input.

- [x] Write resolver and migration regressions with these assertions:
```ts
expect(resolveBookingDates(sentinel9999).publicWindow).toBeNull();
expect(resolveBookingDates(partialVerified).reviewReasons).toContain("INCOMPLETE_PUBLIC_WINDOW");
expect(resolveBookingDates(actWithLaterManualCorrection).publicWindow).toEqual(correctedWindow);
expect(resolveBookingDates(verifiedCrossYear).publicWindow).toEqual(crossYearWindow);
expect(resolveBookingDates(reversed).evidenceState).toBe("needs_review");
```
Include JS/SQL parity for sentinel, leap-day, malformed, sales-only, conflicting equal-authority evidence, partial, cross-year and exclusive-end DST fixtures; migration replay leaves booking rows byte-for-byte unchanged.
- [x] Run `pnpm --filter @workspace/api-server exec vitest run src/features/booking-date-repair/date-evidence.test.ts src/features/booking-date-repair/date-evidence.pglite.test.ts`; expect regression failure before implementation.
- [x] Implement resolver and SQL policy. Reject year 9999, invalid/reversed intervals and unverified endpoints. Explicit verified endpoint evidence matching the current raw value outranks historical ACT sales evidence; missing provenance yields review. Preserve independent public/reservation windows and original exclusive semantics. Add endpoint-evidence rows, persisted previews, immutable audit receipts and unique actor/request key constraints. An existing NOT NULL operational-window row can only be cleared as a whole, through reviewed apply; never invent a missing endpoint.
- [x] Run the same tests; expect all pass.
- [x] Commit: `feat: add booking date evidence and resolver`.

### Task 2: Stop ACT sales dates from becoming event dates

**Files:** Modify `artifacts/api-server/src/features/act-replacement/normalizers/opportunity-normalizer.ts` and `drizzle-apply-repository.ts`; add adjacent `opportunity-date-provenance.test.ts` and `opportunity-date-provenance.pglite.test.ts`.

**Interfaces:** Consumes Task 1 endpoint evidence; preserves existing normalizer/apply interfaces and `act_source_records` identity.

- [x] Write assertions: normalized estimated/actual close dates do not populate public start/end; raw snapshots still contain both original values; applying the same source twice produces one sales-evidence identity; replay does not erase later verified manual dates or alter status.
- [x] Run `pnpm --filter @workspace/api-server exec vitest run src/features/act-replacement/normalizers/opportunity-date-provenance.test.ts src/features/act-replacement/opportunity-date-provenance.pglite.test.ts`; expect failure.
- [x] Replace the two close-date mappings with labeled sales evidence attached to existing source identity. Do not infer any public date from source linkage or creation time. Import replay uses existing duplicate protections; provenance writes follow the importer transaction.
- [x] Rerun tests; expect pass.
- [x] Commit: `fix: preserve ACT close dates as sales evidence`.

### Task 3: Use effective windows consistently

**Files:** Modify `features/chatgpt-connection/operational-reads.ts`, `features/event-date-coverage/effective-event-date.ts`, `features/outreach-planner/outreach-capacity-evidence.ts`, `features/leg-planning/planning-facts.ts`, `routes/calendar.ts`, booking summary/repository readers, and `features/routes/travel-leg-map-windows.pglite.test.ts` (all backend paths under `artifacts/api-server/src/`); modify frontend `features/bookings/booking-list-visibility.ts`. Add backend `booking-date-repair/date-readers.pglite.test.ts`.

**Interfaces:** Consumes resolver and SQL projection; adds raw/effective/evidence/reasons to responses without removing current fields. Existing cursor scoping and access controls remain intact.

- [x] Write real-query assertions: 18 synthetic 2026→9999 lead fixtures appear in review/undated results, zero valid 2027 overlap windows; two verified 2027 fixtures remain. Verify pagination without missing/duplicate rows, scoped manager reads, cross-year, Denver DST and exclusive boundary results. Assert an unknown committed booking makes capacity `needs_review`, never `fits`; incomplete leads do not become commitments.
- [x] Run `pnpm --filter @workspace/api-server exec vitest run src/features/booking-date-repair/date-readers.pglite.test.ts src/features/routes/travel-leg-map-windows.pglite.test.ts`; expect failure.
- [x] Replace endpoint COALESCE fallbacks with Task 1 policy in schedule/map, connector package/resource/demand/attribution reads, coverage/profile summaries and allocation/readiness facts. Retain unresolved commitment obligations separately so absence of a valid interval cannot free capacity. Show known-season unresolved cards without a continuous bar. Use backend evidence in booking visibility.
- [x] Rerun focused tests and existing calendar, connector and leg-planning suites; expect pass.
- [x] Commit: `fix: use verified booking windows across operational reads`.

### Task 4: Implement transactional preview and apply

**Files:** New repository/service/DTO files and `date-repair-service.test.ts`, `date-repair-transaction.pglite.test.ts`, `date-repair-concurrency.postgres.test.ts`; modify planning writer hooks only if date-specific guard coverage requires it.

**Interfaces:** `BookingDateRepairService.preview(proposal: DateRepairProposal, actorId: string): Promise<DateRepairPreview>`; `apply(input: ApplyDateRepairInput, actorId: string): Promise<DateRepairReceipt>`; repository persists preview/receipt and loads exact revisioned evidence.

- [x] Write tests asserting preview changes no booking/reservation; exact season/profile/package selection is retained; unrelated sibling bookings/history/status remain equal. Stale booking/window/source evidence and expired previews return 409. Actor mismatch, request-key payload mismatch, audit insertion failure and concurrent reservation updates commit no mutation. Identical replay returns the same receipt.
- [x] Run `pnpm --filter @workspace/api-server exec vitest run src/features/booking-date-repair/date-repair-service.test.ts src/features/booking-date-repair/date-repair-transaction.pglite.test.ts`; expect failure.
- [x] Implement persisted 30-minute previews. Fingerprint exact booking, operational window, source/evidence revisions, assignments, active holds, planning facts and proposed changes. Apply uses `planningWriterTransaction(db, work, "booking-date-repair", "commitment")`, acquiring the existing allocation mutex before row locks; re-read/fingerprint/recompute impacts inside it. Check replay before stale rejection, and bind request key to actor and exact payload. Reject shortening/clearing active obligations until existing explicit reconciliation resolves them; never silently update hold/crew windows. Write endpoints, evidence, immutable receipt and audit atomically; invalidate allocation/planning facts. No network calls inside the transaction.
- [x] Run tests plus PostgreSQL concurrency test with the repository test database configuration; expect pass, with two simultaneous stale applies producing one receipt and one 409. PGlite does not substitute for mutex/concurrency verification.
- [x] Commit: `feat: add audited booking date repair transactions`.

### Task 5: Add scoped owner routes and review UI

**Files:** New owner routes/API/UI files from map; modify EventDateCoveragePage, existing router mount, and relevant query invalidation helpers. Add `routes/booking-date-repairs.test.ts` and frontend `features/event-date-coverage/BookingDateRepairs.test.tsx`.

**Interfaces:** GET `/event-date-coverage/booking-date-repairs` (bounded exact-booking review queue), POST `/event-date-coverage/booking-date-repairs/preview` (proposal), POST `/event-date-coverage/booking-date-repairs/apply` (apply input). Strict schemas reject client actor/source revision fabrication; derive actor from authenticated session. Reuse owner middleware and service contracts.

- [x] Write route tests: owner can preview/apply, unauthenticated/non-owner cannot, malformed or extra fields reject. UI assertions: same-profile records display exact booking/season/package/source; preview shows old/new public and reservation dates, evidence semantics and impacts; no source-selection auto-apply; blocked preview cannot apply; 409 retains draft and prompts refreshed preview; late response from prior selection cannot overwrite current draft.
- [x] Run backend route and frontend component test files with each package's Vitest command; expect failure.
- [x] Implement “Booking date repairs” in Date Coverage. Display saved sources and evidence, classifications, clear proposals and unresolved conflicts. Provide new-season link to existing booking creation. Refresh affected booking/profile/calendar/map/route/readiness queries after receipt. Preserve drafts on errors. Manager/boss views expose evidence only, without owner actions.
- [x] Rerun route/component tests; expect pass.
- [x] Commit: `feat: add owner booking date repair review`.

### Task 6: Verify integration and deliver draft PR

**Files:** Add `docs/booking-date-repair-owner-guide.md` and focused CI workflow `.github/workflows/booking-date-repair.yml`; update plan checkboxes with actual results.

**Interfaces:** No new production API; consumes Tasks 1–5.

- [x] Add end-to-end regression `date-repair-flow.pglite.test.ts`: imported sales record → unresolved review → evidenced preview → apply → corrected overlap/readiness, preserving commercial status, packages and history. Assert source/audit failure rolls back. Run it red before filling any integration gaps.
- [x] Wire CI to Node 22, frozen pnpm install, focused backend/frontend tests and PostgreSQL concurrency suite. Complete integration; run regression green.
- [x] Run `pnpm run typecheck:libs`, both affected package typechecks, `pnpm --filter @workspace/api-server build`, and `pnpm --filter @workspace/adventure-zone build`. Compare baseline failures without hiding newly introduced errors.
- [ ] Authenticated browser checks at 360px, 768px and desktop: **unverified**, because no supported authenticated browser runtime is available. Component tests are not visual verification.
- [x] Document owner onboarding, conservative legacy review, source-selection rules, clearing/commitment limitations, migration behavior and verification results. No live data corrections are part of verification.
- [x] Commit: `test: verify booking date repair integration`.
- [x] Complete the chosen execution method's independent review, address findings, then create a draft PR linked to the approved spec with concrete test evidence and limitations. Stop before merge/deployment.

## Verified checkpoint

Native run [36973212656](https://github.com/epivene/adventure-zone-command-center/actions/runs/36973212656) at `a63a71acd62178c9ff907e58438d1e77f216aa84`: backend88/88; frontend21/21; shared6/6; planning123/123; frontendplanning32/32; operations79/79; connectedviews73/73. Both builds pass. Package typechecks introduce zero errors: API104 inherited, frontend127 inherited. ACT/calendar/outreach gates retain two/three exact baseline failures, documented in the owner guide and progress ledger. Authenticated responsive browser checks are unverified. Final fresh review and draft synchronization are recorded in the progress ledger.

## Self-review

All spec sections map to Tasks 1–6; source reuse and sales imports to Task 2, operational readers to Task 3, transaction/audit safeguards to Task 4, owner UX/access to Task 5, and delivery/mobile verification to Task 6. Shared types and preview/apply signatures are consistent. The five Review Focus cases have owning regression assertions. No public dates for the 18 historical records are invented by this plan.

## Final Native delivery checkpoint

One fresh independent review at `41e316da95c9010f796424ad206ad2750458911a` identified four Important findings and one deferred Minor. All Important findings received RED reproducers and ONE fix pass, without re-review. Final [run 36975066885](https://github.com/epivene/adventure-zone-command-center/actions/runs/36975066885) attempt2 verifies code `683c7c5376e06067de3e7e198ce23a6dc4091e7f`: backend94/94; frontend22/22; shared6/6; planning123/123; planningUI32/32; operations79/79; connectedviews73/73. Both jobs, shared typecheck and both builds pass; API104/104 and UI127/127 diagnostics introduce zero errors; compatibility retains two/three baseline failures. Attempt1's intermittent assistant-context assertion is disclosed in the ledger and passes the unchanged retry. All declined-to-judge items have Rulings/costs. Responsive browser usability, live historical dates and combined integration with newer main remain unverified. Delivery is the existing approved draft PR #993; no merge/deployment/live correction.
