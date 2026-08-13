# Automatic ACT Review Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the owner-approved ACT cleanup policy into one safe, repeatable action that resolves obvious review issues, imports ambiguous identities as new records, favors ACT field values, excludes unsupported whole records, and leaves only genuine uncertainty for manual review.

**Architecture:** Add a pure proposal engine that evaluates the current manifest, archived source context, and owner-visible local targets. A command service will submit the heterogeneous proposals to one version-fenced, idempotent database transaction, rebuild the manifest once, and return resolution counts. The existing safe-import pipeline remains the only code that writes profiles.

**Tech Stack:** TypeScript, Express, Zod, Drizzle ORM/PostgreSQL, Vitest, React, TanStack Query, pnpm.

## Global Constraints

- Never delete `act_source_records`, source versions, observations, or raw snapshots.
- Never write organizations, contacts, bookings, activities, or calling lists during automatic review.
- Preserve current run ownership, manifest-digest, source-version, target-existence, and conflict-fingerprint checks.
- Normalize full names with the same whitespace/case rules used by review target search; one exact normalized result is safe, zero or multiple results are not.
- Evaluate relationship and unassigned context before the broad ambiguous-identity fallback.
- Treat `unsupported_field` as diagnostic only. Only `unsupported_record` receives `ignore_source`.
- Rebuild the manifest exactly once for a newly accepted request. A replay returns the previously stored result without adding decisions or rebuilding.
- Do not auto-resolve a required relationship when no reliable target exists.
- Do not broaden exact-name matching to fuzzy or substring matching.

---

## Task 1: Define the automatic proposal model and precedence

**Files:**

- Create: `artifacts/api-server/src/features/act-replacement/automatic-review-resolver.ts`
- Create: `artifacts/api-server/src/features/act-replacement/automatic-review-resolver.test.ts`
- Reference: `artifacts/api-server/src/features/act-replacement/manifest-builder.ts`
- Reference: `artifacts/api-server/src/features/act-replacement/review-reader.ts`
- Reference: `artifacts/api-server/src/features/act-replacement/review-command-service.ts`

- [ ] Write failing table-driven tests for the approved precedence: relationship/unassigned first, duplicate identity second, per-slot relationships third, remaining ambiguity fourth, field conflicts fifth, unsupported whole records sixth.

- [ ] Define `AutomaticReviewProposal` as a discriminated union whose actionable variants map exactly to existing durable decisions:

  ```ts
  type AutomaticReviewProposal =
    | { kind: "decision"; sourceRecordId: string; sourceVersionId: string; scope: Decision["scope"]; decision: Decision["decision"]; fieldName: string | null; relationshipSlot: string | null; targetEntityType: string | null; targetEntityId: string | null; reason: AutomaticReviewReason }
    | { kind: "manual_review"; sourceRecordId: string; sourceVersionId: string; reason: AutomaticReviewReason };
  ```

- [ ] Add `AutomaticReviewResolutionSummary` counters for `linkedExisting`, `importedNew`, `relationshipsAssigned`, `relationshipsOmitted`, `actValuesSelected`, `unsupportedIgnored`, `manualReview`, and `decisionsCreatedOrReplayed`.

- [ ] Implement `proposeAutomaticReview(input)` as a pure deterministic function. Emit `duplicate_identity: keep_separate` for import-new, `duplicate_identity: link_existing` for a reliable identity, `relationship: assign_parent` or `keep_unlinked` per stable slot, `field_conflict: use_source` per field, and `unsupported_record: ignore_source` only for whole-record issues.

- [ ] Prove with tests that a record carrying both `ambiguous_match` and `relationship_unresolved` is not prematurely marked `keep_separate`, and that unsupported fields on a useful record are preserved.

- [ ] Run `pnpm --filter @workspace/api-server test -- automatic-review-resolver.test.ts` and confirm the new suite passes.

- [ ] Commit: `feat(act-review): define automatic resolution policy`

## Task 2: Resolve exact identities and contextual targets without guessing

**Files:**

- Modify: `artifacts/api-server/src/features/act-replacement/automatic-review-resolver.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/automatic-review-resolver.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-reader.ts`
- Reference: `artifacts/api-server/src/features/act-replacement/matching/context-clue-resolver.ts`
- Reference: `artifacts/api-server/src/features/act-replacement/review-display.ts`

- [ ] Add failing tests for one exact Natalie Andelin contact, two exact Natalie Andelin contacts, no name match, conflicting clue families, and each supported clue family: company, email/phone, location, archive relationship, event context, and narrative context.

- [ ] Export one canonical `normalizeAssignmentTargetLabel()`/exact-label helper from `review-reader.ts` and use equality—not `includes()`—for automatic matching.

- [ ] Define `AutomaticReviewContext` with bounded `ReviewSourceRecord` projections and owner-visible `ReviewTargetProjection` candidates keyed by entity type. Keep raw ACT snapshots out of the resolver response and logs.

- [ ] Implement reliable-target selection: accept one unique exact normalized full-name target; otherwise accept one target supported by authoritative evidence or two independent clue families; reject target disagreement, conflicting direct-contact evidence, and multiple exact names.

- [ ] Resolve each `stableRelationshipIssues(...)` slot independently and restrict candidates to `expectedParentTypes`. Emit `keep_unlinked` only when `canImportStandalone === true`; otherwise emit `manual_review`.

- [ ] Add regression tests showing a source identity may link to Natalie while a separate unresolved parent slot is still evaluated independently, and that required relationships never disappear.

- [ ] Run `pnpm --filter @workspace/api-server test -- automatic-review-resolver.test.ts review-reader.test.ts`.

- [ ] Commit: `feat(act-review): resolve exact contextual matches`

## Task 3: Build proof-bound heterogeneous decision requests

**Files:**

- Modify: `artifacts/api-server/src/features/act-replacement/review-command-service.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-command-service.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/automatic-review-resolver.ts`

- [ ] Write failing service tests for a mixed batch containing `link_existing`, `keep_separate`, `assign_parent`, `keep_unlinked`, multiple `use_source` fields, and `ignore_source` decisions.

- [ ] Add `AutomaticReviewDecisionInput` and `ResolveAutomaticReviewAndRebuildInput` types. Unlike `SaveDecisionsAndRebuildInput`, each generated selection carries its own scope, decision, field, slot, target, and source version.

- [ ] Add `automaticReviewRequestFingerprint(...)` that sorts the full heterogeneous decision list by source ID, scope, field, slot, and target before hashing. The fingerprint must include `runId`, expected manifest digest, actor, and policy version.

- [ ] Extract/reuse validation so every generated decision still passes `validateIndividualDecisionAgainstCurrentState()`. Generate field-conflict proof from locked current source/local values with `decisionWithReviewedProof()`; do not manufacture a client-style token from stale UI data.

- [ ] Add `ReviewCommandService.resolveAutomatically({ runId, expectedManifestDigest, requestKey, requestedBy })`, which validates the command envelope and delegates context loading, proposal generation, and persistence to one new store boundary. This avoids computing proposals from data that can change before the transaction locks it.

- [ ] Test empty/no-op runs, deterministic ordering, replay fingerprint equality, stale manifest rejection, stale source rejection, duplicate target rejection, and concurrent local field edit rejection.

- [ ] Run `pnpm --filter @workspace/api-server test -- review-command-service.test.ts automatic-review-resolver.test.ts`.

- [ ] Commit: `feat(act-review): prepare automatic decision batches`

## Task 4: Persist the automatic batch atomically and rebuild once

**Files:**

- Modify: `artifacts/api-server/src/features/act-replacement/review-sql-adapter.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-sql-adapter.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/one-time-import.integration.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/production-review.ts`
- Reference: `lib/db/src/schema/index.ts`
- Reference: `lib/db/migrations/015_act_bulk_review_requests.sql`

- [ ] Write a failing adapter test asserting one transaction locks the owned run and all selected source rows, validates the expected digest, writes heterogeneous decisions, and records one request in `act_replacement_bulk_review_requests`.

- [ ] Extend `ReviewCommandStore` with `resolveAutomaticReviewAndRebuild(runId, input)`. Implement it in the in-memory and Drizzle stores so service tests and production use the same contract and proposal generation happens from the state protected by that store's atomic boundary.

- [ ] In the Drizzle implementation, lock the run, load the current manifest/context, identify its participating sources, lock those source rows in stable order, then reload any lock-sensitive source/target/conflict values. Run `proposeAutomaticReview()` on that protected context, validate every proposal, insert decisions, and save the request fingerprint plus decision IDs using the existing bulk request table.

- [ ] Rebuild only after the decision transaction commits. Update the request row with the rebuilt digest and reviewed overwrite operation IDs. On a matching replay, derive the same resolution summary from stored decisions and return without rebuilding; on a different fingerprint, return `request_replay_mismatch`.

- [ ] Ensure partial insertion rolls back completely if any proposal is stale or invalid. If the post-commit rebuild fails, leave the request in the existing pending-rebuild state so a retry completes recovery without duplicating decisions.

- [ ] Add a PostgreSQL integration scenario with Natalie Andelin, an import-new ambiguous contact, an optional missing relationship, an ACT field overwrite, and an unsupported whole record. Assert one rebuilt manifest, expected active decisions, unchanged archive/version/observation counts, and identical replay output.

- [ ] Add negative integration cases for duplicate Natalie targets, a required missing parent, stale source version, and changed local conflict fingerprint; assert those items remain reviewable and no unsafe decision is written.

- [ ] Run `pnpm --filter @workspace/api-server test -- review-sql-adapter.test.ts one-time-import.integration.test.ts` with the repository's PostgreSQL test environment enabled.

- [ ] Commit: `feat(act-review): persist automatic cleanup atomically`

## Task 5: Expose the authenticated cleanup endpoint

**Files:**

- Modify: `artifacts/api-server/src/routes/act-replacement.ts`
- Modify: `artifacts/api-server/src/routes/act-replacement.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/production-review.ts`

- [ ] Add failing route tests for ownership, authentication/server context, exact body validation, success projection, replay, stale digest `409`, and unavailable review runtime.

- [ ] Add `POST /api/migration/act-replacement/runs/:runId/automatic-review` with body:

  ```ts
  { expectedManifestDigest: string; requestKey: string }
  ```

- [ ] Call `review.commands.resolveAutomatically(...)` only after `findOwnedRun` succeeds. Attribute decisions to `context.requestedBy`; never accept an actor or source IDs from the client.

- [ ] Return only bounded counts, remaining manual-review count/reasons, the rebuilt manifest digest, and workflow status. Do not return raw snapshots or unrestricted local candidate fields.

- [ ] Wire the new command through `LazyReviewRuntime` in `production-review.ts` and keep error codes consistent with existing review routes.

- [ ] Run `pnpm --filter @workspace/api-server test -- act-replacement.test.ts` and `pnpm --filter @workspace/api-server build`.

- [ ] Commit: `feat(act-review): add automatic cleanup endpoint`

## Task 6: Add the client call and Review-screen action

**Files:**

- Modify: `artifacts/adventure-zone/src/features/act-replacement/act-replacement-client.ts`
- Modify: `artifacts/adventure-zone/src/pages/ActMigrationPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ActMigrationPage.test.tsx`
- Modify if needed: `artifacts/adventure-zone/src/components/act-replacement/import-review.tsx`

- [ ] Restore/use the current main-branch versions of the page and review component if the implementation checkout is sparse; do not replace them with `.verify-frontend` snapshots.

- [ ] Add failing client/page tests for showing `Resolve obvious issues`, disabling it while busy, sending the current manifest digest and a stable per-click request key, refreshing run/workflow/review data, and rendering returned counts.

- [ ] Add `resolveAutomaticReview(runId, { expectedManifestDigest, requestKey })` to the typed client and map server error codes through the existing error helper.

- [ ] Show the action only for an organized run with review-required outcomes. Explain in plain language that it links unique exact matches, creates new records for remaining ambiguity, uses ACT values, and keeps uncertain cases for review.

- [ ] After success, show an `Automatically resolved` summary with linked/new/relationship/ACT-value/unsupported counts and refresh the paged review queue so resolved rows disappear.

- [ ] Keep manual controls available for `manualReview > 0`; do not claim that all relationships were resolved when required or conflicting slots remain.

- [ ] Run `pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActMigrationPage.test.tsx` and `pnpm --filter @workspace/adventure-zone typecheck`.

- [ ] Commit: `feat(act-review): add automatic cleanup controls`

## Task 7: Verify current-run recovery and the complete import boundary

**Files:**

- Modify: `artifacts/api-server/src/features/act-replacement/one-time-import.integration.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/production-review.test.ts`
- Modify: `artifacts/adventure-zone/src/pages/ActMigrationPage.test.tsx`
- Update: `docs/superpowers/specs/2026-08-12-automatic-act-review-resolution-design.md` only if implementation reveals an approved-behavior correction

- [ ] Add an end-to-end integration test that starts from `complete_with_issues`, runs automatic review, verifies the rebuilt safe closure, approves safe defaults, and imports without writing any profile before the apply step.

- [ ] Simulate interruption after decision commit but before manifest rebuild completion; retry the same request and prove recovery finishes without duplicate decisions or duplicate imported profiles.

- [ ] Assert the archive tables are byte/count equivalent before and after cleanup, while unsupported whole records are absent from apply operations and remain queryable in the archive.

- [ ] Assert remaining review rows are exactly the unsafe cases: duplicate exact names, conflicting evidence, stale field proof, and required unresolved relationships.

- [ ] Run focused backend suites:

  ```bash
  pnpm --filter @workspace/api-server test -- automatic-review-resolver.test.ts review-command-service.test.ts review-sql-adapter.test.ts act-replacement.test.ts one-time-import.integration.test.ts production-review.test.ts
  ```

- [ ] Run frontend verification:

  ```bash
  pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActMigrationPage.test.tsx
  pnpm --filter @workspace/adventure-zone typecheck
  ```

- [ ] Run `pnpm --filter @workspace/api-server build`. Run workspace `pnpm typecheck` and record the known pre-existing `activity-import-service.test.ts` optional `listNotesForContact` mismatch separately if it is still present; do not hide new failures behind that baseline.

- [ ] Review logs and API projections for raw ACT data, email, or phone leakage; automatic-review logs should contain run ID, request key/fingerprint, counts, status, and error code only.

- [ ] Commit: `test(act-review): verify automatic cleanup recovery`

## Task 8: Final review and rollout handoff

**Files:**

- Review all files changed above
- Update operational documentation only where the repository already documents ACT replacement rollout

- [ ] Compare the final diff against every approved policy and success criterion in `docs/superpowers/specs/2026-08-12-automatic-act-review-resolution-design.md`.

- [ ] Confirm there are no placeholders with `rg -n "TODO|FIXME|placeholder|not implemented"` across changed files.

- [ ] Confirm no migration is needed because the existing bulk request table stores the request fingerprint, decision IDs, reviewed operation IDs, and rebuilt digest. If implementation needs additional durable result fields, add a forward-only migration and schema contract test rather than encoding data in logs.

- [ ] Use `superpowers:requesting-code-review` for an independent correctness review focused on transaction fencing, ambiguous-name behavior, required relationships, archive retention, and replay recovery.

- [ ] Use `superpowers:verification-before-completion`; rerun every focused test/build command from Tasks 1–7 and report exact pass/fail counts.

- [ ] Commit any review fixes in focused commits, then use `superpowers:finishing-a-development-branch` to present merge/publish options.
