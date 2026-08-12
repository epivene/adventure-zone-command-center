# Bulk Duplicate Profile Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a confirmed, resumable one-click action that sequentially merges every duplicate profile group into the profile already marked Primary.

**Architecture:** Keep primary selection and progress in `DuplicatesView`, while a small pure queue runner builds and submits one existing `/organizations/merge` request at a time. The existing transactional API remains unchanged. The page keeps the current duplicate view mounted during refreshes so a failed run can refresh server truth without losing its progress/error UI.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Vite, existing authenticated `apiPost` client.

## Global Constraints

- Reuse `POST /organizations/merge`; do not add a database migration or background-job subsystem.
- Use the profile already marked **Primary** in each group.
- Process groups sequentially and stop on the first failure.
- Preserve completed merges and allow the remaining groups to be resumed.
- Require explicit confirmation before bulk deletion begins.

---

### Task 1: Sequential bulk-merge runner

**Files:**
- Create: `artifacts/adventure-zone/src/features/organizations/bulk-duplicate-merge.ts`
- Create: `artifacts/adventure-zone/src/features/organizations/bulk-duplicate-merge.test.ts`

**Interfaces:**
- Consumes: `DuplicateGroup`-shaped objects containing `normalizedName` and `organizations[].id`.
- Produces: `mergeDuplicateGroups(groups, primaryIds, merge, onProgress): Promise<void>` and `BulkDuplicateMergeError` with `groupName`, `completed`, `total`, and `cause`.

- [ ] **Step 1: Write the failing sequential-success test**

Create fixtures for two literal groups and deferred merge promises. Assert that only the first request starts, its payload is `{ primaryId: "primary-a", duplicateIds: ["duplicate-a"] }`, and the second request does not start until the first resolves. Then assert literal progress events `[{ completed: 1, total: 2 }, { completed: 2, total: 2 }]`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/features/organizations/bulk-duplicate-merge.test.ts`

Expected: FAIL because `bulk-duplicate-merge.ts` does not exist.

- [ ] **Step 3: Implement the minimal queue**

Implement the following public contract:

```ts
export type BulkMergeGroup = {
  normalizedName: string;
  organizations: Array<{ id: string }>;
};

export type MergeRequest = {
  primaryId: string;
  duplicateIds: string[];
};

export async function mergeDuplicateGroups(
  groups: BulkMergeGroup[],
  primaryIds: Readonly<Record<string, string>>,
  merge: (request: MergeRequest) => Promise<void>,
  onProgress: (progress: { completed: number; total: number; groupName: string }) => void,
): Promise<void>;
```

For each group, read `primaryIds[group.normalizedName]`, reject a missing/nonmember primary, derive every other ID as `duplicateIds`, await `merge`, then report progress.

- [ ] **Step 4: Verify GREEN**

Run the focused Vitest command from Step 2. Expected: PASS.

- [ ] **Step 5: Add the failing stop-on-error test**

Have the second merge reject with `new Error("offline")`. Assert the third request never starts and the thrown `BulkDuplicateMergeError` contains the literal second group name, `completed: 1`, and `total: 3`.

- [ ] **Step 6: Verify RED, implement the typed error, and verify GREEN**

Run the focused test before and after implementation. Expected before: the raw error lacks progress fields. Expected after: all runner tests pass.

- [ ] **Step 7: Commit the runner and tests**

Commit message: `feat: add sequential duplicate merge runner`

---

### Task 2: Bulk action, confirmation, progress, and resume UI

**Files:**
- Modify: `artifacts/adventure-zone/src/components/organizations/duplicates-view.tsx`
- Create: `artifacts/adventure-zone/src/components/organizations/duplicates-view.test.tsx`

**Interfaces:**
- Consumes: `mergeDuplicateGroups` and `BulkDuplicateMergeError` from Task 1; existing `apiPost("/organizations/merge", request)`.
- Produces: controlled per-group primary selection plus **Merge all N groups**, confirmation, `Merging X of N`, failure details, and **Resume remaining merges** behavior.

- [ ] **Step 1: Write the failing confirmation-cancel test**

Render two duplicate groups with a hoisted `apiPost` mock. Click **Merge all 2 groups**, assert a dialog explains that linked records move before redundant profiles are removed, click **Cancel**, and assert no POST occurs.

- [ ] **Step 2: Run the component test and verify RED**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/components/organizations/duplicates-view.test.tsx`

Expected: FAIL because the bulk action is absent.

- [ ] **Step 3: Lift primary state and add the bulk confirmation**

In `DuplicatesView`, initialize a `Record<normalizedName, primaryId>` from each group's first organization. Make `DuplicateGroupCard` receive controlled `primaryId`, `onPrimaryChange`, and `disabled` props. Add a bulk confirmation dialog and disable radio buttons plus individual merge buttons while bulk processing is active.

- [ ] **Step 4: Verify the cancellation test passes**

Run the component test. Expected: PASS with zero POST calls after cancel.

- [ ] **Step 5: Write the failing completion/progress test**

Select the second profile as Primary in the first group, start and confirm bulk merge, and use deferred POST promises to assert:

```ts
expect(apiPost).toHaveBeenNthCalledWith(1, "/organizations/merge", {
  primaryId: "duplicate-a",
  duplicateIds: ["primary-a"],
});
expect(screen.getByText("Merging 0 of 2")).toBeInTheDocument();
```

Resolve each request in turn, assert `Merging 1 of 2`, then the success state with no duplicate cards remaining.

- [ ] **Step 6: Verify RED, implement queue integration, and verify GREEN**

Call `mergeDuplicateGroups` with a merge callback that delegates to `apiPost`. After each progress event, remove the completed group by `normalizedName`, update counters, and keep all editing controls disabled. On success, show a completion toast and call `onRefresh`.

- [ ] **Step 7: Write the failing failure-and-resume test**

Make group one succeed and group two fail. Assert group three was not posted, the UI reports the failed group and **1 of 3 completed**, and **Resume remaining merges** is shown. Click Resume, confirm only groups two and three are submitted, and assert the run reaches completion.

- [ ] **Step 8: Verify RED, implement failure/resume state, and verify GREEN**

Catch `BulkDuplicateMergeError`, preserve the remaining local groups, expose the failed group/error text, call `onRefresh`, and have Resume take a fresh snapshot of the remaining groups. Re-run the focused component test until all cases pass.

- [ ] **Step 9: Commit the UI and tests**

Commit message: `feat: merge all duplicate profiles into primaries`

---

### Task 3: Keep duplicate cleanup visible during refresh

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/OrganizationsPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/OrganizationsPage.test.tsx`

**Interfaces:**
- Consumes: existing `loadDuplicates` and `DuplicatesView` props.
- Produces: background duplicate refreshes that do not replace an already-loaded cleanup view with the scanning placeholder.

- [ ] **Step 1: Write the failing background-refresh test**

Mock `/organizations/duplicates` with an initial resolved group list and a deferred second response. Open **Find Duplicates**, wait for **Merge all 1 group**, trigger `onRefresh` through the rendered view, and assert the duplicate controls remain visible while the second GET is pending.

- [ ] **Step 2: Run the focused page test and verify RED**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/pages/OrganizationsPage.test.tsx`

Expected: FAIL because `dupLoading` currently replaces the loaded duplicate view with **Scanning for duplicates…**.

- [ ] **Step 3: Keep loaded groups mounted during background refresh**

Render the scanning placeholder only when `dupLoading && dupGroups === null`. When groups already exist, continue rendering `DuplicatesView` while `loadDuplicates` updates them in the background. Pass an async-compatible `onRefresh` without changing the API endpoint.

- [ ] **Step 4: Verify GREEN**

Run the focused page test. Expected: PASS.

- [ ] **Step 5: Commit the page refresh behavior**

Commit message: `fix: preserve duplicate merge progress during refresh`

---

### Task 4: Full verification and publication

**Files:**
- Verify all files changed in Tasks 1-3.
- Update the branch plan checkboxes as completed.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/features/organizations/bulk-duplicate-merge.test.ts \
  src/components/organizations/duplicates-view.test.tsx \
  src/pages/OrganizationsPage.test.tsx
```

Expected: all focused tests pass without unhandled rejections.

- [ ] **Step 2: Run the full frontend test suite**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run`

Expected: all frontend tests pass.

- [ ] **Step 3: Run typecheck and production builds**

Run:

```bash
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
pnpm --filter @workspace/api-server build
```

Expected: all commands exit 0. If the known unrelated API test-fixture type error remains, report it explicitly rather than attributing it to this change.

- [ ] **Step 4: Review the exact diff**

Confirm there are no API route/schema changes, no database migration, no parallel merge calls, and no unrelated formatting changes.

- [ ] **Step 5: Request code review and address Important findings**

Review the branch against the approved design, with special attention to stale group indices, lost-response retries, controlled primary selection, and mobile disconnect behavior.

- [ ] **Step 6: Publish and merge**

Push `agent/bulk-duplicate-profile-merge`, open a PR to `main`, include test/build evidence, and merge after review passes.
