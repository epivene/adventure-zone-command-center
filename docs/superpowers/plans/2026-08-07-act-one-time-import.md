# One-Time Act! Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the durable Act! archive into reviewed local records through a safe, resumable, one-time import flow.

**Architecture:** A production organizer deterministically converts archived source versions into durable outcomes and apply operations. The existing approval/apply services are extended with an owner-facing bounded coordinator that applies dependency-closed safe operations in batches of 25. The React page becomes a stage-driven workflow over the existing owner-only API.

**Tech Stack:** TypeScript 5.9, Express 5, React 19, Drizzle ORM, PostgreSQL, Vitest, Testing Library, pnpm.

## Global Constraints

- Automatically import only operations whose outcome is safe and whose operation is `safeByDefault`.
- Duplicates, conflicts, unsupported records, ambiguous matches, and unresolved relationships wait for review.
- Never automatically overwrite a non-empty local value.
- Never delete local records.
- Default extraction page size is 100.
- Default live apply batch size is 25 operations and the API rejects values above 25.
- Every organize, approval, and apply request is idempotent and resumable after restart.
- A stale manifest digest or source version fails closed.
- `ACT_MIGRATION_APPLY_ENABLED` remains `false` until all verification gates pass.

---

### Task 1: Durable archive-to-manifest organizer

**Files:**
- Create: `artifacts/api-server/src/features/act-replacement/production-organizer.ts`
- Create: `artifacts/api-server/src/features/act-replacement/production-organizer.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-sql-adapter.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-sql-adapter.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-command-service.ts`

**Interfaces:**
- Consumes: `buildActOrganizeManifest({ runId, sources })`, archived latest source versions, active assignments and decisions.
- Produces: `ProductionActOrganizer.organize(runId: string): Promise<{ status: "ready_to_apply" | "complete_with_issues"; manifest: ActOrganizeManifest }>`.

- [ ] **Step 1: Write a failing organizer behavior test**

```ts
it("builds one deterministic manifest from complete archived sources", async () => {
  const store = new InMemoryProductionOrganizerStore({
    runId: "run-1",
    phase: "extract_complete",
    sources: [companySource, contactSource, noteSource],
  });
  const organizer = new ProductionActOrganizer(store);

  const first = await organizer.organize("run-1");
  const second = await organizer.organize("run-1");

  expect(first.status).toBe("ready_to_apply");
  expect(second.manifest.digest).toBe(first.manifest.digest);
  expect(store.persistedOperationKeys).toEqual([
    "organization:company-1",
    "contact:contact-1",
    "activity:note-1",
    "organization_contact:contact-1:company-1",
    "activity_association:note-1:contact-1",
  ]);
  expect(new Set(store.persistedOperationKeys).size).toBe(store.persistedOperationKeys.length);
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run: `pnpm --filter @workspace/api-server test -- production-organizer.test.ts`  
Expected: FAIL because `ProductionActOrganizer` does not exist.

- [ ] **Step 3: Implement the organizer boundary**

```ts
export interface ProductionOrganizerStore {
  claim(runId: string): Promise<OrganizerRun | null>;
  loadSources(runId: string): Promise<readonly ManifestSourceInput[]>;
  persistManifest(runId: string, manifest: ActOrganizeManifest): Promise<void>;
  complete(runId: string, phase: "ready_to_apply" | "complete_with_issues", digest: string): Promise<void>;
  release(runId: string, code: string): Promise<void>;
}

export class ProductionActOrganizer {
  constructor(private readonly store: ProductionOrganizerStore) {}

  async organize(runId: string) {
    const run = await this.store.claim(runId);
    if (!run) throw codedError("organize_unavailable", 409);
    try {
      const sources = await this.store.loadSources(runId);
      const manifest = buildActOrganizeManifest({ runId, sources });
      await this.store.persistManifest(runId, manifest);
      const status = manifest.outcomes.some((outcome) =>
        ["awaiting_review", "unassigned", "unsupported"].includes(outcome.state),
      ) ? "complete_with_issues" as const : "ready_to_apply" as const;
      await this.store.complete(runId, status, manifest.digest);
      return { status, manifest };
    } catch (error) {
      await this.store.release(runId, safeOrganizerError(error));
      throw error;
    }
  }
}
```

The Drizzle store must claim only an owner-scoped `extract_complete` or retryable `organizing` run, load only its latest archived versions, normalize using the existing normalizers, resolve source relationships, include active manual assignments/decisions, and persist outcomes/operations with `ON CONFLICT (run_id, operation_key) DO UPDATE`.

- [ ] **Step 4: Run organizer and review adapter tests**

Run: `pnpm --filter @workspace/api-server test -- production-organizer.test.ts review-sql-adapter.test.ts`  
Expected: PASS with deterministic digest and no duplicate operation keys.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/act-replacement/production-organizer.ts artifacts/api-server/src/features/act-replacement/production-organizer.test.ts artifacts/api-server/src/features/act-replacement/review-sql-adapter.ts artifacts/api-server/src/features/act-replacement/review-sql-adapter.test.ts artifacts/api-server/src/features/act-replacement/review-command-service.ts
git commit -m "feat: organize archived Act records durably"
```

### Task 2: Safe-default approval and bounded apply coordinator

**Files:**
- Create: `artifacts/api-server/src/features/act-replacement/apply-coordinator.ts`
- Create: `artifacts/api-server/src/features/act-replacement/apply-coordinator.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/approval-service.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/approval-service.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/apply-service.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/apply-service.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/drizzle-apply-repository.ts`

**Interfaces:**
- Consumes: approved dependency-closed operation keys and `ActApplyService.apply`.
- Produces: `ActApplyCoordinator.applyNext(input): Promise<ApplyCoordinatorStatus>` with at most 25 operations per batch.

- [ ] **Step 1: Write failing safety and batch-boundary tests**

```ts
it("excludes every operation belonging to a review-required outcome", async () => {
  const approval = new ActApprovalService(repositoryWithManifest({
    outcomes: [
      { sourceRecordId: "safe", state: "ready" },
      { sourceRecordId: "conflict", state: "awaiting_review" },
    ],
    operations: [
      safeOperation("safe:create", "safe"),
      safeOperation("conflict:create", "conflict"),
    ],
  }));

  const result = await approval.approveSafeDefaults(request);

  expect(result.approvedOperationIds).toEqual(["safe:create"]);
  expect(result.rejectedOperationIds).toContain("conflict:create");
});

it("applies no more than 25 operations in one coordinator call", async () => {
  const service = recordingApplyService();
  const coordinator = new ActApplyCoordinator(service);

  const result = await coordinator.applyNext({
    ...applyRequest,
    approvedOperationIds: operationIds(61),
    cursor: 0,
    batchSize: 25,
  });

  expect(service.lastOperationIds).toHaveLength(25);
  expect(result.nextCursor).toBe(25);
  expect(result.hasMore).toBe(true);
});
```

- [ ] **Step 2: Verify both tests fail for the missing behavior**

Run: `pnpm --filter @workspace/api-server test -- approval-service.test.ts apply-coordinator.test.ts`  
Expected: FAIL because review-required outcomes are not available to safe-default filtering and the coordinator does not exist.

- [ ] **Step 3: Extend approval input and implement the coordinator**

```ts
export const MAX_ACT_APPLY_BATCH_SIZE = 25;

export class ActApplyCoordinator {
  constructor(private readonly service: Pick<ActApplyService, "apply">) {}

  async applyNext(input: ApplyCoordinatorInput): Promise<ApplyCoordinatorStatus> {
    if (!Number.isInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > MAX_ACT_APPLY_BATCH_SIZE) {
      throw codedError("invalid_apply_batch_size", 400);
    }
    const ids = input.approvedOperationIds.slice(input.cursor, input.cursor + input.batchSize);
    const batch = await this.service.apply({
      runId: input.runId,
      approvedOperationIds: ids,
      expectedManifestDigest: input.expectedManifestDigest,
      requestKey: `${input.requestKey}:${input.cursor}`,
      requestedBy: input.requestedBy,
    });
    const nextCursor = input.cursor + ids.length;
    return {
      batch,
      nextCursor,
      hasMore: nextCursor < input.approvedOperationIds.length && batch.failedCount === 0 && batch.blockedCount === 0,
    };
  }
}
```

Safe-default approval must first filter outcomes to `ready`, then select `safeByDefault` operations for those sources, and finally close dependencies only when every dependency also belongs to an eligible source.

- [ ] **Step 4: Fix durable batch replay semantics**

Update `DrizzleApplyRepository.createBatch` so a queued approval row is atomically claimed as the corresponding applying batch instead of attempting to insert a second row with the same request key. Preserve the approval closure, replay fingerprint, lease owner, lease expiry, and current counts. Add a test proving a replay returns the existing terminal batch and never executes an operation twice.

- [ ] **Step 5: Run focused apply tests**

Run: `pnpm --filter @workspace/api-server test -- approval-service.test.ts apply-service.test.ts apply-coordinator.test.ts drizzle-apply-repository.test.ts`  
Expected: PASS with a maximum observed batch size of 25 and zero duplicate writes.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/act-replacement/approval-service.ts artifacts/api-server/src/features/act-replacement/approval-service.test.ts artifacts/api-server/src/features/act-replacement/apply-service.ts artifacts/api-server/src/features/act-replacement/apply-service.test.ts artifacts/api-server/src/features/act-replacement/apply-coordinator.ts artifacts/api-server/src/features/act-replacement/apply-coordinator.test.ts artifacts/api-server/src/features/act-replacement/drizzle-apply-repository.ts artifacts/api-server/src/features/act-replacement/drizzle-apply-repository.test.ts
git commit -m "feat: apply safe Act records in bounded batches"
```

### Task 3: Owner API for organize, review, and resumable batch application

**Files:**
- Modify: `artifacts/api-server/src/routes/act-replacement.ts`
- Modify: `artifacts/api-server/src/routes/act-replacement.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/production-review.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/import-types.ts`

**Interfaces:**
- Consumes: `ProductionActOrganizer`, `ActApprovalService`, and `ActApplyCoordinator`.
- Produces: owner-only organize, summary, safe-approval, and next-batch endpoints.

- [ ] **Step 1: Write failing route tests**

```ts
it("organizes only an owned extract-complete run", async () => {
  const response = await owner(agent)
    .post(`/api/migration/act-replacement/runs/${runId}/organize`)
    .send({});
  expect(response.status).toBe(202);
  expect(response.body.status).toBe("ready_to_apply");
});

it("rejects apply batches larger than 25 before any write", async () => {
  const response = await owner(agent)
    .post(`/api/migration/act-replacement/runs/${runId}/apply-next`)
    .send({ ...applyBody, batchSize: 26 });
  expect(response.status).toBe(400);
  expect(response.body.code).toBe("invalid_apply_batch_size");
  expect(applySpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run route tests and observe the missing coordinator endpoint failure**

Run: `pnpm --filter @workspace/api-server test -- act-replacement.test.ts`  
Expected: FAIL with 404 for `apply-next` and incorrect organize behavior.

- [ ] **Step 3: Wire production dependencies and strict schemas**

Add strict Zod schemas:

```ts
const organizeSchema = z.object({}).strict();
const applyNextSchema = z.object({
  approvedOperationIds: z.array(z.string().trim().min(1)).max(100000),
  expectedManifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  requestKey: z.string().trim().min(1),
  cursor: z.number().int().min(0),
  batchSize: z.number().int().min(1).max(25),
}).strict();
```

Keep the existing owned-run lookup before reading a manifest or invoking a command. Return only sanitized counts, issue codes, safe display values, operation keys, target/action metadata, digest, cursor, and batch status.

- [ ] **Step 4: Add restart/resume status fields**

Extend the run projection with:

```ts
type ImportWorkflow = {
  safeOperationCount: number;
  reviewRequiredCount: number;
  appliedOperationCount: number;
  blockedOperationCount: number;
  failedOperationCount: number;
  manifestDigest: string | null;
  nextApplyCursor: number;
  canOrganize: boolean;
  canApplySafe: boolean;
};
```

Compute the projection from durable outcomes, operations, and apply batches; do not infer it from process memory.

- [ ] **Step 5: Run route, typecheck, and build gates**

Run: `pnpm --filter @workspace/api-server test -- act-replacement.test.ts`  
Run: `pnpm --filter @workspace/api-server run typecheck`  
Run: `pnpm --filter @workspace/api-server run build`  
Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/act-replacement.ts artifacts/api-server/src/routes/act-replacement.test.ts artifacts/api-server/src/features/act-replacement/production-review.ts artifacts/api-server/src/features/act-replacement/import-types.ts
git commit -m "feat: expose resumable Act import workflow"
```

### Task 4: Guided React review and import workflow

**Files:**
- Create: `artifacts/adventure-zone/src/components/act-replacement/import-review.tsx`
- Create: `artifacts/adventure-zone/src/components/act-replacement/import-review.test.tsx`
- Create: `artifacts/adventure-zone/src/components/act-replacement/import-summary.tsx`
- Create: `artifacts/adventure-zone/src/components/act-replacement/import-summary.test.tsx`
- Modify: `artifacts/adventure-zone/src/features/act-replacement/act-replacement-client.ts`
- Modify: `artifacts/adventure-zone/src/pages/ActMigrationPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ActMigrationPage.test.tsx`

**Interfaces:**
- Consumes: typed owner workflow endpoints.
- Produces: a single Fetch → Organize → Review → Import → Finish screen.

- [ ] **Step 1: Write failing page workflow tests**

```tsx
it("offers automatic import only for safe records", async () => {
  client.getLatestRun.mockResolvedValue({ run: readyRun({
    safeOperationCount: 42,
    reviewRequiredCount: 3,
  }) });

  render(<ActMigrationPage />);

  expect(await screen.findByText("42 safe operations ready")).toBeInTheDocument();
  expect(screen.getByText("3 records need your review")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Import safe records" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: /overwrite/i })).not.toBeInTheDocument();
});

it("continues 25-operation batches until complete", async () => {
  client.approveSafeDefaults.mockResolvedValue(approvalWithOperationIds(52));
  client.applyNext
    .mockResolvedValueOnce(batchResult(25, true))
    .mockResolvedValueOnce(batchResult(50, true))
    .mockResolvedValueOnce(batchResult(52, false));

  render(<ActMigrationPage />);
  await user.click(await screen.findByRole("button", { name: "Import safe records" }));
  await user.click(screen.getByRole("button", { name: "Yes, import safe records" }));

  await waitFor(() => expect(client.applyNext).toHaveBeenCalledTimes(3));
  expect(client.applyNext.mock.calls.every(([, body]) => body.batchSize === 25)).toBe(true);
});
```

- [ ] **Step 2: Run page tests and verify missing UI/client methods**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActMigrationPage.test.tsx`  
Expected: FAIL because organize/review/approve/apply client methods and controls do not exist.

- [ ] **Step 3: Add typed client calls**

```ts
export const organizeRun = (runId: string) =>
  request<OrganizeResponse>(`/migration/act-replacement/runs/${encodeURIComponent(runId)}/organize`, {
    method: "POST",
    body: "{}",
  });

export const approveSafeDefaults = (runId: string, expectedManifestDigest: string, requestKey = crypto.randomUUID()) =>
  request<ApprovalClosure>(`/migration/act-replacement/runs/${encodeURIComponent(runId)}/approvals/safe-defaults`, {
    method: "POST",
    body: JSON.stringify({ expectedManifestDigest, requestKey }),
  });

export const applyNext = (runId: string, body: ApplyNextRequest) =>
  request<ApplyNextResponse>(`/migration/act-replacement/runs/${encodeURIComponent(runId)}/apply-next`, {
    method: "POST",
    body: JSON.stringify(body),
  });
```

- [ ] **Step 4: Implement stage components**

`ImportReview` shows safe and review-required counts, issue groups, search, pagination, and sanitized record summaries. `ImportSummary` shows applied, already-present, blocked, failed, and remaining-review totals. The confirmation dialog says that existing non-empty fields will not be replaced and that imported records are not automatically removed.

If a batch reports blocked or failed operations, stop automatic continuation, refresh durable status, and show a review/retry action. If the server returns `act_apply_disabled`, show “Live import is still safely locked on the server” and do not retry.

- [ ] **Step 5: Run frontend tests, typecheck, and build**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run`  
Run: `pnpm --filter @workspace/adventure-zone run typecheck`  
Run: `pnpm --filter @workspace/adventure-zone run build`  
Expected: all commands exit 0 with no React act warnings.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/components/act-replacement/import-review.tsx artifacts/adventure-zone/src/components/act-replacement/import-review.test.tsx artifacts/adventure-zone/src/components/act-replacement/import-summary.tsx artifacts/adventure-zone/src/components/act-replacement/import-summary.test.tsx artifacts/adventure-zone/src/features/act-replacement/act-replacement-client.ts artifacts/adventure-zone/src/pages/ActMigrationPage.tsx artifacts/adventure-zone/src/pages/ActMigrationPage.test.tsx
git commit -m "feat: guide owner through safe Act import"
```

### Task 5: PostgreSQL restart/replay gate and deployment runbook

**Files:**
- Create: `artifacts/api-server/src/features/act-replacement/one-time-import.integration.test.ts`
- Modify: `scripts/verify-act-replacement-preview.ts`
- Modify: `scripts/verify-act-replacement-preview.test.ts`
- Modify: `scripts/report-act-replacement-import.ts`
- Modify: `scripts/report-act-replacement-import.test.ts`
- Modify: `DEPLOY.md`
- Modify: `render.yaml`

**Interfaces:**
- Consumes: the complete workflow and `TEST_DATABASE_URL`.
- Produces: executable pre-production evidence and an exact one-time rollout/lockdown procedure.

- [ ] **Step 1: Write the failing disposable-database integration test**

```ts
it.runIf(Boolean(process.env.TEST_DATABASE_URL))(
  "organizes, applies, restarts, and replays without duplicates",
  async () => {
    const firstProcess = await startTestRuntime();
    const run = await seedArchivedActRun(firstProcess.db, completeFixture);
    const organized = await firstProcess.organizer.organize(run.id);
    const approved = await firstProcess.approval.approveSafeDefaults(approvalRequest(organized.manifest.digest));
    await applyAllInBatches(firstProcess.coordinator, approved.approvedOperationIds, 25);
    await firstProcess.close();

    const secondProcess = await startTestRuntime();
    await applyAllInBatches(secondProcess.coordinator, approved.approvedOperationIds, 25);

    expect(await localEntityCounts(secondProcess.db)).toEqual(expectedEntityCounts);
    expect(await duplicateSourceLinkCount(secondProcess.db)).toBe(0);
    expect(await unresolvedRequiredOperationCount(secondProcess.db)).toBe(0);
  },
);
```

- [ ] **Step 2: Run the integration test before completing restart wiring**

Run: `TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @workspace/api-server test -- one-time-import.integration.test.ts`  
Expected: FAIL until all durable coordinator/replay paths are wired.

- [ ] **Step 3: Extend verification and metadata-only reporting**

The verifier must fail unless all required streams reconcile, organization is terminal, no active or expired lease remains, every applied operation has a source version, and every required relationship operation is applied/already-present or explicitly held for review.

The report adds only these safe columns:

```text
run_id,phase,manifest_digest,safe_operations,review_required,applied,already_present,blocked,failed,remaining,apply_batch_count,last_batch_state
```

It must not print raw snapshots, request bodies, display fields, credentials, cookies, or authorization values.

- [ ] **Step 4: Keep deployment locked and document the exact enable window**

Keep this default in `render.yaml`:

```yaml
- key: ACT_MIGRATION_APPLY_ENABLED
  value: "false"
```

Document: deploy with false, extract, organize, verify counts, temporarily set true, import in batches of 25, verify final reconciliation, set false again, restart API, and run the metadata-only report.

- [ ] **Step 5: Run the full verification matrix**

Run: `pnpm install --frozen-lockfile`  
Run: `pnpm run typecheck`  
Run: `pnpm --filter @workspace/api-server test`  
Run: `pnpm --filter @workspace/adventure-zone exec vitest run`  
Run: `pnpm run build`  
Run with disposable PostgreSQL: `TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @workspace/api-server test -- one-time-import.integration.test.ts`  
Expected: every command exits 0; the integration test is explicitly reported as skipped when `TEST_DATABASE_URL` is unavailable and is never misreported as production evidence.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/act-replacement/one-time-import.integration.test.ts scripts/verify-act-replacement-preview.ts scripts/verify-act-replacement-preview.test.ts scripts/report-act-replacement-import.ts scripts/report-act-replacement-import.test.ts DEPLOY.md render.yaml
git commit -m "test: gate one-time Act import rollout"
```

### Task 6: Final branch verification and pull request

**Files:**
- Review all files changed by Tasks 1–5.
- Do not change `ACT_MIGRATION_APPLY_ENABLED` from `false`.

**Interfaces:**
- Consumes: verified implementation commits.
- Produces: a reviewable pull request targeting `main`.

- [ ] **Step 1: Inspect the final diff**

Run: `git diff --check main...HEAD`  
Run: `git status --short`  
Expected: no whitespace errors and no uncommitted files.

- [ ] **Step 2: Repeat focused safety tests**

Run: `pnpm --filter @workspace/api-server test -- production-organizer.test.ts approval-service.test.ts apply-coordinator.test.ts act-replacement.test.ts`  
Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActMigrationPage.test.tsx`  
Expected: all tests pass.

- [ ] **Step 3: Open a pull request**

```bash
git push -u origin codex/act-one-time-import
gh pr create --base main --head codex/act-one-time-import --title "feat: complete safe one-time Act import" --body "Adds durable organization, review-required boundaries, batches of 25, restart-safe application, and rollout verification. Live apply remains disabled by default."
```

- [ ] **Step 4: Confirm handoff state**

The pull request summary must explicitly state that merging does not import data by itself, the Render flag remains false, and the production import window begins only after deployment and archive/review verification.
