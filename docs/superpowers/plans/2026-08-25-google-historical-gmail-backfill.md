# Historical Gmail Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a controlled, resumable, idempotent historical Gmail backfill that processes 250-message batches, pauses after the first batch for owner approval, and archives only CRM-relevant conversations/files.

**Architecture:** Extend the existing read-only Gmail client with paginated listing, add durable backfill run/batch/outcome state, and reuse the existing validation/learning/AI/review stack for classification. A new owner-only backfill service executes one batch at a time, writes per-message outcomes before advancing the page-token checkpoint, and feeds matched threads into existing profile Emails/Files storage paths.

**Tech Stack:** TypeScript, Express, PostgreSQL/node-postgres, existing Google Workspace read client, existing AI validation service, React/Vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-google-historical-gmail-backfill-design.md`

## Global Constraints

- Historical batch size is exactly 250 messages by default and must not exceed 250.
- First historical batch always ends in `awaiting_approval`.
- `TheAdventureZone12@gmail.com` / connected mailbox identity is internal and never profile ownership evidence.
- Manual corrections/ignores outrank learned/AI results.
- Same confirmed Gmail thread is strongest ownership evidence.
- Learned external email does not override clear event/profile evidence.
- Ignored/personal body text and attachments are not persisted.
- Gmail remains read-only; no mutation/write scopes are added.
- `GOOGLE_WORKSPACE_SYNC_ENABLED` gates execution but never auto-starts a batch.
- Historical Google Calendar backfill is out of scope.

---

### Task 1: Paginated Gmail message listing

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-types.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.ts`
- Test: `artifacts/api-server/src/features/google-workspace/google-api-client.test.ts`

**Interfaces:**
- Produces: `listMessagePage?(input: { maxResults: number; pageToken?: string | null }): Promise<{ messages: GoogleMessageRef[]; nextPageToken: string | null }>` on `GoogleWorkspaceReadClient`.

- [ ] **Step 1: Write the failing pagination test** proving the Gmail client sends `maxResults`, `includeSpamTrash: false`, optional `pageToken`, and returns `nextPageToken`.
- [ ] **Step 2: Run the focused test**: `pnpm vitest artifacts/api-server/src/features/google-workspace/google-api-client.test.ts` and verify the new assertion fails for the missing method.
- [ ] **Step 3: Add the interface type** in `google-api-types.ts`.
- [ ] **Step 4: Implement `listMessagePage`** in the Google API client using Gmail `users.messages.list`, bounded to 250.
- [ ] **Step 5: Run the focused test** and verify it passes.
- [ ] **Step 6: Commit** with `feat: add paginated Gmail listing`.

### Task 2: Durable backfill state and idempotent outcomes

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/google-historical-backfill-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-historical-backfill-repository.test.ts`
- Modify: startup Google Workspace migration file used by current feature tables.

**Interfaces:**
- Produces:
```ts
export type GoogleHistoricalBackfillState = {
  status: "not_started" | "running" | "awaiting_approval" | "ready" | "complete" | "paused" | "error";
  nextPageToken: string | null;
  firstBatchApproved: boolean;
  cumulative: { processed: number; attached: number; ignored: number; needsReview: number; failed: number; skipped: number };
};

export class GoogleHistoricalBackfillRepository {
  getState(): Promise<GoogleHistoricalBackfillState>;
  beginBatch(input: { pageToken: string | null; batchSize: number }): Promise<{ batchId: string }>;
  hasOutcome(messageId: string): Promise<boolean>;
  recordOutcome(input: { batchId: string; messageId: string; threadId: string; outcome: "attached" | "ignored" | "needs_review" | "failed" | "skipped"; organizationId?: string | null; errorCode?: string | null }): Promise<void>;
  finishBatch(input: { batchId: string; nextPageToken: string | null; firstBatch: boolean }): Promise<void>;
  approveFirstBatch(actorId: string): Promise<void>;
  pause(actorId: string): Promise<void>;
}
```

- [ ] **Step 1: Write repository tests** for fresh state, first-batch `awaiting_approval`, approved transition, idempotent outcome key `(connection_id,message_id)`, and cursor advancing only from `finishBatch`.
- [ ] **Step 2: Run focused repository tests** and verify RED.
- [ ] **Step 3: Add idempotent startup tables** for backfill state, batches, and per-message outcomes with unique keys.
- [ ] **Step 4: Implement repository methods** with transaction-safe state updates.
- [ ] **Step 5: Run focused tests** and verify GREEN.
- [ ] **Step 6: Commit** with `feat: persist historical Gmail backfill state`.

### Task 3: Reusable historical classifier adapter

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/google-historical-message-classifier.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-historical-message-classifier.test.ts`
- Reuse: existing `google-recent-validation-service.ts`, `google-ai-recent-validation-service.ts`, `google-validation-learning-repository.ts`, manual decision overlay.

**Interfaces:**
- Produces:
```ts
export type HistoricalClassification =
  | { outcome: "attached"; organization: { id: string; name: string }; evidenceCodes: string[] }
  | { outcome: "ignored"; evidenceCodes: string[] }
  | { outcome: "needs_review"; candidates: Array<{ id: string; name: string }>; evidenceCodes: string[] };
```

- [ ] **Step 1: Write failing tests** for thread inheritance, manual ignore, learned external-email match, body event override, AI ignore, AI review, and internal mailbox neutrality.
- [ ] **Step 2: Run focused tests** and verify RED.
- [ ] **Step 3: Implement the adapter** so it reuses current deterministic + learning + AI logic without persisting ignored bodies.
- [ ] **Step 4: Run focused tests** and verify GREEN.
- [ ] **Step 5: Commit** with `feat: classify historical Gmail messages`.

### Task 4: One controlled 250-message batch service

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/google-historical-backfill-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-historical-backfill-service.test.ts`

**Interfaces:**
- Consumes: `listMessagePage`, historical classifier, backfill repository, current mapping/review/profile-file services.
- Produces:
```ts
runNextBatch(): Promise<{
  batchId: string;
  processed: number;
  attached: number;
  ignored: number;
  needsReview: number;
  failed: number;
  skipped: number;
  nextPageAvailable: boolean;
  state: GoogleHistoricalBackfillState["status"];
}>;
```

- [ ] **Step 1: Write failing tests** covering 250 cap, skip duplicate outcome, per-message failure isolation, no cursor advance before durable outcomes, first-batch approval stop, second batch blocked before approval, auth failure stop, and final `complete` when no next token.
- [ ] **Step 2: Run focused tests** and verify RED.
- [ ] **Step 3: Implement the batch loop** with no concurrency beyond a small bounded worker pool and no Gmail mutation calls.
- [ ] **Step 4: For attached results**, upsert validation/profile mapping and reuse profile file-copy/archive hooks; for review, reuse durable review queue; for ignored, record only outcome metadata.
- [ ] **Step 5: Run focused tests** and verify GREEN.
- [ ] **Step 6: Commit** with `feat: run controlled historical Gmail batches`.

### Task 5: Owner-only backfill API and gate

**Files:**
- Create: `artifacts/api-server/src/routes/google-workspace-historical-backfill.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-historical-backfill.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: Google Workspace env/config helper for `GOOGLE_WORKSPACE_SYNC_ENABLED` reads if necessary.

**Interfaces:**
- `GET /google-workspace/historical-gmail` → state/progress.
- `POST /google-workspace/historical-gmail/run-next` → runs one 250-message batch.
- `POST /google-workspace/historical-gmail/approve-first-batch` → approves continuation.
- `POST /google-workspace/historical-gmail/pause` → pauses owner-triggered continuation.
- `POST /google-workspace/historical-gmail/retry-failures` → retries failed outcomes only.

- [ ] **Step 1: Write failing route tests** for owner-only mounting, sync-disabled refusal, validation-sample-not-approved refusal, first-batch gate, and safe error codes.
- [ ] **Step 2: Run focused tests** and verify RED.
- [ ] **Step 3: Implement routes** and mount after owner middleware.
- [ ] **Step 4: Run focused tests** and verify GREEN.
- [ ] **Step 5: Commit** with `feat: expose controlled Gmail backfill API`.

### Task 6: Google Workspace backfill UI

**Files:**
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-historical-backfill.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-historical-backfill.test.tsx`
- Modify: `artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts`
- Modify: `artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.tsx`

**Interfaces:**
- Client methods mirror Task 5 endpoints.

- [ ] **Step 1: Write failing UI tests** for `Run first 250`, first-batch approval controls, `Continue next 250`, `Retry failures`, progress counts, and disabled states while running.
- [ ] **Step 2: Run focused frontend tests** and verify RED.
- [ ] **Step 3: Implement client types/methods and Historical Gmail Backfill card**.
- [ ] **Step 4: Ensure copy clearly states that Gmail history is owner-triggered and Calendar history is not included yet**.
- [ ] **Step 5: Run focused tests** and verify GREEN.
- [ ] **Step 6: Commit** with `feat: add historical Gmail backfill controls`.

### Task 7: Verification and rollout guard

**Files:**
- Review all changed files.
- No new production feature beyond Tasks 1–6.

- [ ] **Step 1: Run focused Google Workspace tests** for pagination, repository, classifier, batch service, API, and UI.
- [ ] **Step 2: Run API typecheck/build** using repository-standard commands.
- [ ] **Step 3: Run frontend typecheck/build** using repository-standard commands.
- [ ] **Step 4: Verify `GOOGLE_WORKSPACE_SYNC_ENABLED` does not auto-start anything** and historical Calendar code is untouched.
- [ ] **Step 5: Inspect final PR diff for unrelated Scout/Excel changes**.
- [ ] **Step 6: Keep PR draft if executable verification is unavailable; never claim passing tests from zero-step GitHub Actions.**
