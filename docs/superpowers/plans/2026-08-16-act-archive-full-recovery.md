# ACT Archive Full Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exhaust the permanent ACT! archive into the existing Command Center so every usable archived source record is either already present, safely recovered, or visibly waiting for review, with no silent `unlinked` pile and no duplicate or destructive writes.

**Architecture:** Add a durable recovery ledger beside the existing ACT replacement archive. A restart-safe worker snapshots archive sources, processes them in dependency order, reuses existing ACT normalizers/matchers and source provenance, writes missing CRM entities/relationships/timeline records only when safe, and records a terminal classification for every candidate. A dedicated ACT Recovery admin page exposes totals and review items; recovered ACT history is read-only but appears in the normal chronological profile timeline.

**Tech Stack:** TypeScript, Node 22, Express, Drizzle ORM, PostgreSQL/PGlite, React, Wouter, Vitest, Testing Library, existing ACT replacement archive/normalizers/matchers.

## Global Constraints

- Use an **archive-first full recovery** approach; do not start a broad fresh ACT extraction.
- Do not create a second app or database.
- Existing nonblank local CRM values always win; recovery may only fill missing values automatically.
- Recovered ACT historical records are **read-only originals**; corrections are new local notes.
- Use exact ACT source identity and archived relationships for timeline ownership; do not fuzzy-attach history.
- One ACT source record may have multiple valid local associations.
- Every meaningful unplaceable record must become `needs_review`, never disappear into `unlinked`.
- Attachments are only recoverable when actual durable file bytes/application-owned references already exist; dead metadata-only attachments are dropped with no placeholder.
- Every recovery write/classification must be durable, auditable, restart-safe, and idempotent.
- `16th Street Fair (Denver) CO` is the primary end-to-end regression case: the fixture contains seven archived history rows and must surface every safely related meaningful row.

---

## File Structure

New backend recovery code lives under `artifacts/api-server/src/features/act-recovery/` so it does not further enlarge the already-large ACT organizer/review modules.

- `recovery-types.ts` — public recovery states, candidates, review decisions, statistics.
- `recovery-repository.ts` — durable run/item snapshot, leasing, source/version loading, statistics.
- `source-link-resolver.ts` — exact ACT source/relationship → local entity resolution.
- `entity-recovery.ts` — company/contact/booking/group fill-missing/create/link behavior.
- `relationship-recovery.ts` — organization-contact, booking-contact/company, calling-list membership repairs.
- `timeline-recovery.ts` — note/history/activity normalization, idempotent activity creation, association repair.
- `recovery-worker.ts` — one durable recovery step.
- `review-service.ts` — owner decisions for unresolved records.

The API is added to `artifacts/api-server/src/routes/act-recovery.ts`; the existing ACT runtime owns the worker loop. Frontend code lives in `artifacts/adventure-zone/src/features/act-recovery/` plus `ActRecoveryPage.tsx`.

---

### Task 1: Add the durable recovery ledger

**Files:**
- Create: `lib/db/migrations/043_act_archive_full_recovery.sql`
- Modify: `lib/db/src/migrations.ts`
- Modify: `lib/db/src/schema/index.ts`
- Test: `lib/db/src/act-archive-recovery-schema.test.ts`

**Interfaces:**
- Produces: `actArchiveRecoveryRuns`, `actArchiveRecoveryItems`, `actArchiveRecoveryDecisions` Drizzle exports.
- Produces terminal item states: `pending | leased | already_present | recovered | needs_review | dropped_unusable | retryable_failed`.

- [ ] **Step 1: Write the failing schema test**

Create a PGlite migration test that applies the ACT archive schema plus `043_act_archive_full_recovery.sql` and asserts the three tables, the unique `(run_id, source_record_id)` candidate key, and the lease/retry columns exist.

```ts
it("creates durable ACT archive recovery state", async () => {
  expect(await tableExists(db, "act_archive_recovery_runs")).toBe(true);
  expect(await tableExists(db, "act_archive_recovery_items")).toBe(true);
  expect(await tableExists(db, "act_archive_recovery_decisions")).toBe(true);
  expect(await uniqueIndexExists(db, "act_archive_recovery_items_run_source_unique")).toBe(true);
  expect(await columnExists(db, "act_archive_recovery_items", "lease_expires_at")).toBe(true);
});
```

- [ ] **Step 2: Run the schema test and verify RED**

Run:

```bash
pnpm --filter @workspace/db exec vitest run src/act-archive-recovery-schema.test.ts
```

Expected: FAIL because `043_act_archive_full_recovery.sql` and the recovery tables do not exist.

- [ ] **Step 3: Add the migration**

Create these tables:

```sql
CREATE TABLE act_archive_recovery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_database_key text NOT NULL,
  requested_by text NOT NULL,
  request_key text NOT NULL,
  state text NOT NULL DEFAULT 'running',
  candidate_count integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_database_key, request_key),
  CHECK (state IN ('running','complete','failed'))
);

CREATE TABLE act_archive_recovery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES act_archive_recovery_runs(id) ON DELETE CASCADE,
  source_record_id uuid NOT NULL REFERENCES act_source_records(id) ON DELETE CASCADE,
  source_version_id uuid NOT NULL REFERENCES act_source_record_versions(id),
  stream_type text NOT NULL,
  priority integer NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  target_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  retry_after timestamptz,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT act_archive_recovery_items_state_valid CHECK (state IN (
    'pending','leased','already_present','recovered','needs_review','dropped_unusable','retryable_failed'
  )),
  CONSTRAINT act_archive_recovery_items_run_source_unique UNIQUE (run_id, source_record_id)
);

CREATE INDEX act_archive_recovery_items_claim_idx
  ON act_archive_recovery_items (state, retry_after, priority, source_record_id);

CREATE TABLE act_archive_recovery_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES act_archive_recovery_runs(id) ON DELETE CASCADE,
  source_record_id uuid NOT NULL REFERENCES act_source_records(id),
  source_version_id uuid NOT NULL REFERENCES act_source_record_versions(id),
  decision text NOT NULL,
  target_entity_type text,
  target_entity_id uuid,
  decided_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (decision IN ('assign_parent','drop_unusable','retry'))
);
```

- [ ] **Step 4: Register migration 043 and Drizzle schema exports**

Add `043_act_archive_full_recovery.sql` to `migrationFiles` with a marker requiring all three tables. Mirror every migration column and enum constraint in `lib/db/src/schema/index.ts`.

- [ ] **Step 5: Run the schema test and migration-loader tests**

```bash
pnpm --filter @workspace/db exec vitest run src/act-archive-recovery-schema.test.ts src/migrations.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db/migrations/043_act_archive_full_recovery.sql lib/db/src/migrations.ts lib/db/src/schema/index.ts lib/db/src/act-archive-recovery-schema.test.ts
git commit -m "feat: add ACT archive recovery ledger"
```

---

### Task 2: Snapshot and lease every archive candidate exactly once

**Files:**
- Create: `artifacts/api-server/src/features/act-recovery/recovery-types.ts`
- Create: `artifacts/api-server/src/features/act-recovery/recovery-repository.ts`
- Test: `artifacts/api-server/src/features/act-recovery/recovery-repository.pglite.test.ts`

**Interfaces:**
- Produces `RecoveryState`, `RecoveryCandidate`, `RecoveryRunStatus`.
- Produces `RecoveryRepository.createOrGetRun()`, `claimNext()`, `complete()`, `failRetryable()`, `status()`, `reviewPage()`.

- [ ] **Step 1: Write the failing run-snapshot tests**

Seed `act_source_records` with company/contact/opportunity/group/note/history/activity and relationship stream rows. Assert a recovery run snapshots every record with a latest version, preserves its version ID, and assigns deterministic priority.

```ts
expect(items.map((item) => item.streamType)).toEqual([
  "company", "contact", "company_contact", "opportunity",
  "opportunity_company", "opportunity_contact", "group", "group_contact",
  "note", "history", "activity", "history_company",
]);
```

Also test replaying the same `requestKey` returns the same run rather than creating a second candidate population.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/act-recovery/recovery-repository.pglite.test.ts
```

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement public types**

```ts
export type RecoveryState =
  | "pending" | "leased" | "already_present" | "recovered"
  | "needs_review" | "dropped_unusable" | "retryable_failed";

export type RecoveryCandidate = {
  itemId: string;
  runId: string;
  sourceRecordId: string;
  sourceVersionId: string;
  streamType: string;
  actRecordId: string | null;
  rawSnapshot: Record<string, unknown>;
  relationshipEvidence: Record<string, unknown>;
  leaseToken: string;
};
```

- [ ] **Step 4: Implement deterministic candidate priorities**

Use dependency order rather than insertion time:

```ts
const recoveryPriority: Record<string, number> = {
  company: 10,
  contact: 20,
  company_contact: 30,
  opportunity: 40,
  opportunity_company: 50,
  opportunity_contact: 50,
  group: 60,
  group_contact: 70,
  note: 80,
  history: 80,
  activity: 80,
  note_contact: 90,
  note_company: 90,
  note_opportunity: 90,
  history_contact: 90,
  history_company: 90,
  history_opportunity: 90,
  activity_contact: 90,
  activity_company: 90,
  activity_opportunity: 90,
};
```

`createOrGetRun()` must snapshot `latest_version_id` into recovery items. `claimNext()` uses `FOR UPDATE SKIP LOCKED`, a UUID lease token, a five-minute lease, and processes `retryable_failed` only when `retry_after <= now()`.

- [ ] **Step 5: Add terminal-state and reclaim tests**

Prove expired leases are reclaimable, live leases are not double-claimed, terminal rows are never claimed again, and status arithmetic equals candidate count.

- [ ] **Step 6: Run tests GREEN**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/act-recovery/recovery-repository.pglite.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/act-recovery
git commit -m "feat: snapshot ACT archive recovery candidates"
```

---

### Task 3: Resolve exact ACT identities and relationship evidence

**Files:**
- Create: `artifacts/api-server/src/features/act-recovery/source-link-resolver.ts`
- Test: `artifacts/api-server/src/features/act-recovery/source-link-resolver.pglite.test.ts`

**Interfaces:**
- Consumes `act_source_records`, `act_external_links`, relationship `relationship_evidence`.
- Produces `resolveLocalSource()` and `resolveRelationship()`.

- [ ] **Step 1: Write failing exact-resolution tests**

Cover:

1. company ACT ID → local organization via `act_external_links`;
2. contact ACT ID → local contact;
3. opportunity ACT ID → local booking;
4. group ACT ID → local calling list;
5. `history_company` evidence `{ parentActRecordId, targetKind: "company", targetActRecordId }` → parent history source + local organization;
6. conflicting two-local-target provenance → ambiguous result, never first-row-wins.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/act-recovery/source-link-resolver.pglite.test.ts
```

- [ ] **Step 3: Implement exact source resolution**

```ts
export type LocalSourceResolution =
  | { kind: "resolved"; entityType: "organization" | "contact" | "booking" | "calling_list"; entityId: string }
  | { kind: "missing" }
  | { kind: "ambiguous"; candidates: Array<{ entityType: string; entityId: string }> };
```

Resolve by `source_record_id` first, then the same database/stream/ACT ID legacy provenance fallback already used by the replacement apply repository. Never resolve by display name here.

- [ ] **Step 4: Implement relationship parsing**

```ts
export type ArchivedRelationship = {
  parentSourceRecordId: string;
  parentActRecordId: string;
  targetKind: "contact" | "company" | "opportunity";
  targetActRecordId: string;
};
```

Validate the archived relationship evidence. Malformed evidence yields a typed `invalid_relationship_evidence` result, not a guessed relationship.

- [ ] **Step 5: Run GREEN**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/act-recovery/source-link-resolver.pglite.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/act-recovery/source-link-resolver.ts artifacts/api-server/src/features/act-recovery/source-link-resolver.pglite.test.ts
git commit -m "feat: resolve archived ACT relationships exactly"
```

---

### Task 4: Recover missing companies and contacts without overwriting local work

**Files:**
- Create: `artifacts/api-server/src/features/act-recovery/entity-recovery.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/archive-profile-resolver.ts` only if a pure helper must be exported; do not duplicate its scoring policy.
- Test: `artifacts/api-server/src/features/act-recovery/entity-recovery.pglite.test.ts`

**Interfaces:**
- Consumes existing `normalizeCompany`, `normalizeContact`, archive profile resolution rules, exact provenance resolver.
- Produces `recoverEntity(candidate): Promise<RecoveryApplyResult>` for `company | contact`.

- [ ] **Step 1: Write failing company/contact tests**

Prove:

- an already-linked source is `already_present`;
- a linked local profile with blank phone gets the ACT phone filled;
- a populated local phone is never replaced;
- an exact deterministic local match gains provenance rather than duplicating the profile;
- a valid unmatched company/contact can be created;
- an ambiguous match is `needs_review`;
- malformed/no-useful-content source is `dropped_unusable`.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/act-recovery/entity-recovery.pglite.test.ts
```

- [ ] **Step 3: Implement fill-missing semantics**

Use a helper with explicit local-wins behavior:

```ts
export function fillMissing<T extends Record<string, unknown>>(
  local: T,
  source: Partial<T>,
): Partial<T> {
  return Object.fromEntries(Object.entries(source).filter(([key, value]) =>
    (local[key] === null || local[key] === undefined || local[key] === "") &&
    value !== null && value !== undefined && value !== ""
  )) as Partial<T>;
}
```

Every mutation must add/retain `act_external_links` provenance and create an audit entry with action `act_archive_recovered`.

- [ ] **Step 4: Reuse archive profile resolution instead of inventing a new fuzzy matcher**

For unlinked company/contact records, load the same candidate shapes used by `archive-profile-import-repository.ts`, call `resolveArchiveProfile()`, and accept only `create_profile`, `link_existing`, or `update_existing`. `preserve_unmatched`/ambiguous outcomes become `needs_review` when meaningful.

- [ ] **Step 5: Run GREEN and regression tests for archive profile import**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/act-recovery/entity-recovery.pglite.test.ts src/features/act-replacement/archive-profile-import-repository.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/act-recovery/entity-recovery.ts artifacts/api-server/src/features/act-recovery/entity-recovery.pglite.test.ts artifacts/api-server/src/features/act-replacement/archive-profile-resolver.ts
git commit -m "feat: recover missing ACT companies and contacts"
```

---

### Task 5: Recover bookings, groups, and CRM relationships

**Files:**
- Create: `artifacts/api-server/src/features/act-recovery/relationship-recovery.ts`
- Extend: `artifacts/api-server/src/features/act-recovery/entity-recovery.ts`
- Test: `artifacts/api-server/src/features/act-recovery/relationship-recovery.pglite.test.ts`

**Interfaces:**
- Consumes `normalizeOpportunity`, `normalizeGroup`, `matchBooking`, exact relationship resolver.
- Produces recovery handling for `opportunity`, `group`, `company_contact`, `opportunity_company`, `opportunity_contact`, `group_contact`.

- [ ] **Step 1: Write failing booking/group tests**

Prove an ACT opportunity whose company relationship resolves can create/link a booking using the resolved organization's city/region when the opportunity lacks local location fields. If the organization cannot be resolved, keep the meaningful opportunity in `needs_review` rather than creating an orphan booking.

Prove an ACT group creates/links one calling list, idempotently.

- [ ] **Step 2: Write failing relationship repair tests**

Test exact repairs:

```ts
company_contact       -> organizationContacts
opportunity_company   -> bookings.organizationId only when blank; conflict => needs_review
opportunity_contact   -> bookingContacts
group_contact         -> callingListMemberships
```

A second run must report `already_present` for already-existing relationships.

- [ ] **Step 3: Verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/act-recovery/relationship-recovery.pglite.test.ts
```

- [ ] **Step 4: Implement conservative booking recovery**

Normalize the opportunity. Resolve its archived company first. Use exact provenance or `matchBooking()` for deterministic matches. Only create when name + organization + usable city/region are available. Never overwrite an existing populated `organizationId`, primary contact, notes, dates, status, or probability merely because ACT differs.

- [ ] **Step 5: Implement relationship writes with existing helpers**

Reuse `ensurePlacePersonRelationship()` for organization-contact links. Insert booking contacts and calling-list memberships with their existing uniqueness/idempotency rules. For `opportunity_company`, fill `bookings.organizationId` only when null; a different non-null organization is `needs_review`.

- [ ] **Step 6: Run GREEN**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/act-recovery/relationship-recovery.pglite.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/act-recovery/entity-recovery.ts artifacts/api-server/src/features/act-recovery/relationship-recovery.ts artifacts/api-server/src/features/act-recovery/relationship-recovery.pglite.test.ts
git commit -m "feat: recover ACT bookings groups and relationships"
```

---

### Task 6: Recover notes, history, email history, activities, and missing associations

**Files:**
- Create: `artifacts/api-server/src/features/act-recovery/timeline-recovery.ts`
- Test: `artifacts/api-server/src/features/act-recovery/timeline-recovery.pglite.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/normalizers/timeline-normalizer.ts` only for real ACT fixture variants exposed by the tests.

**Interfaces:**
- Consumes `normalizeTimeline(rawSnapshot, capturedAt, sourceType)` and exact relationships.
- Produces one `activities` row per source record plus zero-or-more `activity_associations`.

- [ ] **Step 1: Write failing content-normalization tests**

Use realistic ACT shapes:

```ts
{ id: "h1", regarding: "E-mail sent", details: "Proposal package sent", startTime: "2025-04-16T14:30:00Z" }
{ id: "h2", regarding: "Added contact", details: "" }
{ id: "n1", noteText: "Asked us to follow up in March", displayDate: "2025-01-08T12:00:00Z" }
```

Assert meaningful `regarding` is retained when details are empty and dates preserve ACT dates.

- [ ] **Step 2: Write failing ownership/idempotency tests**

Seed one history source with `history_company` and `history_contact` relationships. Assert recovery creates one activity and two associations. Re-run and assert zero additional activity rows or associations.

Also seed a pre-existing activity with the same `source_record_id` but one missing association; recovery adds only the missing association.

- [ ] **Step 3: Write failing unresolved-content tests**

A meaningful history source with no safely resolved relationship becomes `needs_review`; an actually blank source becomes `dropped_unusable`.

- [ ] **Step 4: Verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/act-recovery/timeline-recovery.pglite.test.ts
```

- [ ] **Step 5: Implement timeline recovery**

For source type mapping:

```ts
const timelineSourceType = {
  note: "note",
  history: "history",
  activity: "activity",
} as const;
```

Insert with `activities.sourceRecordId = candidate.sourceRecordId`, `kind = normalized.category`, `body = normalized.body`, `occurredAt = normalized.sourceOccurredAt ? new Date(...) : null`, and `timelineSortAt = new Date(normalized.timelineSortAt)`. Use archived relationships to create all resolved `activity_associations` atomically.

- [ ] **Step 6: Run GREEN plus existing timeline normalizer tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/act-recovery/timeline-recovery.pglite.test.ts src/features/act-replacement/normalizers/timeline-normalizer.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/act-recovery/timeline-recovery.ts artifacts/api-server/src/features/act-recovery/timeline-recovery.pglite.test.ts artifacts/api-server/src/features/act-replacement/normalizers/timeline-normalizer.ts
git commit -m "feat: recover archived ACT timeline history"
```

---

### Task 7: Enforce immutable ACT history and expose provenance in normal timelines

**Files:**
- Modify: `artifacts/api-server/src/features/activities/activity-types.ts`
- Modify: `artifacts/api-server/src/features/activities/activity-repository.ts`
- Modify: `artifacts/api-server/src/features/event-profiles/event-profile-repository.ts`
- Modify: `artifacts/adventure-zone/src/features/activities/activity-types.ts`
- Modify: `artifacts/adventure-zone/src/components/activities/activity-timeline.tsx`
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`
- Test: `artifacts/api-server/src/features/activities/activity-repository.pglite.test.ts`
- Test: `artifacts/adventure-zone/src/components/activities/activity-timeline.test.tsx`

**Interfaces:**
- Extends timeline items with `importedFromAct: boolean` and `actSourceType: "note" | "history" | "activity" | null`.

- [ ] **Step 1: Write failing server immutability test**

Existing delete logic already rejects `sourceRecordId`; add equivalent edit coverage:

```ts
const result = await repo.edit({
  activityId: imported.id,
  body: "changed",
  reason: "correction",
  callOutcome: null,
});
expect(result).toEqual(expect.objectContaining({
  ok: false,
  error: expect.objectContaining({ code: "INVALID_ACTIVITY_INPUT" }),
}));
```

- [ ] **Step 2: Write failing provenance UI test**

Render an imported history item and assert `Imported from ACT · History` is visible while Edit/Delete controls are absent. Render a local note and assert its controls remain.

- [ ] **Step 3: Verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/activities/activity-repository.pglite.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/activities/activity-timeline.test.tsx
```

- [ ] **Step 4: Join archive source provenance in activity projections**

Left-join `act_source_records` on `activities.source_record_id` in paged timeline/profile queries and project the root stream type. Do not require consumers to infer provenance from `kind`.

- [ ] **Step 5: Reject imported edits server-side and hide mutation controls client-side**

Return the existing `INVALID_ACTIVITY_INPUT` error with message `Imported ACT history is read-only. Add a new note to record a correction.`

- [ ] **Step 6: Run GREEN**

Run both commands from Step 3 plus the existing event-profile tests.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/activities artifacts/api-server/src/features/event-profiles artifacts/adventure-zone/src/features/activities artifacts/adventure-zone/src/components/activities artifacts/adventure-zone/src/components/event-profiles
git commit -m "feat: preserve ACT history as read-only provenance"
```

---

### Task 8: Add the restart-safe recovery worker to the existing ACT runtime

**Files:**
- Create: `artifacts/api-server/src/features/act-recovery/recovery-worker.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/runtime.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/worker-loop.ts` only if a reusable loop label is needed.
- Test: `artifacts/api-server/src/features/act-recovery/recovery-worker.test.ts`
- Test: `artifacts/api-server/src/features/act-replacement/runtime.test.ts`

**Interfaces:**
- Produces `ActArchiveRecoveryWorker.runOne({ workerId, now }): Promise<{ kind: "idle" | "progress" }>`.
- Recovery runtime must run even when live ACT configuration is missing/invalid.

- [ ] **Step 1: Write failing worker routing tests**

Given claimed candidates of each stream type, assert the worker dispatches to entity, relationship, or timeline recovery and persists the returned terminal classification. Unknown/invalid source types become `dropped_unusable`, not process crashes.

- [ ] **Step 2: Write failing retry test**

A transient database/storage error produces `retryable_failed` with bounded backoff; a later step reclaims it and can complete it. The worker must not mark the run complete while retryable rows remain.

- [ ] **Step 3: Verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/act-recovery/recovery-worker.test.ts src/features/act-replacement/runtime.test.ts
```

- [ ] **Step 4: Implement worker dispatch**

```ts
if (["company","contact","opportunity","group"].includes(candidate.streamType)) {
  result = await entityRecovery.recover(candidate);
} else if (candidate.streamType === "note" || candidate.streamType === "history" || candidate.streamType === "activity") {
  result = await timelineRecovery.recover(candidate);
} else {
  result = await relationshipRecovery.recover(candidate);
}
```

- [ ] **Step 5: Add the archive recovery loop to `createProductionArchiveRuntime()`**

Combine the existing archive-profile-import loop and a new `ActOrganizerWorkerLoop` using `ActArchiveRecoveryWorker`. It must start without live ACT credentials because all reads are local archive reads.

- [ ] **Step 6: Run GREEN**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/act-recovery/recovery-worker.test.ts src/features/act-replacement/runtime.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/act-recovery/recovery-worker.ts artifacts/api-server/src/features/act-replacement/runtime.ts artifacts/api-server/src/features/act-replacement/worker-loop.ts artifacts/api-server/src/features/act-recovery/recovery-worker.test.ts artifacts/api-server/src/features/act-replacement/runtime.test.ts
git commit -m "feat: run archive recovery in durable worker"
```

---

### Task 9: Add ACT Recovery status and review APIs

**Files:**
- Create: `artifacts/api-server/src/features/act-recovery/review-service.ts`
- Create: `artifacts/api-server/src/routes/act-recovery.ts`
- Modify: `artifacts/api-server/src/app.ts`
- Test: `artifacts/api-server/src/routes/act-recovery.test.ts`

**Interfaces:**
- `POST /act-recovery/runs`
- `GET /act-recovery/status`
- `GET /act-recovery/review?page=1`
- `POST /act-recovery/review/:sourceRecordId/assign`
- `POST /act-recovery/review/:sourceRecordId/drop`
- `POST /act-recovery/review/:sourceRecordId/retry`

- [ ] **Step 1: Write failing API tests**

Assert a run can be started idempotently, status contains whole-run/per-type counts, review pagination includes original ACT content and exact relationship evidence, and invalid UUID/target types are rejected.

- [ ] **Step 2: Write failing decision tests**

Assigning a timeline review item to `{ targetEntityType: "organization", targetEntityId }` writes a durable decision and requeues the item. Dropping requires an explicit `drop_unusable` decision. A decision against a stale source version returns 409.

- [ ] **Step 3: Verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/act-recovery.test.ts
```

- [ ] **Step 4: Implement review decisions**

`assign_parent` is valid for timeline sources against organization/contact/booking targets; root entity review uses existing ACT review flows rather than arbitrary parent assignment. Store `source_version_id` with every decision and reject stale replay.

- [ ] **Step 5: Implement status reconciliation**

Return:

```ts
{
  candidateCount,
  checkedCount,
  alreadyPresent,
  recovered,
  needsReview,
  droppedUnusable,
  retryableFailed,
  byStreamType,
  complete: checkedCount === candidateCount && retryableFailed === 0 && pending === 0 && leased === 0,
}
```

- [ ] **Step 6: Run GREEN**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/act-recovery.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/act-recovery/review-service.ts artifacts/api-server/src/routes/act-recovery.ts artifacts/api-server/src/routes/act-recovery.test.ts artifacts/api-server/src/app.ts
git commit -m "feat: add ACT recovery review API"
```

---

### Task 10: Build the ACT Recovery admin page

**Files:**
- Create: `artifacts/adventure-zone/src/features/act-recovery/act-recovery-client.ts`
- Create: `artifacts/adventure-zone/src/pages/ActRecoveryPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ActRecoveryPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ActMigrationPage.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/App.admin-navigation.test.ts`

**Interfaces:**
- Adds protected route `/settings/act-recovery`.
- Provides Start/Resume Recovery, status cards, per-type counts, and Recovery Review cards.

- [ ] **Step 1: Write failing routing/UI tests**

Assert `/settings/act-recovery` renders `ACT Recovery`, the migration page links to it, and status cards show Archived candidates / Already present / Recovered / Needs review / Dropped unusable / Retryable failures.

- [ ] **Step 2: Write failing review interaction test**

Given an unresolved history item, show its original source date/type/body plus relationship evidence. Selecting a local profile and clicking `Assign & retry` calls the assign endpoint. `Drop unusable` is a separate explicit action.

- [ ] **Step 3: Verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActRecoveryPage.test.tsx src/App.admin-navigation.test.ts
```

- [ ] **Step 4: Implement the typed client and page**

Use the existing authenticated `apiGet`/`apiPost` helpers. Poll status only while a run is incomplete; stop polling when complete or failed. Keep the page usable on mobile with single-column review cards.

- [ ] **Step 5: Add the route and migration-page entry point**

```tsx
<Route path="/settings/act-recovery" component={ActRecoveryPage} />
```

Add a clear `Recover archived ACT data` action from the existing ACT Migration page rather than creating a duplicate settings system.

- [ ] **Step 6: Run GREEN and production build**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActRecoveryPage.test.tsx src/App.admin-navigation.test.ts
pnpm --filter @workspace/adventure-zone run build
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/features/act-recovery artifacts/adventure-zone/src/pages/ActRecoveryPage.tsx artifacts/adventure-zone/src/pages/ActRecoveryPage.test.tsx artifacts/adventure-zone/src/pages/ActMigrationPage.tsx artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/App.admin-navigation.test.ts
git commit -m "feat: add ACT archive recovery workspace"
```

---

### Task 11: Prove the 16th Street Fair recovery end-to-end and exhaust the archive

**Files:**
- Create: `artifacts/api-server/src/features/act-recovery/fixtures/16th-street-fair.ts`
- Create: `artifacts/api-server/src/features/act-recovery/act-recovery.e2e.pglite.test.ts`
- Modify: `.github/workflows/calendar-route-handoff-ci.yml`
- Modify: `docs/superpowers/specs/2026-08-16-act-archive-full-recovery-design.md` only to record any verified archive attachment limitation discovered during implementation.

**Interfaces:**
- Produces a deterministic seven-history fixture and final reconciliation gate.

- [ ] **Step 1: Seed the real regression shape**

Fixture must contain:

- one ACT company mapped to `16th Street Fair (Denver) CO`;
- its contact mapping;
- seven `history` source records with latest versions;
- exact `history_company` / `history_contact` relationship evidence;
- a mix of email-history and contact/history rows mirroring the user-visible ACT case.

- [ ] **Step 2: Write the failing end-to-end test**

Run recovery to idle and assert:

```ts
expect(await activityCountForOrganization(orgId)).toBe(7);
expect((await eventProfile(orgId)).notes).toHaveLength(7);
expect((await recoveryStatus()).retryableFailed).toBe(0);
expect((await recoveryStatus()).candidateCount).toBe((await recoveryStatus()).checkedCount);
```

Run the full recovery a second time and assert the activity count is still seven.

- [ ] **Step 3: Verify RED before final implementation fixes**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/act-recovery/act-recovery.e2e.pglite.test.ts
```

Expected: any remaining cross-component recovery gap fails this fixture.

- [ ] **Step 4: Close only the demonstrated gaps**

Fix the smallest production behavior required by the fixture; do not loosen exact relationship rules or local-wins protections merely to make the test pass.

- [ ] **Step 5: Add attachment capability reconciliation**

Query the permanent archive model used by recovery and assert there is no dedicated attachment/document stream. If implementation discovers an existing durable application-owned file reference in archived snapshots, add a concrete file-backed recovery adapter and tests in this task. Otherwise, record `recoverable attachment candidates = 0` in the run report and do not create metadata placeholders or a speculative attachment table.

- [ ] **Step 6: Add focused CI commands**

Extend `calendar-route-handoff-ci.yml` with one `ACT archive recovery tests` step:

```yaml
- name: ACT archive recovery tests
  run: pnpm --filter @workspace/api-server exec vitest run \
    src/features/act-recovery/recovery-repository.pglite.test.ts \
    src/features/act-recovery/source-link-resolver.pglite.test.ts \
    src/features/act-recovery/entity-recovery.pglite.test.ts \
    src/features/act-recovery/relationship-recovery.pglite.test.ts \
    src/features/act-recovery/timeline-recovery.pglite.test.ts \
    src/features/act-recovery/recovery-worker.test.ts \
    src/features/act-recovery/act-recovery.e2e.pglite.test.ts \
    src/routes/act-recovery.test.ts
```

- [ ] **Step 7: Run final verification**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/act-recovery src/routes/act-recovery.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActRecoveryPage.test.tsx src/components/activities/activity-timeline.test.tsx src/App.admin-navigation.test.ts
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/adventure-zone run build
```

Then run the existing workflow-relevant ACT/profile tests. The repo-wide typecheck remains informational only if it fails exclusively on pre-existing main-branch errors; no new recovery-file type errors are acceptable.

- [ ] **Step 8: Verify the reconciliation invariant**

For the fixture and a representative mixed archive dataset:

```ts
candidateCount === alreadyPresent + recovered + needsReview + droppedUnusable
retryableFailed === 0
pending === 0
leased === 0
```

There must be no `unlinked` count or unclassified source rows.

- [ ] **Step 9: Commit**

```bash
git add artifacts/api-server/src/features/act-recovery/fixtures artifacts/api-server/src/features/act-recovery/act-recovery.e2e.pglite.test.ts .github/workflows/calendar-route-handoff-ci.yml docs/superpowers/specs/2026-08-16-act-archive-full-recovery-design.md
git commit -m "test: prove ACT archive recovery end to end"
```

---

## Final self-review checklist

Before opening the implementation PR, verify all of the following against the approved spec:

- Company/contact/opportunity/group roots are classified and recovered conservatively.
- Organization/contact/booking/calling-list relationships are repaired from exact ACT evidence.
- Notes, history, email history, and activities become normal profile timeline entries.
- Existing timeline rows gain missing associations without duplication.
- Imported ACT history cannot be edited or deleted server-side or in the UI.
- Local nonblank fields are never overwritten automatically.
- Meaningful unplaceable records remain visible in Recovery Review.
- Dead/unavailable attachments have no placeholder.
- Recovery works with live ACT configuration absent.
- Recovery can resume after lease/process failure.
- Run totals reconcile exactly with no hidden `unlinked` population.
- 16th Street Fair's seven archived history records are the primary regression gate.
- A second recovery pass produces zero duplicate activities/entities/relationships.
