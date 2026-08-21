# Booking Assistant Command Router and Audit Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make General Command Center distinguish searches from operational commands, immediately run safe read-only website audits as durable background jobs, and require explicit approval before applying any CRM website changes.

**Architecture:** Insert a bounded command router ahead of the current General Assistant profile-search fallback. Registered capabilities can return immediate results or create durable `assistant_jobs`; the first background capability is `website_verification`, implemented with the same lease/progress/cancellation pattern already used by Lead Scout. Website findings are persisted separately from immutable change proposals, and only an explicit approval route can apply high-confidence proposals after optimistic stale-value checks.

**Tech Stack:** TypeScript, Express, React/Vite, PostgreSQL/Drizzle and existing SQL repository patterns, Zod, Vitest/Testing Library, existing owner/admin auth, existing General Assistant and Lead Scout worker-loop patterns, existing profile/event repositories and audit log service.

**Spec:** `docs/superpowers/specs/2026-08-21-assistant-command-router-audits-design.md`

## Global Constraints

- Read-only searches, audits, reports, verification, and research start immediately when their scope is safe and clear.
- CRM writes never occur from `check`, `audit`, `find`, `research`, `verify`, or similar wording alone.
- Every mutation requires a separate explicit approval request.
- Bulk apply is limited to the exact immutable set of high-confidence proposals presented to the user.
- Medium- and low-confidence proposals are excluded from bulk apply and remain review-only.
- Before applying a proposal, the current CRM website value must still equal the proposal's expected old value.
- Large audits run in bounded batches and must not block normal API/app use.
- The model cannot execute SQL, arbitrary filters, arbitrary URLs, or arbitrary mutations.
- Existing deterministic profile search and Lead Scout behavior must continue working.
- Manager Assistant remains separate and does not gain admin-wide audit capabilities.
- URL retrieval must reject unsafe/private-network targets, limit redirects, and enforce timeouts/body-size bounds.
- Persist bounded evidence/provenance only; do not store complete scraped pages.

---

### Task 1: Add bounded assistant command contracts and deterministic routing

**Files:**
- Create: `artifacts/api-server/src/features/assistant/assistant-command-types.ts`
- Create: `artifacts/api-server/src/features/assistant/assistant-command-router.ts`
- Create: `artifacts/api-server/src/features/assistant/assistant-command-router.test.ts`
- Modify: `artifacts/api-server/src/features/assistant/general-assistant.ts`
- Modify: `artifacts/api-server/src/routes/assistant.ts`

**Interfaces:**

```ts
export type AssistantCommandKind =
  | "search"
  | "audit"
  | "research"
  | "report"
  | "change"
  | "question";

export type AssistantCommandRisk =
  | "read_only"
  | "proposes_changes"
  | "writes_data";

export type AssistantCommandScope =
  | { kind: "all_applicable" }
  | { kind: "current_profile"; recordId: string }
  | { kind: "record_ids"; recordIds: string[] };

export type AssistantCommand = {
  kind: AssistantCommandKind;
  capability: "website_verification";
  originalText: string;
  scope: AssistantCommandScope;
  parameters: Record<string, never>;
  risk: AssistantCommandRisk;
  confidence: "high" | "medium" | "low";
};

export function routeAssistantCommand(
  question: string,
): AssistantCommand | null;
```

For Phase 1, only `website_verification` is added to the registry. Existing profile lookup and Lead Scout remain their current deterministic paths rather than being rewritten into the new registry in the same change.

- [ ] **Step 1: Write failing routing tests**

Add exact cases:

```ts
expect(routeAssistantCommand("Check all websites")).toMatchObject({
  kind: "audit",
  capability: "website_verification",
  scope: { kind: "all_applicable" },
  risk: "read_only",
});

expect(routeAssistantCommand(
  "Make sure the profiles/events that have websites, the website works and matched the profile its attached to",
)).toMatchObject({ capability: "website_verification", risk: "read_only" });

expect(routeAssistantCommand("Verify our event websites belong to the right profile"))
  .toMatchObject({ capability: "website_verification" });

expect(routeAssistantCommand("Find Morton County Fair")).toBeNull();
expect(routeAssistantCommand("Who needs follow-up?")).toBeNull();
expect(routeAssistantCommand("Delete the wrong websites")).toBeNull();
```

Also prove unsupported verbs/targets do not become arbitrary commands.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/assistant-command-router.test.ts
```

Expected: FAIL because the router does not exist.

- [ ] **Step 3: Implement conservative deterministic routing**

Normalize punctuation/case and require both a website target and a verification/audit intent. Example implementation shape:

```ts
const websiteTarget = /\b(web ?sites?|urls?|links?)\b/i;
const auditVerb = /\b(check|verify|audit|make sure|validate|test)\b/i;
const ownershipIntent = /\b(match|belong|attached|right profile|correct profile|works?|broken|dead)\b/i;

export function routeAssistantCommand(question: string): AssistantCommand | null {
  const text = question.trim();
  if (!websiteTarget.test(text) || !auditVerb.test(text)) return null;
  if (!ownershipIntent.test(text) && !/\ball\b/i.test(text)) return null;
  return {
    kind: "audit",
    capability: "website_verification",
    originalText: text,
    scope: { kind: "all_applicable" },
    parameters: {},
    risk: "read_only",
    confidence: "high",
  };
}
```

Do not add an open-ended AI-to-command executor in this task.

- [ ] **Step 4: Route commands before profile-search fallback**

In `POST /assistant/general/ask`, after the existing Lead Scout detection and before `answerGeneralAssistant`, call the new router. For now delegate matching commands to a `WebsiteAuditService` dependency introduced in Task 5; until that task lands, add the type seam/interface only and keep tests compiling with an injected fake.

Extend `GeneralAssistantResponse` with:

```ts
| { kind: "assistant_job"; text: string; job: AssistantJobView }
```

- [ ] **Step 5: Run tests and commit**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/assistant-command-router.test.ts
git add artifacts/api-server/src/features/assistant/assistant-command-* artifacts/api-server/src/features/assistant/general-assistant.ts artifacts/api-server/src/routes/assistant.ts
git commit -m "feat: route assistant audit commands"
```

### Task 2: Persist general assistant jobs, findings, and immutable change proposals

**Files:**
- Create: `lib/db/migrations/064_assistant_command_jobs.sql`
- Create: `artifacts/api-server/src/features/assistant/assistant-job-types.ts`
- Create: `artifacts/api-server/src/features/assistant/assistant-job-repository.ts`
- Create: `artifacts/api-server/src/features/assistant/assistant-job-repository.test.ts`

**Interfaces:**

```ts
export type AssistantJobStatus =
  | "queued"
  | "running"
  | "stopping"
  | "stopped"
  | "complete"
  | "failed";

export type WebsiteAuditStatus =
  | "verified_match"
  | "reachable_uncertain"
  | "likely_mismatch"
  | "broken"
  | "redirected"
  | "replacement_found"
  | "needs_review";

export type AssistantJobView = {
  id: string;
  capability: "website_verification";
  originalInstruction: string;
  status: AssistantJobStatus;
  stage: string;
  progress: {
    total: number;
    processed: number;
    verified: number;
    broken: number;
    mismatches: number;
    review: number;
    proposedFixes: number;
  };
  findings: WebsiteAuditFindingView[];
  proposals: AssistantChangeProposalView[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  failureMessage: string | null;
};
```

- [ ] **Step 1: Write migration/repository tests first**

Test `createJob`, `claimRunnable`, lease ownership, `requestStop`, `continueJob`, progress updates, finding upsert, proposal insert, actor-scoped reads, and latest-job lookup.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/assistant-job-repository.test.ts
```

- [ ] **Step 3: Add durable SQL tables**

Migration must create these tables with UUID primary keys/defaults, FK cascades, timestamps, and indexes:

```sql
create table if not exists assistant_jobs (
  id uuid primary key default gen_random_uuid(),
  actor_id text not null,
  capability text not null check (capability in ('website_verification')),
  original_instruction text not null,
  normalized_command jsonb not null default '{}'::jsonb,
  status text not null check (status in ('queued','running','stopping','stopped','complete','failed')),
  stage text not null,
  progress jsonb not null default '{}'::jsonb,
  cancel_requested_at timestamptz,
  worker_id text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists assistant_job_findings (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references assistant_jobs(id) on delete cascade,
  record_id uuid not null,
  record_label text not null,
  saved_url text not null,
  final_url text,
  status text not null,
  confidence text not null check (confidence in ('high','medium','low')),
  reasons jsonb not null default '[]'::jsonb,
  suggested_url text,
  source_refs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id, record_id)
);

create table if not exists assistant_change_proposals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references assistant_jobs(id) on delete cascade,
  record_id uuid not null,
  field text not null check (field = 'website'),
  old_value text,
  new_value text,
  confidence text not null check (confidence in ('high','medium','low')),
  reasons jsonb not null default '[]'::jsonb,
  status text not null default 'proposed' check (status in ('proposed','approved','applied','rejected','failed')),
  approved_by text,
  approved_at timestamptz,
  applied_at timestamptz,
  failure_message text,
  created_at timestamptz not null default now(),
  unique(job_id, record_id, field)
);
```

Add indexes on `(actor_id, created_at desc)`, runnable `(status, lease_expires_at, updated_at)`, and finding/proposal `job_id`.

- [ ] **Step 4: Implement repository lease behavior using the Lead Scout pattern**

`claimRunnable` must use `FOR UPDATE SKIP LOCKED` and only return one job whose lease is absent/expired. `getJob` must always require `actorId`.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/assistant-job-repository.test.ts
git add lib/db/migrations/064_assistant_command_jobs.sql artifacts/api-server/src/features/assistant/assistant-job-*
git commit -m "feat: persist assistant audit jobs"
```

### Task 3: Build the website-audit record source and safe URL checker

**Files:**
- Create: `artifacts/api-server/src/features/assistant/website-audit-record-repository.ts`
- Create: `artifacts/api-server/src/features/assistant/website-audit-record-repository.test.ts`
- Create: `artifacts/api-server/src/features/assistant/website-audit-http.ts`
- Create: `artifacts/api-server/src/features/assistant/website-audit-http.test.ts`
- Reuse: `artifacts/api-server/src/features/event-profiles/event-profile-repository.ts`

**Interfaces:**

```ts
export type WebsiteAuditRecord = {
  recordId: string;
  label: string;
  website: string;
  city: string | null;
  region: string | null;
  phone: string | null;
  primaryEmailDomain: string | null;
};

export interface WebsiteAuditRecordRepository {
  countApplicable(): Promise<number>;
  listBatch(input: { afterId: string | null; limit: number }): Promise<WebsiteAuditRecord[]>;
  readCurrentWebsite(recordId: string): Promise<string | null>;
}

export type WebsiteFetchResult = {
  requestedUrl: string;
  finalUrl: string | null;
  statusCode: number | null;
  reachable: boolean;
  redirected: boolean;
  title: string | null;
  textSample: string;
  failure: "timeout" | "dns" | "unsafe_url" | "http_error" | null;
};

export interface WebsiteAuditHttpClient {
  inspect(url: string): Promise<WebsiteFetchResult>;
}
```

- [ ] **Step 1: Write failing record-source tests**

Cover:
- only live/non-consolidated `organizations` with non-empty `organizations.website`,
- stable ID pagination,
- label/city/region/phone mapping,
- primary contact email-domain extraction,
- `readCurrentWebsite` returns the current value for stale-write checks.

- [ ] **Step 2: Write failing HTTP safety tests**

Use injected DNS/fetch fakes and prove rejection of:

```text
http://127.0.0.1
http://localhost
http://169.254.169.254
http://10.0.0.1
http://172.16.0.1
http://192.168.1.1
file:///etc/passwd
```

Also prove:
- `https://example.org` is permitted,
- redirects are capped at 5,
- each redirect target is revalidated,
- request timeout is 8 seconds or less,
- only a bounded text sample is retained,
- non-HTML/oversized bodies do not become full persisted content.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
pnpm exec vitest run \
  artifacts/api-server/src/features/assistant/website-audit-record-repository.test.ts \
  artifacts/api-server/src/features/assistant/website-audit-http.test.ts
```

- [ ] **Step 4: Implement stable database batching**

Use `organizations.website` (the same field returned by `DrizzleEventProfileRepository`) and `organizations.consolidatedIntoId is null`. Batch size constant:

```ts
export const WEBSITE_AUDIT_BATCH_SIZE = 25;
```

Do not load all profiles into memory.

- [ ] **Step 5: Implement safe HTTP inspection**

Normalize a bare domain to `https://` only when `new URL` can safely parse the result. Resolve DNS before every request/redirect and reject loopback, link-local, private IPv4, private/ULA IPv6, and non-HTTP(S) protocols. Use an `AbortController` timeout and retain only title plus a normalized bounded text sample (max 12,000 characters).

- [ ] **Step 6: Run tests and commit**

```bash
pnpm exec vitest run \
  artifacts/api-server/src/features/assistant/website-audit-record-repository.test.ts \
  artifacts/api-server/src/features/assistant/website-audit-http.test.ts
git add artifacts/api-server/src/features/assistant/website-audit-*
git commit -m "feat: safely inspect profile websites"
```

### Task 4: Classify website/profile matches and create only conservative proposals

**Files:**
- Create: `artifacts/api-server/src/features/assistant/website-audit-matcher.ts`
- Create: `artifacts/api-server/src/features/assistant/website-audit-matcher.test.ts`
- Create: `artifacts/api-server/src/features/assistant/website-audit-replacement-provider.ts`
- Create: `artifacts/api-server/src/features/assistant/website-audit-replacement-provider.test.ts`

**Interfaces:**

```ts
export type WebsiteMatchAssessment = {
  status: WebsiteAuditStatus;
  confidence: "high" | "medium" | "low";
  reasons: string[];
};

export function assessWebsiteMatch(input: {
  record: WebsiteAuditRecord;
  fetched: WebsiteFetchResult;
}): WebsiteMatchAssessment;

export interface WebsiteReplacementProvider {
  findOfficialReplacement(input: WebsiteAuditRecord): Promise<{
    url: string;
    confidence: "high" | "medium" | "low";
    reasons: string[];
    sourceRefs: string[];
  } | null>;
}
```

- [ ] **Step 1: Write matcher tests before implementation**

Cover:
- matching normalized organization/event name + city -> `verified_match/high`,
- permanent redirect to same identity -> `redirected/high`,
- parent-organization domain with matching event name/location -> valid match, not mismatch,
- live page with unrelated name/location -> `likely_mismatch`,
- reachable page with weak evidence -> `reachable_uncertain`,
- timeout/dead site -> `broken`,
- missing current-year dates alone never causes mismatch.

- [ ] **Step 2: Write replacement-provider contract tests**

The provider must return high confidence only when official evidence strongly matches name plus at least one identity signal (city/region, organizer/contact domain, or explicit event identity). Weak search results return medium/low and therefore cannot become bulk-applicable proposals.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm exec vitest run \
  artifacts/api-server/src/features/assistant/website-audit-matcher.test.ts \
  artifacts/api-server/src/features/assistant/website-audit-replacement-provider.test.ts
```

- [ ] **Step 4: Implement deterministic matching first**

Use token normalization, hostname/email-domain comparison, city/region matching, title/text sample, and redirect hostname. Keep thresholds explicit constants in the matcher; do not ask a language model for a naked boolean.

- [ ] **Step 5: Implement replacement discovery behind an interface**

Reuse the same configured public research/search provider family already used by Lead Scout/profile research. Search query format should be bounded, e.g.:

```ts
`${record.label} ${record.city ?? ""} ${record.region ?? ""} official website`
```

Validate every returned URL with the same safe URL rules before accepting it. Store source URL/title references only, not full search pages.

- [ ] **Step 6: Run tests and commit**

```bash
pnpm exec vitest run \
  artifacts/api-server/src/features/assistant/website-audit-matcher.test.ts \
  artifacts/api-server/src/features/assistant/website-audit-replacement-provider.test.ts
git add artifacts/api-server/src/features/assistant/website-audit-matcher* artifacts/api-server/src/features/assistant/website-audit-replacement-provider*
git commit -m "feat: classify website audit findings"
```

### Task 5: Add the durable website-audit service, worker, routes, stop/resume, and progress

**Files:**
- Create: `artifacts/api-server/src/features/assistant/website-audit-service.ts`
- Create: `artifacts/api-server/src/features/assistant/website-audit-service.test.ts`
- Create: `artifacts/api-server/src/features/assistant/assistant-job-worker.ts`
- Create: `artifacts/api-server/src/features/assistant/assistant-job-worker.test.ts`
- Create: `artifacts/api-server/src/features/assistant/assistant-job-worker-loop.ts`
- Create: `artifacts/api-server/src/features/assistant/assistant-job-worker-loop.test.ts`
- Modify: `artifacts/api-server/src/routes/assistant.ts`
- Modify: `artifacts/api-server/src/index.ts`

**Interfaces:**

```ts
export class WebsiteAuditService {
  create(input: { actorId: string; instruction: string }): Promise<AssistantJobView>;
  get(input: { actorId: string; jobId: string }): Promise<AssistantJobView | null>;
  getLatest(actorId: string): Promise<AssistantJobView | null>;
  requestStop(input: { actorId: string; jobId: string }): Promise<AssistantJobView>;
  continue(input: { actorId: string; jobId: string }): Promise<AssistantJobView>;
}

export class AssistantJobWorker {
  runOne(input: { workerId: string; now: Date }): Promise<{ kind: "idle" | "worked" }>;
}
```

Routes:

```text
GET  /assistant/jobs/latest
GET  /assistant/jobs/:jobId
POST /assistant/jobs/:jobId/stop
POST /assistant/jobs/:jobId/continue
```

- [ ] **Step 1: Write service tests for immediate read-only start**

Calling `create` must create a `queued` website audit without any confirmation token and return copy equivalent to:

```text
Website audit started. Checking every applicable profile with a saved website. Nothing will be changed without your approval.
```

- [ ] **Step 2: Write worker tests**

Prove one claimed job:
1. sets `running`,
2. counts applicable records,
3. processes at most 25 records in one batch/work unit,
4. persists findings as each batch completes,
5. creates proposals only for high-confidence `suggestedUrl` replacements/verified canonical redirects,
6. updates summary counters,
7. checks cancellation before each network call/batch,
8. marks complete when no records remain,
9. converts one-site failures into findings instead of failing the whole job.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
pnpm exec vitest run \
  artifacts/api-server/src/features/assistant/website-audit-service.test.ts \
  artifacts/api-server/src/features/assistant/assistant-job-worker.test.ts \
  artifacts/api-server/src/features/assistant/assistant-job-worker-loop.test.ts
```

- [ ] **Step 4: Implement resumable cursor/progress**

Store the last processed organization ID in the job's bounded `normalized_command` or progress JSON, e.g.:

```ts
{ cursorAfterId: string | null }
```

A resumed job starts after the persisted cursor and must not duplicate findings because `(job_id, record_id)` is unique/upserted.

- [ ] **Step 5: Wire General Assistant command execution**

In `/assistant/general/ask`:

```ts
const command = routeAssistantCommand(parsed.data.question);
if (command?.capability === "website_verification") {
  const actorId = String((req as any).userId ?? "");
  const job = await websiteAudit.create({
    actorId,
    instruction: parsed.data.question,
  });
  res.json({
    kind: "assistant_job",
    text: "Website audit started. Nothing will be changed without your approval.",
    job,
  });
  return;
}
```

Then preserve current Lead Scout/profile-search behavior for all other requests.

- [ ] **Step 6: Start/close the new worker loop with existing background workers**

Mirror `LeadScoutWorkerLoop` scheduling semantics. In `index.ts`, instantiate `assistantJobLoop`, start it in `startBackgroundWorkers()`, and include `assistantJobLoop.close()` in shutdown `Promise.all`.

- [ ] **Step 7: Run tests and commit**

```bash
pnpm exec vitest run \
  artifacts/api-server/src/features/assistant/website-audit-service.test.ts \
  artifacts/api-server/src/features/assistant/assistant-job-worker.test.ts \
  artifacts/api-server/src/features/assistant/assistant-job-worker-loop.test.ts
git add artifacts/api-server/src/features/assistant/website-audit-service* artifacts/api-server/src/features/assistant/assistant-job-worker* artifacts/api-server/src/routes/assistant.ts artifacts/api-server/src/index.ts
git commit -m "feat: run durable website audits"
```

### Task 6: Apply only explicitly approved high-confidence website proposals

**Files:**
- Create: `artifacts/api-server/src/features/assistant/assistant-change-approval-service.ts`
- Create: `artifacts/api-server/src/features/assistant/assistant-change-approval-service.test.ts`
- Modify: `artifacts/api-server/src/routes/assistant.ts`

**Interfaces:**

```ts
export type ApplyProposalBatchResult = {
  requested: number;
  applied: number;
  stale: number;
  failed: number;
  proposalIds: string[];
};

export class AssistantChangeApprovalService {
  applyHighConfidenceWebsiteBatch(input: {
    actorId: string;
    jobId: string;
    proposalIds: string[];
  }): Promise<ApplyProposalBatchResult>;
}
```

Route:

```text
POST /assistant/jobs/:jobId/apply-proposals
body: { proposalIds: string[] }
```

- [ ] **Step 1: Write failing approval tests**

Prove:
- no route call => no organization writes,
- empty/unknown proposal IDs rejected,
- proposal must belong to actor's job,
- only `proposed` + `high` + `field='website'` can apply,
- request cannot smuggle a different URL/value; only persisted proposal values are used,
- exact submitted proposal IDs form the immutable batch,
- stale `organizations.website !== old_value` is skipped/failed without overwriting,
- successful apply updates `organizations.website`, proposal status, actor/time, and audit log,
- medium/low confidence is never bulk-applied,
- retry is idempotent and does not apply twice.

- [ ] **Step 2: Run test and verify RED**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/assistant-change-approval-service.test.ts
```

- [ ] **Step 3: Implement transaction/locking**

For every proposal ID, lock the proposal and target organization in deterministic ID order. Compare current website with `oldValue` before update. Apply only the persisted `newValue`.

Use `recordAuditEntry` with an action such as `assistant_website_fix_applied` and include `jobId`/`proposalId` in bounded metadata.

- [ ] **Step 4: Add strict route validation**

```ts
const applyProposalsSchema = z.object({
  proposalIds: z.array(z.uuid()).min(1).max(250),
}).strict();
```

The route never accepts `newValue`, `field`, SQL filters, or record IDs separately.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/assistant-change-approval-service.test.ts
git add artifacts/api-server/src/features/assistant/assistant-change-approval-service* artifacts/api-server/src/routes/assistant.ts
git commit -m "feat: approve assistant website fixes"
```

### Task 7: Add frontend job API, progress/results UI, review, and bulk approval

**Files:**
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-types.ts`
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-api.ts`
- Create: `artifacts/adventure-zone/src/features/assistant/assistant-job-api.ts`
- Create: `artifacts/adventure-zone/src/components/assistant/website-audit-results.tsx`
- Create: `artifacts/adventure-zone/src/components/assistant/website-audit-results.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.tsx`
- Test: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx` (create if still absent)

**Interfaces:**

```ts
export async function getLatestAssistantJob(): Promise<AssistantJobView | null>;
export async function getAssistantJob(jobId: string): Promise<AssistantJobView>;
export async function stopAssistantJob(jobId: string): Promise<AssistantJobView>;
export async function continueAssistantJob(jobId: string): Promise<AssistantJobView>;
export async function applyAssistantJobProposals(
  jobId: string,
  proposalIds: string[],
): Promise<ApplyProposalBatchResult>;
```

- [ ] **Step 1: Write failing result-component tests**

For a running job render:

```text
Website audit
Checking profile websites 418 / 1,214
Verified 332
Broken 27
Possible mismatch 11
Needs review 48
```

For a completed job render summary categories plus only bounded/paginated finding rows.

For proposals, render:

```text
29 high-confidence website fixes are ready.
Review fixes
Apply 29 verified fixes
```

Do not include medium/low proposal IDs in the bulk apply callback.

- [ ] **Step 2: Run component test and verify RED**

```bash
pnpm exec vitest run artifacts/adventure-zone/src/components/assistant/website-audit-results.test.tsx
```

- [ ] **Step 3: Implement frontend types/API**

Extend `GeneralAssistantResponse` with `assistant_job`. Keep Lead Scout and profile search response variants untouched.

- [ ] **Step 4: Integrate job state into General Command Center drawer**

Add `assistantJob` state alongside (not instead of) the existing `leadScoutRun`. On General-mode drawer open, load the latest assistant job as well as current Lead Scout state. When `askGeneralAssistant` returns `assistant_job`, show it immediately.

Poll jobs whose status is `queued | running | stopping` every 1500ms using the same reconnect behavior as Lead Scout. Closing the drawer only stops polling; it does not stop the server job.

- [ ] **Step 5: Add Stop/Continue and exact bulk approval handlers**

`Apply N verified fixes` must derive IDs from the currently loaded job's high-confidence `proposed` website proposals and submit exactly that array. Disable the button while applying and refresh the job after completion.

Do not implement auto-apply on audit completion.

- [ ] **Step 6: Keep ambiguous findings review-only**

Rows for broken/mismatch/needs-review can show `Open profile` and source/suggested URL information, but no group action that silently applies medium/low-confidence changes.

- [ ] **Step 7: Run drawer/component tests and commit**

```bash
pnpm exec vitest run \
  artifacts/adventure-zone/src/components/assistant/website-audit-results.test.tsx \
  artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx
git add artifacts/adventure-zone/src/features/assistant/assistant-types.ts artifacts/adventure-zone/src/features/assistant/assistant-api.ts artifacts/adventure-zone/src/features/assistant/assistant-job-api.ts artifacts/adventure-zone/src/components/assistant/website-audit-results* artifacts/adventure-zone/src/components/assistant/assistant-drawer*
git commit -m "feat: show assistant website audits"
```

### Task 8: Add end-to-end safety/regression coverage and CI wiring

**Files:**
- Create: `artifacts/api-server/src/features/assistant/assistant-command-audit.integration.test.ts`
- Modify: `.github/workflows/assistant-general-mode-ci.yml`
- Modify only if required by current test discovery: workspace/package test configuration files already used by Assistant CI.

**Interfaces:**
- Consumes all Phase 1 contracts from Tasks 1–7.
- Produces no new product API.

- [ ] **Step 1: Add full command-flow integration test**

Test this exact sequence with fake HTTP/search dependencies:

1. POST General Ask with the user's website-audit wording.
2. Assert response `kind === 'assistant_job'` and no organization website changed.
3. Run worker until complete.
4. Assert verified/broken/mismatch counts and high-confidence proposals.
5. GET job and capture the exact high-confidence proposal IDs.
6. POST apply route with those IDs.
7. Assert only those records changed and audit entries were written.
8. Assert a medium-confidence suggestion remained unchanged.

- [ ] **Step 2: Add routing regression tests**

Verify existing behaviors still work:

```text
Find Morton County Fair -> profile_results
Find an event between Montana and Utah in September 2026 -> lead_discovery
Who needs follow-up? -> existing deterministic profile/workflow result
Website audit wording -> assistant_job
```

- [ ] **Step 3: Add security regression tests**

Prove:
- unauthenticated/admin-disallowed requests cannot create/read/apply jobs,
- manager routes cannot access assistant jobs,
- unsafe URL targets are never fetched,
- arbitrary command capability names are rejected/not routable,
- apply endpoint does not accept replacement values from the client,
- stale values are never overwritten.

- [ ] **Step 4: Run the complete focused assistant suite**

```bash
pnpm exec vitest run \
  artifacts/api-server/src/features/assistant/assistant-command-router.test.ts \
  artifacts/api-server/src/features/assistant/assistant-job-repository.test.ts \
  artifacts/api-server/src/features/assistant/website-audit-record-repository.test.ts \
  artifacts/api-server/src/features/assistant/website-audit-http.test.ts \
  artifacts/api-server/src/features/assistant/website-audit-matcher.test.ts \
  artifacts/api-server/src/features/assistant/website-audit-replacement-provider.test.ts \
  artifacts/api-server/src/features/assistant/website-audit-service.test.ts \
  artifacts/api-server/src/features/assistant/assistant-job-worker.test.ts \
  artifacts/api-server/src/features/assistant/assistant-job-worker-loop.test.ts \
  artifacts/api-server/src/features/assistant/assistant-change-approval-service.test.ts \
  artifacts/api-server/src/features/assistant/assistant-command-audit.integration.test.ts \
  artifacts/adventure-zone/src/components/assistant/website-audit-results.test.tsx \
  artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run typecheck/build commands already enforced by Assistant CI**

Run the same `pnpm` install/typecheck/build commands present in `.github/workflows/assistant-general-mode-ci.yml`; do not invent a parallel CI workflow if the current one can cover these files.

- [ ] **Step 6: Update CI file filters/test command if needed and commit**

```bash
git add artifacts/api-server/src/features/assistant/assistant-command-audit.integration.test.ts .github/workflows/assistant-general-mode-ci.yml
git commit -m "test: cover assistant website audit workflow"
```

## Final Verification

- [ ] Run `git status --short` and confirm only intended files remain modified.
- [ ] Run the complete focused suite from Task 8 again after all rebases/fixes.
- [ ] Confirm a read-only audit can complete without any CRM website mutation.
- [ ] Confirm the drawer can be closed/reopened while the job continues and restores progress.
- [ ] Confirm `Apply N verified fixes` changes only the exact high-confidence proposal IDs shown to the user.
- [ ] Confirm a stale website value is skipped rather than overwritten.
- [ ] Confirm existing profile search and Lead Scout requests still route correctly.
- [ ] Confirm no manager-facing route exposes the new admin audit jobs.
