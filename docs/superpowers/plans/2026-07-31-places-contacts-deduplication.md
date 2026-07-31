# Places and Contacts Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Places and Contacts the primary workflow, consolidate exact duplicate Act! places during preview, and provide a safe visible path to apply approved records into Command Center.

**Architecture:** Keep organizations/contacts as separate relational entities with explicit relationship tables, but introduce a deterministic place-identity normalizer and duplicate-group proposals in the migration preview. Reuse the existing reviewed-import manifest and batch apply services; expose their status and a single confirmation action in the Act! migration page. Preserve source IDs and make every relationship write idempotent.

**Tech Stack:** Next.js App Router, React, TypeScript, Drizzle ORM/PostgreSQL, Vitest, existing Act! migration preview/apply services.

## Global Constraints

- Use **Places** and **Contacts** as user-facing labels; do not use “People” or “Organizations” in primary navigation.
- Automatically merge only exact normalized place-name + normalized-location matches.
- Near-matches remain review proposals and are never merged automatically.
- Act! is read-only; apply writes only to Command Center.
- Unresolved proposals remain queued.
- Apply is idempotent and supports a small verified first batch.
- Existing direct `/contacts` and `/organizations` URLs remain compatible.

---

### Task 1: Define deterministic place identity normalization and duplicate grouping

**Files:**
- Create: `features/act-migration/place-identity.ts`
- Modify: `features/act-migration/preview-service.ts` (staging/grouping boundary)
- Modify: `features/act-migration/migration-types.ts` (duplicate-group proposal fields)
- Test: `tests/unit/act-migration-place-identity.test.ts`
- Test: `tests/unit/act-migration-preview.test.ts`

**Interfaces:**
- Produces `normalizePlaceIdentity(input: { name: string; location: string | null }): { name: string; location: string }`.
- Produces `groupExactPlaceDuplicates(rows): Map<string, rows[]>`.
- Existing preview builders consume the group key to select a stable canonical proposal and attach source IDs.

- [ ] Write failing tests for case/whitespace/punctuation normalization, exact same-name-and-location grouping, and separation of different locations.
- [ ] Run `npx vitest run tests/unit/act-migration-place-identity.test.ts tests/unit/act-migration-preview.test.ts` and verify the new tests fail.
- [ ] Implement normalization with Unicode-safe trimming/case folding and harmless punctuation removal; preserve the original display values.
- [ ] Add grouping at the preview staging boundary, selecting the lexicographically stable source ID as canonical and emitting provenance for every grouped source row.
- [ ] Run the focused tests and then `npm run typecheck`.
- [ ] Commit as `feat: group exact duplicate Act places`.

### Task 2: Make merged relationships and provenance idempotent

**Files:**
- Modify: `features/act-migration/apply-manifest.ts`
- Modify: `features/act-migration/apply-service.ts`
- Modify: `features/act-migration/apply-repository.ts`
- Modify: `db/schema.ts` or the next migration only if a provenance/alias constraint is required
- Test: `tests/unit/act-migration-apply-manifest.test.ts`
- Test: `tests/integration/act-migration-entity-apply.test.ts`
- Test: `tests/integration/act-migration-relationship-apply.test.ts`

**Interfaces:**
- Apply manifest entries carry canonical target identity plus all source IDs in the duplicate group.
- Apply repository methods continue returning per-operation success/blocked/failed counts.

- [ ] Add tests proving duplicate source contacts create one active place-contact relationship and retain all source provenance.
- [ ] Add tests proving a second apply produces no duplicate entities or relationships.
- [ ] Update manifest reconciliation to reject ambiguous canonical links and keep unresolved groups pending.
- [ ] Update entity/relationship apply ordering so canonical places exist before contacts and relationships are written.
- [ ] Run the focused unit/integration suites against the disposable PostgreSQL database.
- [ ] Commit as `feat: apply deduplicated place relationships safely`.

### Task 3: Expose the complete reviewed-import apply workflow

**Files:**
- Modify: `app/(private)/settings/act-migration/page.tsx`
- Modify: `app/(private)/settings/act-migration/actions.ts`
- Modify: `components/act-migration/act-migration-review.tsx`
- Modify: `features/act-migration/act-env.ts` or the existing env module that parses `ACT_MIGRATION_APPLY_ENABLED`
- Test: `tests/unit/act-migration-review.test.tsx`
- Test: `tests/unit/act-migration-actions.test.ts`
- Test: `tests/unit/act-env.test.ts`

**Interfaces:**
- The page passes an explicit apply rollout state and reviewed-import summary to the client.
- The client renders `Apply approved changes` only when a finalized complete preview has approved work and the rollout is authorized.
- The server action validates the run ID, preview digest, approval decisions, and one confirmation token before starting the existing bounded apply queue.

- [ ] Add UI tests for visible apply readiness, one confirmation step, disabled/no-approved-work state, and unresolved items remaining queued.
- [ ] Add action tests for stale preview, unauthorized apply, malformed confirmation, and successful queue start.
- [ ] Implement the single confirmation UI with an explicit summary of approved places, contacts, relationships, and calling lists.
- [ ] Ensure apply results show succeeded, skipped, blocked, and failed counts with a retry path that cannot duplicate writes.
- [ ] Keep preview copy explicit that Act! is unchanged and add clear rollout messaging when apply is intentionally disabled.
- [ ] Run focused UI/action/env tests and `npm run typecheck`.
- [ ] Commit as `feat: expose reviewed migration apply workflow`.

### Task 4: Rename and stabilize Places/Contacts navigation

**Files:**
- Modify: `components/navigation/app-shell.tsx`
- Modify: `app/(private)/organizations/page.tsx`
- Modify: `components/organizations/organization-list.tsx`
- Modify: `app/(private)/organizations/[id]/page.tsx` and its detail component(s)
- Modify: `app/(private)/contacts/page.tsx`
- Test: `tests/unit/places-contacts-navigation.test.tsx`

**Interfaces:**
- Primary navigation label is `Places`; contact labels consistently say `Contacts`.
- Place detail links carry a `returnTo`/safe list context and default to `/organizations` (the Places list), never `/contacts`.

- [ ] Add tests that render navigation and place-detail back links with the expected labels and destination.
- [ ] Replace primary “Organizations”/“People” copy with “Places”/“Contacts” while preserving route URLs.
- [ ] Preserve search/page filters in place list context when opening and returning from a place.
- [ ] Run the focused UI tests and `npm run typecheck`.
- [ ] Commit as `fix: keep Places and Contacts navigation consistent`.

### Task 5: End-to-end migration verification and release gate

**Files:**
- Modify: `tests/integration/act-migration-release.test.ts` or the existing release harness
- Modify: `docs/superpowers/specs/2026-07-31-places-contacts-deduplication-design.md` only if verified behavior requires clarification

- [ ] Build a fixture with three exact duplicate place rows, shared and unique contacts, and one near-match.
- [ ] Run preview and assert one canonical place, deduplicated relationships, complete source provenance, and one queued near-match.
- [ ] Approve only the exact group and run apply; assert Command Center counts and no Act! writes.
- [ ] Repeat apply and assert counts remain unchanged.
- [ ] Run the full relevant test suite, typecheck, and diff checks.
- [ ] Record the rollout procedure: merge, deploy, enable the apply flag only when authorized, apply a small batch, verify, then continue.
- [ ] Commit as `test: verify places contacts migration gate`.
