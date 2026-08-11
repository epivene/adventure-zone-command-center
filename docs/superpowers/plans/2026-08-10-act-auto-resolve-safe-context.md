# Automatic Safe Context Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkboxes so each red/green/refactor cycle and verification command is explicit.

**Goal:** Automatically accept Act matches supported by durable context evidence, import every independently safe operation, and leave uncertain data preserved in the archive without requiring manual review or blocking the safe import.

**Architecture:** Keep the existing deterministic context-clue resolver and manifest builder as the source of match decisions. Add a small pure automatic-review policy that validates exact-match evidence and classifies outcomes as auto-resolved, safe-ready, archived-only, or failed. Project importability at the operation level so a safe link/create/fill operation is not held merely because another field on the same source record is unresolved. Expose durable counts through the run API, then make the review UI an automatic-review summary with optional diagnostics instead of a page-by-page approval queue.

**Tech Stack:** TypeScript, Node.js, Express, Drizzle ORM/PostgreSQL, React, Vitest, Testing Library, pnpm.

---

## Task 1: Define and test the automatic-review policy

**Files:**

- Create: `artifacts/api-server/src/features/act-replacement/automatic-review-policy.ts`
- Create: `artifacts/api-server/src/features/act-replacement/automatic-review-policy.test.ts`
- Reference: `artifacts/api-server/src/features/act-replacement/matching/context-clue-resolver.ts`
- Reference: `artifacts/api-server/src/features/act-replacement/manifest-builder.ts`

- [ ] **Step 1: Write failing policy tests**

Cover these cases with small `ManifestOutcome`/operation fixtures:

1. An exact match with one authoritative clue to the selected target is `auto_resolved`.
2. An exact match with two distinct clue families agreeing on the selected target is `auto_resolved`.
3. A single non-authoritative clue is not auto-resolved.
4. Two clues that point at different targets are not auto-resolved.
5. An ambiguous match is not auto-resolved.
6. Evidence for a different entity type than the selected link operation is not auto-resolved.
7. Repeated email/phone values from the same clue family count only once.
8. `safeByDefault: true` link/create/fill operations are automatically importable.
9. `overwrite_reviewed`, unsafe, blocked, leased, and unrelated operations are not automatically importable.
10. An unresolved outcome with no automatically importable operation is `archived_only`.
11. A failed outcome is `failed`, not archived-only.

Use a narrow public API:

```ts
export type AutomaticReviewDisposition =
  | "auto_resolved"
  | "safe_ready"
  | "archived_only"
  | "failed";

export function hasProvenContextMatch(
  input: {
    outcome: Pick<ManifestOutcome, "match">;
    selectedTargetTypes: ReadonlySet<string>;
  },
): boolean;

export function isAutomaticallyImportableOperation(
  operation: {
    action: string;
    safeByDefault: boolean;
    status: string;
  },
): boolean;

export function automaticReviewDisposition(input: {
  outcome: { state: string; match: unknown };
  operations: readonly {
    action: string;
    safeByDefault: boolean;
    status: string;
  }[];
}): AutomaticReviewDisposition;
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
pnpm --filter @workspace/api-server test -- automatic-review-policy.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure policy**

Implementation constraints:

- Read only the selected `match.localId`, `match.kind`, and bounded `match.evidence` array.
- Count unique `ContextClueFamily` values only when evidence target type/id agrees with the selected target.
- Obtain compatible selected target types from that source record's safe root `link_existing` operation; relationship/provenance target types cannot validate an identity match.
- Return proven when at least one valid clue is authoritative or at least two distinct valid families agree.
- Never treat model-generated prose or display labels as proof.
- Treat `safeByDefault` as necessary but not sufficient: explicitly reject `overwrite_reviewed` and non-pending/non-failed operations from a new import attempt.
- Preserve existing exact external-link behavior as `safe_ready`; `auto_resolved` is specifically the context-evidence count.

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```bash
pnpm --filter @workspace/api-server test -- automatic-review-policy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the policy**

```bash
git add artifacts/api-server/src/features/act-replacement/automatic-review-policy.ts artifacts/api-server/src/features/act-replacement/automatic-review-policy.test.ts
git commit -m "feat: define automatic Act review policy"
```

## Task 2: Project safe operations independently from archived-only issues

**Files:**

- Modify: `artifacts/api-server/src/features/act-replacement/production-review.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/production-review.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/import-types.ts`

- [ ] **Step 1: Add failing workflow projection tests**

Add regression tests proving:

1. A source outcome in `awaiting_review` with a pending, safe-by-default `link_existing` operation is included in `safeOperationCount`.
2. Its safe dependency closure is included only when every dependency is itself automatically importable.
3. An `overwrite_reviewed` operation remains excluded.
4. Ambiguous/unassigned/unsupported outcomes with no safe operations increment `archivedOnlyCount` and do not increment `reviewRequiredCount`.
5. A proven context match increments `autoResolvedCount` once per source record, even when it emits several operations.
6. An exact source with a safe link plus a conflicting non-empty field can still import the safe link while preserving the conflicting value in the archive.
7. `canApplySafe` is true when safe operations exist even if `archivedOnlyCount` is non-zero.
8. Failed outcomes remain visible as failures and do not get mislabeled as archived-only.

Extend projection fixtures so outcomes may include `match`:

```ts
outcomes: readonly {
  sourceRecordId: string;
  state: string;
  match?: unknown;
}[];
```

Extend `ImportWorkflow`:

```ts
autoResolvedCount: number;
archivedOnlyCount: number;
```

Keep `reviewRequiredCount` in the wire type for compatibility, but redefine it as records that truly block the requested safe import. Under this policy, ambiguous/unassigned/unsupported records are archived-only and therefore contribute zero. Do not use failed apply operations as review records; they remain represented by `failedOperationCount`.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run:

```bash
pnpm --filter @workspace/api-server test -- production-review.test.ts
```

Expected: FAIL on missing counts and the old `readySourceIds` gate.

- [ ] **Step 3: Update `projectImportWorkflow`**

Replace the source-state gate in `collectSafeClosure` with operation-level policy checks. Preserve cycle detection, dependency closure, digest checks, operation status checks, and terminal-operation handling.

Compute dispositions once per source:

```ts
type ProjectionOperation = ImportWorkflowProjectionInput["operations"][number];
const operationsBySourceId = new Map<string, ProjectionOperation[]>();
// populate once

const dispositions = input.outcomes.map((outcome) => ({
  sourceRecordId: outcome.sourceRecordId,
  disposition: automaticReviewDisposition({
    outcome,
    operations: operationsBySourceId.get(outcome.sourceRecordId) ?? [],
  }),
}));
```

Then derive:

```ts
const autoResolvedCount = dispositions.filter(
  ({ disposition }) => disposition === "auto_resolved",
).length;
const archivedOnlyCount = dispositions.filter(
  ({ disposition }) => disposition === "archived_only",
).length;
const reviewRequiredCount = 0;
```

`heldForReview` must mean “excluded from this automatic safe import,” not “the user must decide.” Rename the local set to `archivedOnlySourceIds`, leave the existing response property for compatibility, and set it from that set.

- [ ] **Step 4: Select match evidence in the durable workflow reader**

Add `match: actReplacementOutcomes.match` to the outcome select in `DrizzleWorkflowReader.summarize`. Pass it unchanged into the pure projection; do not load raw archived payloads.

This keeps the summary bounded and avoids repeating the out-of-memory pattern caused by materializing all source records.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @workspace/api-server test -- production-review.test.ts automatic-review-policy.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit workflow projection changes**

```bash
git add artifacts/api-server/src/features/act-replacement/production-review.ts artifacts/api-server/src/features/act-replacement/production-review.test.ts artifacts/api-server/src/features/act-replacement/import-types.ts
git commit -m "feat: import safe Act operations without manual review"
```

## Task 3: Preserve optional diagnostics without presenting a blocking queue

**Files:**

- Modify: `artifacts/api-server/src/features/act-replacement/review-reader.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-reader.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-sql-adapter.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-sql-adapter.test.ts`
- Modify: `artifacts/adventure-zone/src/features/act-replacement/act-replacement-client.ts`

- [ ] **Step 1: Add failing summary contract tests**

Change the review-page summary contract to distinguish optional archived records from blockers:

```ts
export type ReviewSummary = {
  decisionRequired: number;
  archivedOnly: number;
  issueCounts: Partial<Record<ReviewIssueCode, number>>;
  diagnosticCounts: Partial<Record<ReviewIssueCode, number>>;
};
```

Test that `awaiting_review`, `unassigned`, and `unsupported` outcomes contribute to `archivedOnly`, while `decisionRequired` is zero under automatic mode. Existing issue and diagnostic counts must remain unchanged.

- [ ] **Step 2: Run reader/adapter tests and confirm failure**

Run:

```bash
pnpm --filter @workspace/api-server test -- review-reader.test.ts review-sql-adapter.test.ts
```

Expected: FAIL because `archivedOnly` is absent and SQL still aliases these rows as `decisionRequired`.

- [ ] **Step 3: Update in-memory and SQL summaries**

- Keep the review rows queryable for diagnostics and later manual correction.
- Return `decisionRequired: 0`.
- Count the current decision-review states as `archivedOnly` in SQL and in `summarizeReviewOutcomes`.
- Do not fetch raw archive JSON to compute summary counts.
- Update all zero-summary literals and the frontend mirror type.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @workspace/api-server test -- review-reader.test.ts review-sql-adapter.test.ts
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the API summary contract**

```bash
git add artifacts/api-server/src/features/act-replacement/review-reader.ts artifacts/api-server/src/features/act-replacement/review-reader.test.ts artifacts/api-server/src/features/act-replacement/review-sql-adapter.ts artifacts/api-server/src/features/act-replacement/review-sql-adapter.test.ts artifacts/adventure-zone/src/features/act-replacement/act-replacement-client.ts
git commit -m "feat: report unresolved Act data as archived only"
```

## Task 4: Replace manual bulk review with automatic-review UX

**Files:**

- Modify: `artifacts/adventure-zone/src/components/act-replacement/import-review.tsx`
- Modify: `artifacts/adventure-zone/src/components/act-replacement/import-review.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/act-replacement/import-summary.tsx`
- Modify: `artifacts/adventure-zone/src/components/act-replacement/import-summary.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ActMigrationPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ActMigrationPage.test.tsx`

- [ ] **Step 1: Write failing component/page tests for the new flow**

Test the user-visible contract:

1. The page introduces the process as automatic review followed by a separate safe import.
2. The organizer action reads `Auto-review saved archive` when rebuilding.
3. The summary displays `autoResolvedCount`, `safeOperationCount`, and `archivedOnlyCount`.
4. Archived-only copy explicitly says no manual review is required and the source data remains preserved.
5. `Select all safe matches on this page` and `Accept selected safe matches` are absent.
6. Strong context evidence can still be displayed as explanatory text, but not as a required checkbox.
7. Optional archived-record diagnostics are collapsed in a `<details>` section by default.
8. The separate `Import safe records` action remains enabled when safe operations exist and archived-only records remain.
9. The final summary says records were “kept safely in the archive,” not that they “still need review.”

- [ ] **Step 2: Run the focused frontend tests and confirm they fail**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/act-replacement/import-review.test.tsx src/components/act-replacement/import-summary.test.tsx src/pages/ActMigrationPage.test.tsx
```

Expected: FAIL on old labels, missing count props, and visible bulk context-match controls.

- [ ] **Step 3: Update props and summary cards**

Change `ImportReview` props to accept:

```ts
autoResolvedCount: number;
safeOperationCount: number;
archivedOnlyCount: number;
```

Use copy equivalent to:

- “X records auto-resolved from strong context clues.”
- “Y safe operations ready. Only additions and empty-field updates are included.”
- “Z uncertain records kept in the archive. You do not need to review these before importing the safe data.”

Do not claim every auto-resolved record creates one operation; keep record and operation counts separate.

- [ ] **Step 4: Remove context-match selection mechanics**

Remove only the `duplicate_identity` bulk-selection path:

- Remove `recommendedRows`.
- Remove the page-select safe-match button.
- Remove the duplicate-identity checkbox and bulk action block.
- Remove `duplicate_identity` from `SelectionKind` and related signatures.

Retain manual field-conflict and relationship controls inside optional diagnostics so advanced recovery remains possible. Do not call the bulk decisions endpoint during the normal automatic flow.

- [ ] **Step 5: Collapse optional diagnostics and update page copy**

Wrap search, issue filters, and archived rows in:

```tsx
<details className="rounded-lg border border-slate-200 p-4">
  <summary className="cursor-pointer font-semibold text-slate-800">
    Optional archived-record diagnostics
  </summary>
  {/* existing search, filters, and rows */}
</details>
```

Pass run counts from `ActMigrationPage`, relabel the organize card/action, and pass `archivedOnlyCount` to `ImportSummary` instead of `remainingReview`.

- [ ] **Step 6: Run focused frontend tests and typecheck**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/act-replacement/import-review.test.tsx src/components/act-replacement/import-summary.test.tsx src/pages/ActMigrationPage.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the automatic-review UX**

```bash
git add artifacts/adventure-zone/src/components/act-replacement/import-review.tsx artifacts/adventure-zone/src/components/act-replacement/import-review.test.tsx artifacts/adventure-zone/src/components/act-replacement/import-summary.tsx artifacts/adventure-zone/src/components/act-replacement/import-summary.test.tsx artifacts/adventure-zone/src/pages/ActMigrationPage.tsx artifacts/adventure-zone/src/pages/ActMigrationPage.test.tsx
git commit -m "feat: make Act archive review automatic"
```

## Task 5: Add an end-to-end regression for the one-click automatic flow

**Files:**

- Modify: `artifacts/api-server/src/features/act-replacement/production-review.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/manifest-builder.test.ts`
- Modify: `artifacts/adventure-zone/src/pages/ActMigrationPage.test.tsx`
- Reference: `artifacts/api-server/src/features/act-replacement/matching/context-clue-resolver.test.ts`
- Reference: `artifacts/api-server/src/features/act-replacement/review-sql-adapter.test.ts`

- [ ] **Step 1: Add a backend scenario test**

Build a projection fixture containing:

- one authoritative context link;
- one two-clue context link;
- one exact match with a safe empty-field fill plus a conflicting non-empty field;
- one ambiguous record;
- one unsupported record;
- one relationship operation whose dependency is unsafe.

Assert that only dependency-closed, safe-by-default operations are counted; proven records are counted once; ambiguous/unsupported/unsafe-dependency records are archived-only; and the run can apply safe operations.

- [ ] **Step 2: Add a page flow test**

Mock this sequence:

1. `organizeRun` returns accepted/202 behavior.
2. Polling returns `ready_to_apply` with non-zero `autoResolvedCount`, `safeOperationCount`, and `archivedOnlyCount`.
3. No review-decision or bulk-decision request is made.
4. The safe import confirmation uses the safe operation count only.

- [ ] **Step 3: Add organizer/manifest determinism regressions**

In `manifest-builder.test.ts`, build the same source set in two different input orders and assert identical operations, outcomes, and digest. Rebuild the same input twice and assert the same result. Include a qualifying inferred exact match with sanitized evidence and assert it emits a safe `link_existing` operation without a review decision. Retain or add assertions that existing valid manual decisions override inference and populated local values produce conflicts rather than automatic overwrites.

Run the existing context resolver suite alongside this regression; its shared-email/phone and incompatible-target cases remain part of the release gate.

- [ ] **Step 4: Run all regression tests**

Run:

```bash
pnpm --filter @workspace/api-server test -- production-review.test.ts manifest-builder.test.ts matching/context-clue-resolver.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActMigrationPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the integration regression**

```bash
git add artifacts/api-server/src/features/act-replacement/production-review.test.ts artifacts/api-server/src/features/act-replacement/manifest-builder.test.ts artifacts/adventure-zone/src/pages/ActMigrationPage.test.tsx
git commit -m "test: cover automatic Act archive review flow"
```

## Task 6: Full verification, review, and draft PR

**Files:**

- Verify all modified files above.
- Update the design document only if implementation revealed a necessary contract correction: `docs/superpowers/specs/2026-08-10-act-auto-resolve-safe-context-design.md`

- [ ] **Step 1: Run the complete API suite**

```bash
pnpm --filter @workspace/api-server test
```

Expected: all tests PASS without heap exhaustion.

- [ ] **Step 2: Run workspace typechecks and builds**

```bash
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: all commands exit 0.

- [ ] **Step 3: Inspect the diff for safety invariants**

```bash
git diff --check
git status --short
git diff main...HEAD --stat
git log --oneline main..HEAD
```

Confirm:

- no non-empty overwrite became automatic;
- no ambiguous record gained an operation;
- no archive payload is loaded merely to compute counts;
- safe import remains a distinct user action;
- uncertain data remains queryable in the archive;
- normal automatic flow makes no decision/bulk-decision requests.

- [ ] **Step 4: Request code review and address only verified findings**

Use `superpowers:requesting-code-review`. If feedback is received, use `superpowers:receiving-code-review` before changing code, then repeat the affected focused and full verification commands.

- [ ] **Step 5: Commit any final verified corrections**

```bash
git add -u
git commit -m "fix: address automatic Act review findings"
```

Skip this commit if no corrections are needed.

- [ ] **Step 6: Publish a draft PR**

Use `superpowers:verification-before-completion`, then `github:yeet` to push `agent/auto-resolve-safe-context` and create a draft pull request into `main` in `epivene/adventure-zone-command-center`.

The PR body must summarize:

- deterministic authoritative/two-clue auto-resolution;
- operation-level fail-closed safe import;
- archived-only treatment for uncertainty;
- removal of page-by-page safe-match approval;
- memory-bounded summary projection;
- exact test/typecheck/build evidence.
