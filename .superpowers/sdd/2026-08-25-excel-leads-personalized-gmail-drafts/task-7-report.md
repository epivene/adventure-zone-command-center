# Task 7 implementation report — safe email rendering

## Status

**DONE — breaker review fix round 5 closes I1–I3 and M1–M2.**

## Branch and commits

- Repository/branch: `epivene/adventure-zone-command-center` / `feat/lead-safe-email-rendering`
- Base: `9d1778937645cc6244e41da9344849b516fd0eef`
- Implementation head before this report-only commit: `6fd27b9da3c39bf86e9d1355eb9ffbb340b813cb`
- RED-first tests: `ed4456db`, `db86ff6c`, `af142bfb`
- Implementation: `56b73be9`, `ee139c33`, `617599c2`, `824a6c08`, `3d71e7af`, `4fb28870`, `958fcb4b`, `eeb694e9`, `2f0c13d2`, `ef765e5d`, `5e2a791b`, `0e7173e8`, `29aa32e0`, `0c28a3cc`, `27785497`, `c6b4a70f`, `107c4110`, `496c31f3`, `4a42cd3b`, `da16cc11`, `736048b7`, `ec3cc99b`, `3a8ed5cb`, `2ae51eb8`, `80f0d22b`
- TDD correction: `3df3c263` fixes the actual rendered subject defect discovered by executable tests: `(Aspen) CO`, not `(Aspen CO)`.

## Implemented surfaces

- Pure 60-minute injectable draft-readiness policy with fail-closed availability, relationship, territory, fit, recipient, and exact stable `DO NOT SEND` matching.
- Pure package-filtered renderer with exact approved copy, no commercial-rule copy, no restricted capacity, no invented video URLs, and no normal body when no normal package is available.
- Audited communication-block policy and repository: profile/contact/full normalized email/source row/internal preview, active-only matching, idempotent create/remove, and retained events.
- Forward `20260826_lead_safe_email.sql` migration: fail-closed territory/fit defaults and checks; block/event tables, indexes, exact-target constraint, and creation audit trigger.
- Drizzle lead schema additions and startup migration registration/readiness checks.
- Owner lead-intake controls for listing, creating, removing, and viewing block history; explicit optimistic territory/fit review updates.
- Server-owned preview endpoint loading confirmed lead data, latest persisted availability, active blocks, and active approved 2026 template before rendering. No Gmail mutation/send code was added.
- Versioned `lead_introduction_2026_prepaid` communication-template seed through the existing seed/repository architecture.
- Client methods and lead-review UI components for safe preview, DO NOT SEND controls, and territory/fit review. Preview displays recipient, profile/event, verified dates, Calendar evidence count, normal package counts, blockers, subject/body, and withholds body on any blocker.

## Verification

### RED

1. `task1-local`: `./node_modules/.bin/vitest run src/task7-block-preview.test.ts`
   - Failed as expected: imports `communication-block-policy` and `lead-email-preview-service` were missing.
2. `implementation`: `./node_modules/.bin/vitest run task7-migration.pglite.test.ts --environment node`
   - Failed as expected: `20260826_lead_safe_email.sql` did not exist.
3. Exact fetched branch policy/renderer tests initially failed on the required subject: received `Aspen Filmfest (Aspen CO) ...`; expected `Aspen Filmfest (Aspen) CO ...`.

### GREEN

1. `task1-local`: `./node_modules/.bin/vitest run src/lead-email-renderer.test.ts src/communication-block-policy.test.ts src/task7-block-preview.test.ts && ./node_modules/.bin/tsc --noEmit`
   - Passed: 3 files, 10 tests; TypeScript exit 0.
2. `implementation`: `./node_modules/.bin/vitest run task7-migration.pglite.test.ts --environment node`
   - Passed: 1 file, 1 PGlite migration/idempotency/audit test.

## Architecture reuse and migration behavior

The preview consumes Task 6 persisted package availability rather than making Calendar I/O. It uses the existing lead-intake, communication-template, package availability, owner-router, migration/startup, and client/UI locations. The forward migration backfills existing rows to `needs_review`, so older leads are not draft-ready until explicitly reviewed; rerun preserves existing blocks and statuses. Existing private/user-authored templates are untouched by the seed.

## Known limitations and concerns

- This is a connector-backed partial checkout. The full API route suite, complete Drizzle repository integration suite, frontend component suite, app typecheck, and frontend build could not be executed. The UI was source-reviewed after implementation; no full-suite result is claimed.
- GitHub reported no CI statuses for head; that is not a passing CI result.
- The future Gmail draft task must call `evaluateDraftReadiness` again at its boundary; Gmail mutation/send was deliberately not added here.

## Review fix round 1

- Added executable RED/GREEN regression coverage for the normal-package allowlist and stale availability snapshot version/window behavior. The pure harness now passes 5 files / 12 tests plus TypeScript; the PGlite migration harness passes the strict discriminated-target checks.
- Added a central approved-normal package allowlist, preview snapshot-version/window fail-closed behavior, required preview expected version and a 409 mismatch response, strict route target validation/existence checks, a matching DB target constraint, and duplicate-key retry loading for concurrent active block creation.
- Remaining review concerns: the preview route has not been converted to a single transaction with row locking; the template seed/renderer still need consolidation to one fully versioned approved-copy definition/provenance contract; startup readiness invariants, typed sanitized preview DTO/UI invalidation, and full repository/route/component tests remain incomplete in this partial checkout.

## Review fix round 2

- Added sanitized typed preview fields (source row/version, snapshot version, verified range, bounded Calendar identifiers/conflict flags, allowlisted package counts, review statuses, blockers, and nullable copy), expected-version client request handling, and keyed preview reset on row change.
- The preview service now rejects a snapshot whose review version or proposed window differs from the current lead and the route validates expected version; the lead row query uses a row lock where supported.
- Remaining load-bearing work is still required: a true single-transaction preview read with all dependent reads on that transaction, one authoritative versioned approved template definition consumed by seed and renderer, full startup-schema repair invariants, and route/repository/component integration coverage.

## Review fix round 3

- Added `APPROVED_LEAD_INTRODUCTION_2026` as a structured immutable approved-copy definition; renderer consumes its opening/package/services/closing/signature and the seed imports the same definition. Preview explicitly ensures template seeding before lookup.
- Re-ran the executable allowlist and snapshot-version pure regressions: 2 files / 2 tests plus TypeScript passed.
- Residual: the requested fully transactional preview repository, exact template-record provenance validation, full startup partial-schema repair invariant test, and repository/route/component integration suite were not completed in this connector/harness round.

## Review fix round 4

### Commits

- `aa87adb84f3725b8ba71d43bc7c63ebd5d6ef1a5` — transactional preview repository/service, structured version conflict, immutable template provenance/version, exact selected record, route handler and integration contracts.
- `e6e169e71a3b9f2146dae15eb934c0ea57646b99` — communication-block repository concurrency fix, complete startup readiness/repair invariants, retained-history FKs, Drizzle constraints/indexes, and real PGlite coverage.
- `b61c74539c3884f6935f8c02891608f774f16be0` — typed evidence UI plus row/version/safety-mutation invalidation and mutation error handling.
- `e3efc0a225f611d84628b5f6bbb243afb7e37e01` — ensure the persisted template-version column exists immediately before the approved seed runs, including on a fresh database.

### A — transactional preview consistency

- Added `LeadEmailPreviewRepository.load`, which opens exactly one `db.transaction`, locks only the current `lead_import_rows` row with `FOR UPDATE OF lead_import_rows`, checks `expectedVersion`, and performs snapshot, active-block, source-document, and template reads through that transaction object.
- A real PGlite regression first failed with PostgreSQL error `FOR UPDATE cannot be applied to the nullable side of an outer join`; scoping the lock to the lead row fixed it without weakening the transaction.
- A latest snapshot whose `reviewVersion` or proposed date window differs from the locked lead returns `availability_stale_for_lead_version` with null subject/body. Expected-version mismatches return a structured `409` containing expected/current versions.

### B — exact approved template provenance

- Persisted `template_version` and expanded the shared immutable `APPROVED_LEAD_INTRODUCTION_2026` definition to include exact version, source filename/note/reviewer, full conditional body skeleton, and all approved paragraphs.
- Seed and renderer consume that same definition. The service ensures business/template seeding and the version column before the preview transaction.
- Transactional selection requires the exact code, version, active state, company owner, system creator, office/email/lead-introduction shape, non-null review time, expected reviewer, exact subject/body/source note, and exact source document filename. Private, unreviewed, wrong-version, wrong-body, or wrong-source rows become `template_not_approved` blockers and cannot produce copy.

### C — startup readiness and repair

- Readiness now verifies all block/event columns, types, required nullability/defaults, primary keys, exact-target and action checks, three stable-target `ON DELETE RESTRICT` FKs, retained event-history FK, active unique and lookup/history indexes, trigger, and creation-audit function.
- The idempotent migration repairs missing columns/constraints/indexes/FKs/function/trigger and fails closed when unsafe existing data or incompatible types cannot be repaired.
- Real PGlite starts from partial tables, proves readiness false, applies the migration twice, proves readiness true, exercises creation audit, exact target checks, action checks, and restrictive deletion. A same-name `CHECK (true)` remains not ready.

### D — focused executable integration coverage

#### RED

- Preview repository/handler modules were absent.
- Startup test failed because `isCommunicationBlockSchemaReady` did not exist.
- Repository integration failed on concurrent `23505`, allowed parent deletion to cascade history, and accepted nonexistent stable target IDs.
- Frontend component test could not find source row/version/approval/template evidence and retained rendered copy after invalidation.
- Real transactional preview failed on the unscoped outer-join row lock.

#### GREEN

- `implementation`: `vitest run task7-round4-tests.test.ts task7-migration.pglite.test.ts --environment node` — 2 files / 13 tests passed.
- `implementation`: `vitest run task7-round4-renderer.test.ts --environment node` — 1 file / 6 tests passed.
- `task1-local`: `vitest run src/task7-round4-preview-component.test.tsx src/lead-email-renderer.test.ts src/task7-preview-version.test.ts src/task7-allowlist-regression.test.ts && tsc --noEmit` — 4 files / 10 tests passed; TypeScript exit 0.

Coverage now executes real PGlite/Drizzle repository idempotency, concurrent duplicate creation, audit/history retention, target/FK enforcement, partial-schema repair, transactional preview loading, stale version/window blocking, exact template provenance, and optimistic conflict behavior. The route contract executes status/DTO mapping and verifies raw source events/reservations are absent. The component contract executes row reset, safety invalidation, and all required sanitized evidence fields.

## Remaining concerns

- The connector-backed workspace still is not a complete repository checkout, so the full monorepo suite, API/frontend package typechecks, and production frontend build were not available. Focused backend/frontend tests and the available TypeScript harness were run; no unavailable suite is claimed green.
- No Gmail draft creation, Gmail mutation, send route, PR, or merge was added.

## Breaker review fix round 5

### Commits

- `d255c0fa81a5f200024feb852aa0046eb6a6a9ef` — backend window/conflict/freshness contracts and controlled template startup lifecycle.
- `6fd27b9da3c39bf86e9d1355eb9ffbb340b813cb` — global internal-preview controls, required removal reason, and aggregate conflict-summary UI.

### Closed findings

- **I1:** Preview snapshot validation now compares the persisted Task 6 window with shared `proposedBookingWindow(confirmed start/end)`. Integration coverage accepts the valid two-day/one-day buffered snapshot and rejects date or review-version changes.
- **I2:** `communication_templates.template_version` is part of controlled startup schema readiness. Under the startup advisory lock, schema migration runs before conflict-safe insert-first seeding and exact approved-seed readiness. Exact re-seeding is a true no-op preserving reviewer/reviewed/updated timestamps. Preview requests only transactionally read/verify and never alter or seed.
- **I3:** The sanitized conflict total comes from the persisted aggregate reservations that drive Task 6 readiness, while evidence projection reports total/displayed counts and truncation. A duplicate iCal instance with cross-calendar disagreement blocks readiness and reports one aggregate conflict even though both source classifications are individually explicit.
- **M1:** The owner UI can create a clearly labelled global `internal_preview` block without a target. Active blocks require a user-entered removal reason, which is submitted verbatim after trimming.
- **M2:** Availability timestamps more than the documented five-minute future-clock skew are stale; the exact boundary is accepted and one millisecond beyond it is rejected.

### RED-first evidence

- Backend breaker harness: 18 tests initially produced 11 expected failures covering the buffered Task 6 window, aggregate conflict summary/truncation, future timestamp skew, partial template schema/readiness, concurrent first seed, exact reseed timestamps, startup ordering, and preview request mutation.
- Frontend breaker harness: 4 tests initially produced 3 expected failures covering targetless global preview creation, required removal reason, and aggregate summary rendering.

### Final GREEN verification

- `implementation`: `./node_modules/.bin/vitest run task7-round5-backend.test.ts task7-migration.pglite.test.ts --environment node` — 2 files / 19 tests passed.
- `implementation`: `./node_modules/.bin/vitest run task7-round4-tests.test.ts task7-round4-renderer.test.ts task7-round4-block-repo.test.ts task7-round4-route.test.ts --environment node` — 4 files / 23 tests passed.
- `implementation`: `./node_modules/.bin/vitest run task7-round5-startup-unit.test.ts --environment node -t 'checks every|runs both|fails closed when|partial availability|requires definitions'` — 5 passed / 1 skipped. The skipped full-migration case requires four unchanged SQL files absent from the connector-backed partial checkout; startup schema/version repair itself is covered by the real safe-email PGlite migration test in the 19-test run.
- `task1-local`: `./node_modules/.bin/vitest run src/task7-round5-frontend.test.tsx src/task7-round4-preview-component.test.tsx src/lead-email-renderer.test.ts src/task7-preview-version.test.ts src/task7-allowlist-regression.test.ts` — 5 files / 14 tests passed.
- `task1-local`: `./node_modules/.bin/tsc -p tsconfig.round5.json --noEmit` — exit 0.

The temporary backend schema/type harness does not model production Drizzle enum/default metadata, so its standalone TypeScript errors are stub artifacts; backend Vitest compilation plus real PGlite behavior are green. No full monorepo/CI result is claimed. No Gmail/send, PR, merge, or restricted/commercial data was added.
