# ACT History Bookkeeping Purge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permanently remove ACT-only relationship/lifecycle/field-change bookkeeping from timelines, Recovery Review, and ACT archive storage while preserving meaningful human history and preventing junk from returning.

**Architecture:** Add a pure, versioned bookkeeping classifier that consumes normalized ACT timeline text, then route both existing-data purge and future recovery through that same classifier. A transactional purge service deletes all local representations of one ACT history source record in referentially safe order and processes bounded batches for production stability.

**Tech Stack:** TypeScript, PostgreSQL, Drizzle ORM, Express, Vitest, PGlite, existing ACT recovery/archive tables.

## Global Constraints

- Purge only ACT timeline/history records whose complete normalized visible content is clearly machine bookkeeping.
- Initial purge reasons are `relationship_bookkeeping`, `record_lifecycle_bookkeeping`, and `field_change_bookkeeping`.
- Meaningful emails, notes, calls, follow-ups, and narratives always win over bookkeeping keywords.
- Purge is permanent: no hidden/archive copy of matched bookkeeping records is retained.
- Remove already-imported timeline rows, recovery/review state, source/version rows, and relationship-only rows belonging only to that purged history.
- Never delete the linked organization, contact, booking, or unrelated activity/history.
- Future recovery must classify before timeline/review persistence so purged junk cannot return.
- All destructive cleanup is transactional, bounded-batch, idempotent, and tested before production code.
- Do not log full imported email/note bodies.

---

### Task 1: Add the versioned ACT bookkeeping classifier

**Files:**
- Create: `artifacts/api-server/src/features/act-recovery/history-bookkeeping-classifier.ts`
- Create: `artifacts/api-server/src/features/act-recovery/history-bookkeeping-classifier.test.ts`
- Reuse: `artifacts/api-server/src/features/act-replacement/normalizers/timeline-normalizer.ts`

**Interfaces:**
- Produces:
```ts
export const ACT_HISTORY_PURGE_POLICY_VERSION = "2026-08-16-v1";

export type ActHistoryPurgeReason =
  | "relationship_bookkeeping"
  | "record_lifecycle_bookkeeping"
  | "field_change_bookkeeping";

export type ActHistoryPurgeDecision =
  | { purge: true; reason: ActHistoryPurgeReason }
  | { purge: false };

export function classifyActHistoryForPurge(input: {
  subject: string | null;
  body: string;
}): ActHistoryPurgeDecision;
```

- [ ] **Step 1: Write failing classifier tests**

Cover exact positive fixtures:
```ts
expect(classifyActHistoryForPurge({ subject: null, body: "Linked to company Crafts - 16th Street Fair" }))
  .toEqual({ purge: true, reason: "relationship_bookkeeping" });
expect(classifyActHistoryForPurge({ subject: null, body: "Contact Downtown Denver linked" }))
  .toEqual({ purge: true, reason: "relationship_bookkeeping" });
expect(classifyActHistoryForPurge({ subject: null, body: "Record created" }))
  .toEqual({ purge: true, reason: "record_lifecycle_bookkeeping" });
expect(classifyActHistoryForPurge({ subject: null, body: "Record updated" }))
  .toEqual({ purge: true, reason: "record_lifecycle_bookkeeping" });
expect(classifyActHistoryForPurge({ subject: null, body: "Status field changed from Open to Closed" }))
  .toEqual({ purge: true, reason: "field_change_bookkeeping" });
```

Cover negative fixtures:
```ts
expect(classifyActHistoryForPurge({
  subject: "Re: contract",
  body: "I updated the contract and linked the invoice below. Please review.",
})).toEqual({ purge: false });

expect(classifyActHistoryForPurge({
  subject: "Record updated",
  body: "Amy called and asked us to follow up next Tuesday.",
})).toEqual({ purge: false });
```

- [ ] **Step 2: Run RED**

Run:
```bash
pnpm --filter @workspace/api-server exec vitest run src/features/act-recovery/history-bookkeeping-classifier.test.ts
```
Expected: FAIL because classifier module does not exist.

- [ ] **Step 3: Implement the narrow classifier**

Normalize subject/body for matching with lowercase + whitespace collapse only. Match the entire visible text against bounded patterns; do not use loose substring deletion.

Required relationship patterns include equivalent normalized forms of:
```ts
/^linked to (company|contact|opportunity)\b.+$/i
/^(company|contact|opportunity)\b.+\blinked$/i
/^unlinked from (company|contact|opportunity)\b.*$/i
```

Required lifecycle patterns include:
```ts
/^record (created|updated)$/i
/^(contact|company|opportunity|history|note) (created|updated)$/i
```

Required field-change patterns include machine-only variants such as:
```ts
/^(?:field\s+)?[\w .-]+ (?:field )?(?:changed|updated)(?: from .+ to .+)?$/i
```

Guardrail: if subject and body are both non-empty and the body is not itself a complete bookkeeping pattern, return `{ purge: false }`.

- [ ] **Step 4: Run GREEN**

Run the focused test from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/act-recovery/history-bookkeeping-classifier.ts artifacts/api-server/src/features/act-recovery/history-bookkeeping-classifier.test.ts
git commit -m "feat: classify ACT bookkeeping history"
```

---

### Task 2: Make future ACT recovery drop bookkeeping before persistence

**Files:**
- Modify: `artifacts/api-server/src/features/act-recovery/timeline-recovery.ts`
- Modify: `artifacts/api-server/src/features/act-recovery/timeline-inline-parent-recovery.pglite.test.ts`
- Create: `artifacts/api-server/src/features/act-recovery/timeline-bookkeeping-drop.pglite.test.ts`

**Interfaces:**
- Consumes: `classifyActHistoryForPurge({ subject, body })`
- Produces recovery result:
```ts
{
  state: "dropped_unusable",
  targetSummary: {
    reason: "act_bookkeeping_purged",
    purgeReason: ActHistoryPurgeReason,
    policyVersion: ACT_HISTORY_PURGE_POLICY_VERSION,
  },
}
```

- [ ] **Step 1: Write a failing real-database recovery test**

Seed a normal source company plus one ACT history source with body `Contact Downtown Denver linked`. Call `recoverTimeline(candidate)` and assert:
```ts
expect(result.state).toBe("dropped_unusable");
expect(await client.query("select count(*)::int as count from activities")).toEqual({ rows: [{ count: 0 }] });
```
Also assert no activity association is created.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/act-recovery/timeline-bookkeeping-drop.pglite.test.ts
```
Expected: FAIL because recovery currently creates/attaches the timeline record.

- [ ] **Step 3: Insert classifier immediately after timeline normalization**

In `recoverTimeline`, after `normalizeTimeline(...)` succeeds and before parent resolution or activity lookup:
```ts
const purgeDecision = classifyActHistoryForPurge({
  subject: normalized.value.subject,
  body: normalized.value.body,
});
if (purgeDecision.purge) {
  return {
    state: "dropped_unusable",
    targetSummary: {
      reason: "act_bookkeeping_purged",
      purgeReason: purgeDecision.reason,
      policyVersion: ACT_HISTORY_PURGE_POLICY_VERSION,
    },
  };
}
```

- [ ] **Step 4: Run focused + inline-history regressions**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/act-recovery/timeline-bookkeeping-drop.pglite.test.ts \
  src/features/act-recovery/timeline-inline-parent-recovery.pglite.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/act-recovery/timeline-recovery.ts artifacts/api-server/src/features/act-recovery/timeline-bookkeeping-drop.pglite.test.ts artifacts/api-server/src/features/act-recovery/timeline-inline-parent-recovery.pglite.test.ts
git commit -m "feat: drop ACT bookkeeping during recovery"
```

---

### Task 3: Add transactional permanent purge for existing ACT bookkeeping

**Files:**
- Create: `artifacts/api-server/src/features/act-recovery/history-bookkeeping-purge-repository.ts`
- Create: `artifacts/api-server/src/features/act-recovery/history-bookkeeping-purge-service.ts`
- Create: `artifacts/api-server/src/features/act-recovery/history-bookkeeping-purge.pglite.test.ts`

**Interfaces:**
- Produces:
```ts
export type ActHistoryPurgeBatchSummary = {
  scanned: number;
  purged: number;
  retained: number;
  byReason: Record<ActHistoryPurgeReason, number>;
  hasMore: boolean;
};

export interface ActHistoryBookkeepingPurgeService {
  purgeNextBatch(input?: { batchSize?: number }): Promise<ActHistoryPurgeBatchSummary>;
}
```

- [ ] **Step 1: Write failing PGlite deletion-order test**

Seed:
- one history source/version classified as `relationship_bookkeeping`
- one meaningful history source/version that must survive
- an imported `activities` row for the junk source
- `activity_associations` for the junk activity
- recovery item + recovery decision for the junk source/version
- relationship-source rows such as `history_company` pointing only at the junk parent history
- linked organization/contact rows

After one purge batch assert the junk source is absent from all of:
```sql
activities
activity_associations
act_archive_recovery_items
act_archive_recovery_decisions
act_source_record_versions
act_source_records
```
plus matching relationship-only source rows.

Assert the linked organization/contact and meaningful history remain.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/act-recovery/history-bookkeeping-purge.pglite.test.ts
```
Expected: FAIL because purge service does not exist.

- [ ] **Step 3: Implement bounded candidate selection**

Select only root timeline streams `history`, `note`, and `activity`, oldest stable source IDs first, using a default `batchSize` of `100` and a hard maximum of `250`.

For each candidate:
1. load latest preserved raw snapshot/version
2. normalize with existing `normalizeTimeline`
3. classify with `classifyActHistoryForPurge`
4. retain on normalization failure or `{ purge: false }`
5. purge only on explicit `{ purge: true }`

- [ ] **Step 4: Implement one-record transactional deletion order**

Within a transaction for each purgeable root:
1. delete `activity_revisions` for matching source-backed activity IDs if present
2. delete `activity_associations` for those activity IDs
3. clear dependent call-session references only if schema allows a nullable source-backed note pointer; never delete unrelated call sessions
4. delete matching `activities`
5. delete `act_archive_recovery_decisions` for root source/version
6. delete `act_archive_recovery_items` for root source/version
7. find relationship-source records whose `relationship_evidence->>'parentActRecordId'` equals the purged ACT history ID and whose stream type is `${rootType}_company`, `${rootType}_contact`, or `${rootType}_opportunity`; delete their recovery rows/versions/source rows
8. delete root `act_source_record_versions`
9. delete root `act_source_records`

Use exact source IDs/ACT IDs only. No fuzzy text matching in SQL.

- [ ] **Step 5: Prove idempotency**

Call `purgeNextBatch()` twice in the test. The second pass must report `purged: 0` for the already-deleted source and leave surviving data unchanged.

- [ ] **Step 6: Run GREEN**

Run the focused PGlite test. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/act-recovery/history-bookkeeping-purge-repository.ts artifacts/api-server/src/features/act-recovery/history-bookkeeping-purge-service.ts artifacts/api-server/src/features/act-recovery/history-bookkeeping-purge.pglite.test.ts
git commit -m "feat: purge existing ACT bookkeeping history"
```

---

### Task 4: Expose controlled admin purge execution and status

**Files:**
- Modify: `artifacts/api-server/src/routes/act-recovery.ts`
- Modify: `artifacts/api-server/src/routes/act-recovery.test.ts`
- Modify: `artifacts/adventure-zone/src/features/act-recovery/act-recovery-client.ts`
- Modify: `artifacts/adventure-zone/src/pages/ActRecoveryPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ActRecoveryPage.test.tsx`

**Interfaces:**
- Produces authenticated endpoint:
```http
POST /act-recovery/purge-bookkeeping
```
Request:
```json
{ "batchSize": 100 }
```
Response:
```ts
{ ok: true; summary: ActHistoryPurgeBatchSummary }
```

- [ ] **Step 1: Write failing API auth/validation tests**

Assert unauthenticated request is rejected using the repo's existing auth test pattern. Assert `batchSize` accepts `1..250` and rejects `0`, negative values, and `>250`.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/act-recovery.test.ts
```
Expected: new route assertions fail with 404.

- [ ] **Step 3: Implement route using the purge service**

Return the batch summary without exposing source bodies. Log only counts, reason totals, policy version, and duration.

- [ ] **Step 4: Add a simple admin control on ACT Recovery**

Add a button labeled `Purge ACT bookkeeping` with confirmation:
```text
Permanently delete ACT linking and system-update history that contains no meaningful note or message?
```
After one batch, show:
```text
Purged {purged} bookkeeping records · {retained} retained
```
If `hasMore` is true, keep the action available for another batch. Do not auto-loop thousands of deletes from one browser request.

- [ ] **Step 5: Run API/UI tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/act-recovery.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActRecoveryPage.test.tsx
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/act-recovery.ts artifacts/api-server/src/routes/act-recovery.test.ts artifacts/adventure-zone/src/features/act-recovery/act-recovery-client.ts artifacts/adventure-zone/src/pages/ActRecoveryPage.tsx artifacts/adventure-zone/src/pages/ActRecoveryPage.test.tsx
git commit -m "feat: add ACT bookkeeping purge control"
```

---

### Task 5: Permanent CI coverage and final verification

**Files:**
- Modify: `.github/workflows/calendar-route-handoff-ci.yml`

**Interfaces:**
- Extends existing `ACT archive recovery tests` gate.

- [ ] **Step 1: Add the new focused tests to the permanent ACT recovery gate**

Ensure the backend recovery command includes the whole `src/features/act-recovery` directory, or explicitly add:
```bash
src/features/act-recovery/history-bookkeeping-classifier.test.ts
src/features/act-recovery/timeline-bookkeeping-drop.pglite.test.ts
src/features/act-recovery/history-bookkeeping-purge.pglite.test.ts
```

- [ ] **Step 2: Run the full ACT recovery suite**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/act-recovery src/routes/act-recovery.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/features/act-recovery src/pages/ActRecoveryPage.test.tsx src/components/activities/activity-timeline.test.tsx
```
Expected: PASS.

- [ ] **Step 3: Run builds/typechecks**

```bash
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/adventure-zone run build
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```
Expected: all commands exit 0, except only previously documented repository-wide informational typecheck failures if the permanent workflow already marks them `continue-on-error`.

- [ ] **Step 4: Verify purge invariants manually in the test database**

Confirm one meaningful ACT email remains visible while `Linked to company ...`, `Contact ... linked`, `Record updated`, and field-change-only fixtures are absent from timeline, recovery review, and archive source tables.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/calendar-route-handoff-ci.yml
git commit -m "test: gate ACT bookkeeping purge"
```
