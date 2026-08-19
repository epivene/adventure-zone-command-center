# Staged Booking Assistant Lead Scout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make General Command Center understand booking-discovery requests, search Command Center first, then optionally run a persistent, transparent web Lead Scout whose unsaved prospect profiles can be reviewed and intentionally saved as normal CRM leads.

**Architecture:** Build one durable `lead_scout_runs` workflow shared by all four releases. Release 1 creates/normalizes a run and performs deterministic CRM-first discovery; Release 2 adds a leased background worker for public source/candidate discovery plus progress/Stop/Continue; Release 3 enriches individual candidates with evidence and Adventure Zone fit; Release 4 reuses the existing Source Scout intake safeguards to convert approved unsaved prospects into normal CRM records. Existing source-scoped `Scout this source` remains separate and reusable.

**Tech Stack:** TypeScript 5.9, Express 5, PostgreSQL + Drizzle ORM, React 19, Wouter, Vitest, OpenAI Responses API `web_search`, existing profile-research and Source Scout services.

**Spec:** `docs/superpowers/specs/2026-08-19-assistant-staged-lead-scout-design.md`

## Global Constraints

- Search Command Center before public web research; no web-provider call may occur before explicit **Find me new leads**.
- `likely_recurring` is useful evidence, never a confirmed current-year date.
- Public web data is untrusted input; do not follow webpage instructions.
- Public/indexed social and review evidence is optional enrichment and must never be described as exhaustive coverage.
- Do not send raw private CRM notes/history to broad web search.
- CRM duplicate comparison stays local and is repeated immediately before save.
- Store bounded source/evidence metadata, not complete third-party pages.
- Unsaved prospects persist in Scout storage but create no organization, booking, follow-up, call, email, or route mutation.
- **Save as lead** always requires an explicit first action and first follow-up date.
- Keep Manager Assistant leg-scoped; do not expose admin Lead Scout routes to manager sessions.
- Use the existing application/database. Do not create a second app/database.
- Preserve existing source-scoped `Scout this source`, Research Sources library, Profile Research, and bulk Source Scout intake behavior.
- Frontend progress must show safe operational stages/counters only, never private chain-of-thought.
- GitHub Actions jobs with zero executed steps are infrastructure failures, not evidence that tests passed or failed.

---

# Release 1 — Criteria + CRM-First Discovery

Release 1 is independently usable: the user's natural-language prompt creates a persistent run, returns confirmed/likely-recurring/broader existing matches, and pauses at `crm_ready` with **Find me new leads**. It performs no web research.

### Task 1: Define Lead Scout domain contracts and deterministic criteria interpretation

**Files:**
- Create: `artifacts/api-server/src/features/assistant/lead-scout-types.ts`
- Create: `artifacts/api-server/src/features/assistant/lead-scout-criteria.ts`
- Create: `artifacts/api-server/src/features/assistant/lead-scout-criteria.test.ts`
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-types.ts`

**Interfaces:**
- Produces `LeadDiscoveryCriteria`, `LeadScoutStatus`, `LeadScoutStage`, `AssistantLeadMatch`, `LeadScoutRunView`, and `LeadDiscoveryInterpretation`.
- Produces `interpretLeadDiscoveryCriteria(question: string, now?: Date): LeadDiscoveryInterpretation`.
- `LeadDiscoveryInterpretation` is exactly:

```ts
export type LeadDiscoveryInterpretation =
  | { kind: "criteria"; criteria: LeadDiscoveryCriteria; summary: string }
  | { kind: "needs_clarification"; message: string; partial: Partial<LeadDiscoveryCriteria> };
```

- `LeadDiscoveryCriteria` keeps the spec fields and uses `regions: string[]` for normalized two-letter state codes.
- `LeadScoutRunView` exposes `id`, `originalQuestion`, `criteria`, `criteriaSummary`, `status`, `stage`, `progress`, `crmMatches`, `candidates`, `sources`, timestamps, and `failureMessage`.

- [ ] **Step 1: Write failing criteria tests**

```ts
it("parses the approved Montana-to-Utah September example", () => {
  const result = interpretLeadDiscoveryCriteria(
    "I need to find an event between Montana and Utah in September 2026",
    new Date("2026-08-19T12:00:00Z"),
  );
  expect(result.kind).toBe("criteria");
  if (result.kind !== "criteria") return;
  expect(result.criteria.year).toBe(2026);
  expect(result.criteria.month).toBe(9);
  expect(result.criteria.dateFrom).toBe("2026-09-01");
  expect(result.criteria.dateThrough).toBe("2026-09-30");
  expect(result.criteria.geoMode).toBe("corridor");
  expect(result.criteria.regions).toEqual(expect.arrayContaining(["MT", "ID", "WY", "UT"]));
  expect(result.criteria.fitIntent).toBe("either");
});

it("does not invent a year when the requested date is ambiguous", () => {
  const result = interpretLeadDiscoveryCriteria("find an event between Montana and Utah sometime this fall");
  expect(result.kind).toBe("needs_clarification");
});
```

Also cover explicit date ranges, one state/month/year, `near Leg 4`, `vendor` wording, event keywords, and unsupported/unbounded prompts.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-criteria.test.ts
```

Expected: FAIL because the new contracts/interpreter do not exist.

- [ ] **Step 3: Implement bounded deterministic interpretation**

Implement named month parsing, explicit `YYYY`, `between <state> and <state>`, `in <state>`, explicit `between <date> and <date>`, `Leg <n>`, vendor/booking intent, and event-keyword extraction. Add a small explicit corridor bridge map; for `MT` ↔ `UT`, expand to `MT, ID, WY, UT`. Never derive arbitrary SQL/filter expressions from text.

- [ ] **Step 4: Mirror read-only response types in frontend assistant types**

Add the same serialized run/match/criteria shapes to `assistant-types.ts`; do not import server-only DB types into the browser bundle.

- [ ] **Step 5: Run tests + typechecks**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-criteria.test.ts
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/assistant/lead-scout-* artifacts/adventure-zone/src/features/assistant/assistant-types.ts
git commit -m "feat: interpret lead discovery criteria"
```

### Task 2: Add durable Lead Scout schema and repository

**Files:**
- Create: `lib/db/migrations/063_lead_scout_runs.sql`
- Modify: `artifacts/api-server/src/db/profile-research-startup-migration.ts`
- Modify: `artifacts/api-server/src/db/act-review-startup.ts`
- Create: `artifacts/api-server/src/features/assistant/lead-scout-repository.ts`
- Create: `artifacts/api-server/src/features/assistant/lead-scout-repository.test.ts`
- Modify/Test: `artifacts/api-server/src/db/act-review-startup.test.ts`

**Interfaces:**

```ts
export interface LeadScoutRepository {
  createRun(input: { actorId: string; question: string; criteria: LeadDiscoveryCriteria | null; criteriaSummary: string | null }): Promise<string>;
  getRun(input: { actorId: string; runId: string }): Promise<LeadScoutRunView | null>;
  getLatestRun(actorId: string): Promise<LeadScoutRunView | null>;
  setCriteria(runId: string, input: { criteria: LeadDiscoveryCriteria; criteriaSummary: string }): Promise<void>;
  setCrmReady(runId: string, matches: AssistantLeadMatch[]): Promise<void>;
  setFailed(runId: string, message: string): Promise<void>;
}
```

Schema uses four tables from the spec now so later releases do not need a persistence redesign:

```sql
lead_scout_runs
lead_scout_sources
lead_scout_candidates
lead_scout_candidate_facts
```

`lead_scout_runs` must also include `worker_id`, `lease_expires_at`, `attempt_count`, and `web_started_at` for Release 2 durable worker claims. Store CRM matches in bounded `crm_matches jsonb` in Release 1. Use FK cascade from sources/candidates/facts to run/candidate.

- [ ] **Step 1: Write repository persistence tests**

Use PGlite/test DB conventions already present in API tests. Prove create → `interpreting`, actor ownership on `getRun`, `setCriteria`, `setCrmReady`, latest-run ordering, and no candidate/CRM mutation when only creating a run.

- [ ] **Step 2: Run repository/startup tests and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-repository.test.ts src/db/act-review-startup.test.ts
```

Expected: FAIL because migration/repository are absent.

- [ ] **Step 3: Add migration 063**

Use explicit check constraints for:
- run status: `interpreting | crm_search | crm_ready | running | stopping | stopped | complete | failed`
- source category: `official_event | government | tourism_chamber | vendor_application | venue_partner | news_recap | social | review_forum | other`
- CRM match: `already_in_command_center | possible_match | new_prospect`
- candidate review status: `unreviewed | shortlisted | dismissed | saved`
- fact confidence: `high | medium | low`.

Add indexes on `(actor_id, created_at desc)`, `(status, lease_expires_at)`, `(run_id, fit_score desc)`, and candidate/source FK lookup fields.

- [ ] **Step 4: Extend startup recovery**

Append equivalent `create table if not exists` DDL to `profile-research-startup-migration.ts`, update its `to_regclass` readiness marker to include all Lead Scout tables, and make `act-review-startup.ts` report `063_lead_scout_runs.sql` when startup recovery creates it.

- [ ] **Step 5: Implement repository mapping**

Keep DB serialization in one file. Normalize `jsonb` into typed `LeadScoutRunView` arrays before routes/services see it.

- [ ] **Step 6: Run focused tests + typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-repository.test.ts src/db/act-review-startup.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/db/migrations/063_lead_scout_runs.sql artifacts/api-server/src/db artifacts/api-server/src/features/assistant/lead-scout-repository*
git commit -m "feat: persist lead scout runs"
```

### Task 3: Build structured CRM discovery and recurring-event ranking

**Files:**
- Create: `artifacts/api-server/src/features/assistant/lead-scout-crm-search.ts`
- Create: `artifacts/api-server/src/features/assistant/lead-scout-crm-search.test.ts`
- Read/reuse: `artifacts/api-server/src/features/assistant/profile-search-repository.ts`
- Read/reuse: `artifacts/api-server/src/features/profile-research/profile-research-related-event-matcher.ts`

**Interfaces:**

```ts
export interface LeadScoutCrmSearch {
  search(criteria: LeadDiscoveryCriteria, limit?: number): Promise<AssistantLeadMatch[]>;
}

export class PostgresLeadScoutCrmSearch implements LeadScoutCrmSearch {
  constructor(pool?: Pool);
  search(criteria: LeadDiscoveryCriteria, limit?: number): Promise<AssistantLeadMatch[]>;
}
```

`dateConfidence` rules:
- `confirmed`: requested-year booking overlaps requested date window.
- `likely_recurring`: no requested-year match, but same canonical organization/event has at least one prior-year occurrence in the requested month/window; two prior seasonal occurrences rank above one.
- `unknown`: geographic/relationship/event-family fit without usable date evidence.

- [ ] **Step 1: Write failing CRM ranking tests**

Seed organizations/bookings proving:
- a September 2026 MT booking is confirmed;
- an event in September 2024 + September 2025 with no 2026 booking is `likely_recurring` and explicitly unconfirmed;
- an October-only event is not falsely recurring for September;
- corridor candidates can match MT/ID/WY/UT;
- consolidated organizations are excluded;
- result count is bounded and confirmed results outrank recurring/broader matches.

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-crm-search.test.ts
```

Expected: FAIL because CRM discovery does not exist.

- [ ] **Step 3: Implement one bounded SQL/repository query**

Query canonical organizations plus bookings/locations/event-family/package/contact summaries only for the normalized regions/cities/date window. Do not pass raw model-generated conditions. Compute reasons and score in TypeScript after bounded SQL rows are loaded.

- [ ] **Step 4: Run focused tests + typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-crm-search.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/assistant/lead-scout-crm-search*
git commit -m "feat: rank CRM lead discovery matches"
```

### Task 4: Add CRM-first Lead Scout routes and General Assistant intent handoff

**Files:**
- Create: `artifacts/api-server/src/features/assistant/lead-scout-service.ts`
- Create: `artifacts/api-server/src/features/assistant/lead-scout-service.test.ts`
- Create: `artifacts/api-server/src/routes/assistant-lead-scout.ts`
- Create: `artifacts/api-server/src/routes/assistant-lead-scout.test.ts`
- Modify: `artifacts/api-server/src/routes/assistant.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/api-server/src/features/assistant/general-assistant.ts`
- Test: `artifacts/api-server/src/features/assistant/general-assistant.test.ts`

**Interfaces:**

```ts
export class LeadScoutService {
  createCrmDiscovery(input: { actorId: string; question: string }): Promise<LeadScoutRunView | { kind: "needs_clarification"; runId: string; message: string }>;
  getRun(input: { actorId: string; runId: string }): Promise<LeadScoutRunView>;
}
```

Routes in Release 1:

```text
POST /assistant/lead-scout/runs       { question }
GET  /assistant/lead-scout/runs/:id
GET  /assistant/lead-scout/runs/latest
```

Extend `GeneralAssistantResponse` with:

```ts
| { kind: "lead_discovery"; text: string; run: LeadScoutRunView }
| { kind: "lead_discovery_clarification"; text: string; runId: string }
```

- [ ] **Step 1: Write service/route failing tests**

Prove persistence happens before CRM results, actor ownership returns 404 for another user, example prompt returns `crm_ready`, and a fake web provider is never instantiated/called in Release 1.

- [ ] **Step 2: Write General Assistant intent tests**

The exact screenshot prompt must route to Lead Scout:

```ts
expect(isLeadDiscoveryQuestion("I need to find an event for, between Montana and Utah in September 2026")).toBe(true);
```

Simple legacy queries such as `Find Water Lantern Festival` must keep the existing profile search behavior.

- [ ] **Step 3: Run tests and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-service.test.ts src/routes/assistant-lead-scout.test.ts src/features/assistant/general-assistant.test.ts
```

- [ ] **Step 4: Implement service and routes**

`createCrmDiscovery` creates the run first, interprets criteria, writes criteria, transitions to `crm_search`, executes `LeadScoutCrmSearch`, writes matches, then returns `crm_ready`. Ambiguity leaves the persisted run in `interpreting` and returns clarification copy; no web call is possible.

- [ ] **Step 5: Wire General Assistant handoff**

Detect discovery intent before legacy general profile search. Pass `(req as any).userId` into the Lead Scout service. Keep `/assistant/profile-search` and ordinary `answerGeneralAssistant` behavior unchanged for non-discovery prompts.

- [ ] **Step 6: Run tests + typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-service.test.ts src/routes/assistant-lead-scout.test.ts src/features/assistant/general-assistant.test.ts
pnpm --filter @workspace/api-server typecheck
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/assistant artifacts/api-server/src/routes
git commit -m "feat: route general discovery through CRM first"
```

### Task 5: Render CRM discovery cards and Find me new leads CTA

**Files:**
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-api.ts`
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-types.ts`
- Create: `artifacts/adventure-zone/src/components/assistant/lead-discovery-results.tsx`
- Create: `artifacts/adventure-zone/src/components/assistant/lead-discovery-results.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.tsx`
- Modify/Test: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx`

**Interfaces:**

```ts
export async function createLeadScoutRun(question: string): Promise<LeadScoutRunView | LeadScoutClarificationResponse>;
export async function getLeadScoutRun(runId: string): Promise<LeadScoutRunView>;
```

`LeadDiscoveryResults` props:

```ts
{
  run: LeadScoutRunView;
  onOpenProfile(match: AssistantLeadMatch): void;
  onUseContext(match: AssistantLeadMatch): void;
  onFindNewLeads(): void;
}
```

- [ ] **Step 1: Write failing component tests**

Verify criteria summary, separate `Confirmed matches`, `Likely recurring`, and `Other useful matches` groups, explicit `Date not confirmed for 2026` wording on recurring results, match reasons, and a `Find me new leads` button even when CRM matches are non-empty.

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/assistant/lead-discovery-results.test.tsx src/components/assistant/assistant-drawer.test.tsx
```

- [ ] **Step 3: Implement API/type support and card component**

Keep existing `ProfileSearchResults` for simple profile search; only `lead_discovery` responses render the new component.

- [ ] **Step 4: Wire AssistantDrawer state**

Store the active Lead Scout run separately from `generalResponse`. Submitting a qualifying question replaces any prior run UI. `Open profile` and `Use as context` retain current context behavior.

In Release 1, **Find me new leads** is rendered but calls a stub handler that displays `Web Lead Scout is not enabled in this release` only in tests/development; before merging Release 1, Task 6 replaces it with the Release 2 API if Releases 1+2 ship together. If Releases are merged separately, hide/disable the CTA behind `leadScoutWebEnabled` until Release 2 is deployed. Do not ship a clickable dead action.

- [ ] **Step 5: Run UI tests + typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/assistant/lead-discovery-results.test.tsx src/components/assistant/assistant-drawer.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

- [ ] **Step 6: Release 1 verification**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-criteria.test.ts src/features/assistant/lead-scout-crm-search.test.ts src/features/assistant/lead-scout-service.test.ts src/routes/assistant-lead-scout.test.ts
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
pnpm build
```

Expected: all commands execute successfully. If GitHub Actions executes zero steps, record that separately; do not substitute it for these checks.

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/features/assistant artifacts/adventure-zone/src/components/assistant
git commit -m "feat: show CRM-first lead discovery"
```

---

# Release 2 — Persistent Staged Web Lead Scout

Release 2 makes **Find me new leads** real: a durable worker discovers public sources/candidates, persists partial results, compares candidates to the CRM locally, exposes progress, and supports Stop/Continue.

### Task 6: Extend repository with durable web-run claims, progress, sources, and candidates

**Files:**
- Modify: `artifacts/api-server/src/features/assistant/lead-scout-repository.ts`
- Modify/Test: `artifacts/api-server/src/features/assistant/lead-scout-repository.test.ts`

**Interfaces:**

```ts
startWeb(runId: string, actorId: string): Promise<boolean>;
requestStop(runId: string, actorId: string): Promise<boolean>;
continueWeb(runId: string, actorId: string): Promise<boolean>;
claimRunnable(input: { workerId: string; now: Date; leaseMs: number }): Promise<LeadScoutWorkClaim | null>;
renewLease(runId: string, workerId: string, now: Date, leaseMs: number): Promise<boolean>;
isCancellationRequested(runId: string): Promise<boolean>;
updateProgress(runId: string, patch: LeadScoutProgressPatch): Promise<void>;
upsertSources(runId: string, sources: LeadScoutSourceInput[]): Promise<void>;
upsertCandidates(runId: string, candidates: LeadScoutCandidateInput[]): Promise<void>;
setCandidateCrmMatch(runId: string, candidateId: string, match: RelatedEventCrmMatch): Promise<void>;
completeRun(runId: string): Promise<void>;
stopRun(runId: string): Promise<void>;
failRun(runId: string, message: string): Promise<void>;
```

- [ ] **Step 1: Write failing durable-state tests**

Cover `crm_ready -> running`, one worker claim only via lease, stale lease recovery, stop while idle, stop request during active run, continue from `stopped`, source/candidate idempotency, and completed candidates surviving run failure.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-repository.test.ts
```

- [ ] **Step 3: Implement atomic claim/update SQL**

Use `FOR UPDATE SKIP LOCKED` or one equivalent atomic update; never allow two workers to own one run simultaneously. Candidate stable key is normalized `name|city|region|startsAt|canonicalUrl` hashed or stored as a unique key under `run_id`.

- [ ] **Step 4: Run tests + typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-repository.test.ts
pnpm --filter @workspace/api-server typecheck
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/assistant/lead-scout-repository*
git commit -m "feat: add durable lead scout work state"
```

### Task 7: Add criteria-driven public source/candidate provider

**Files:**
- Create: `artifacts/api-server/src/features/assistant/lead-scout-provider.ts`
- Create: `artifacts/api-server/src/features/assistant/openai-lead-scout-provider.ts`
- Create: `artifacts/api-server/src/features/assistant/openai-lead-scout-provider.test.ts`
- Reuse: `artifacts/api-server/src/features/profile-research/profile-research-matching.ts`
- Reuse: `artifacts/api-server/src/features/profile-research/profile-research-discovery.ts`

**Interfaces:**

```ts
export interface LeadScoutProvider {
  discoverSources(criteria: LeadDiscoveryCriteria, signal?: AbortSignal): Promise<LeadScoutSourceInput[]>;
  discoverCandidates(input: { criteria: LeadDiscoveryCriteria; sources: LeadScoutSourceInput[]; signal?: AbortSignal }): Promise<LeadScoutCandidateInput[]>;
}
```

Release 2 candidate fields are identity/date/location/source/rationale only; Release 3 enriches the rest.

- [ ] **Step 1: Write failing provider-normalization tests**

Mock Responses API payloads. Reject uncited URLs, unsafe protocols, oversized source metadata, out-of-window dates, candidates outside requested regions/corridor, malformed JSON, and >40 candidate output. Prove prompts say webpages are untrusted data and include the normalized criteria rather than CRM notes.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/openai-lead-scout-provider.test.ts
```

- [ ] **Step 3: Implement two bounded Responses API calls**

`discoverSources` asks for official/community/vendor source discovery. `discoverCandidates` accepts only the bounded source list produced by stage one. Both use `{ type: "web_search", search_context_size: "high" }`, `store:false`, request IDs, cited URLs, and `PROFILE_RESEARCH_OPENAI_MODEL || "gpt-5-mini"` to follow existing research configuration.

- [ ] **Step 4: Run tests + typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/openai-lead-scout-provider.test.ts
pnpm --filter @workspace/api-server typecheck
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/assistant/*lead-scout-provider*
git commit -m "feat: discover public lead scout candidates"
```

### Task 8: Implement durable Lead Scout worker and cancellation

**Files:**
- Create: `artifacts/api-server/src/features/assistant/lead-scout-worker.ts`
- Create: `artifacts/api-server/src/features/assistant/lead-scout-worker.test.ts`
- Create: `artifacts/api-server/src/features/assistant/lead-scout-worker-loop.ts`
- Create: `artifacts/api-server/src/features/assistant/lead-scout-worker-loop.test.ts`
- Modify: `artifacts/api-server/src/index.ts`
- Reuse: `artifacts/api-server/src/features/act-replacement/worker-loop.ts` scheduling pattern
- Reuse: `artifacts/api-server/src/features/profile-research/profile-research-related-event-matcher.ts`

**Interfaces:**

```ts
export class LeadScoutWorker {
  runOne(input: { workerId: string; now: Date }): Promise<{ kind: "idle" | "progress" }>;
}

export class LeadScoutWorkerLoop {
  start(): void;
  close(): Promise<void>;
}
```

Release 2 stages: `source_discovery -> candidate_discovery -> crm_compare -> fit_rank -> complete`. `fit_rank` uses deterministic baseline signals until Release 3 adds deeper evidence.

- [ ] **Step 1: Write worker state-machine tests**

Use fake repository/provider. Prove one `runOne` makes one bounded unit of progress, candidates persist before later work, local `matchRelatedEventsAgainstCrm` classification is stored, stop prevents the next provider call, an AbortSignal is triggered when cancellation is observed, and provider failure leaves prior persisted candidates intact and marks the run resumable/failed per failure type.

- [ ] **Step 2: Write loop scheduler tests**

Mirror `ActExtractionWorkerLoop` fake scheduler tests: immediate first tick, 2s idle delay, zero-delay after progress, close cancels pending work and waits for active work.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-worker.test.ts src/features/assistant/lead-scout-worker-loop.test.ts
```

- [ ] **Step 4: Implement worker + loop**

Check cancellation before each provider call and after each call before starting another unit. Persist safe progress labels such as `Finding public event sources`, `Checking candidate events`, and `Comparing with Command Center`; never persist model reasoning.

- [ ] **Step 5: Start/close worker with server lifecycle**

Instantiate one process-local loop in `src/index.ts` after DB startup migrations. Use a random worker ID. Ensure shutdown awaits `close()` alongside existing server cleanup.

- [ ] **Step 6: Run tests + typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-worker.test.ts src/features/assistant/lead-scout-worker-loop.test.ts
pnpm --filter @workspace/api-server typecheck
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/assistant/lead-scout-worker* artifacts/api-server/src/index.ts
git commit -m "feat: run lead scout as durable worker"
```

### Task 9: Expose start/stop/continue/polling routes

**Files:**
- Modify: `artifacts/api-server/src/routes/assistant-lead-scout.ts`
- Modify/Test: `artifacts/api-server/src/routes/assistant-lead-scout.test.ts`
- Modify: `artifacts/api-server/src/features/assistant/lead-scout-service.ts`

**Routes:**

```text
POST /assistant/lead-scout/runs/:id/start
POST /assistant/lead-scout/runs/:id/stop
POST /assistant/lead-scout/runs/:id/continue
```

- [ ] **Step 1: Write failing route tests**

Assert `/start` only accepts the actor's `crm_ready` run; `/stop` changes `running -> stopping`; `/continue` only accepts `stopped`; all return the current durable run view; repeated start/stop requests are idempotent where safe.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server test -- src/routes/assistant-lead-scout.test.ts
```

- [ ] **Step 3: Implement service/route methods**

No route directly calls OpenAI. Routes only mutate durable run state; the worker performs web calls.

- [ ] **Step 4: Run test + typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/routes/assistant-lead-scout.test.ts
pnpm --filter @workspace/api-server typecheck
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/assistant-lead-scout* artifacts/api-server/src/features/assistant/lead-scout-service.ts
git commit -m "feat: control lead scout runs"
```

### Task 10: Add progress, partial prospect cards, Stop, Continue, and restore-latest UI

**Files:**
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-api.ts`
- Create: `artifacts/adventure-zone/src/components/assistant/lead-scout-progress.tsx`
- Create: `artifacts/adventure-zone/src/components/assistant/lead-scout-progress.test.tsx`
- Create: `artifacts/adventure-zone/src/components/assistant/lead-scout-candidate-card.tsx`
- Create: `artifacts/adventure-zone/src/components/assistant/lead-scout-candidate-card.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/assistant/lead-discovery-results.tsx`
- Modify: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.tsx`
- Modify/Test: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx`

**Frontend API:**

```ts
startLeadScout(runId: string): Promise<LeadScoutRunView>;
stopLeadScout(runId: string): Promise<LeadScoutRunView>;
continueLeadScout(runId: string): Promise<LeadScoutRunView>;
getLatestLeadScoutRun(): Promise<LeadScoutRunView | null>;
```

- [ ] **Step 1: Write failing progress/card tests**

Prove:
- `crm_ready` renders **Find me new leads** and no researching spinner;
- running shows stage/counters plus **Stop search**;
- `stopping` immediately says `Stopping…`;
- `stopped` says `Search stopped — partial results` and shows **Continue search**;
- partial candidates render while status is still `running`;
- candidate with `new_prospect` shows `Unsaved prospect`;
- existing/possible matches render distinct badges and links.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/assistant/lead-scout-progress.test.tsx src/components/assistant/lead-scout-candidate-card.test.tsx src/components/assistant/assistant-drawer.test.tsx
```

- [ ] **Step 3: Implement polling**

Poll `GET /runs/:id` every 1500ms only while `running | stopping`; stop polling on `crm_ready | stopped | complete | failed` and when drawer unmounts. Closing the drawer must not call `/stop`.

- [ ] **Step 4: Restore latest run**

When General Command Center opens with no explicit/new general response, load `/runs/latest` and restore non-expired latest CRM/Scout results. A newly submitted general question supersedes that display.

- [ ] **Step 5: Run tests + typechecks**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/assistant/lead-scout-progress.test.tsx src/components/assistant/lead-scout-candidate-card.test.tsx src/components/assistant/assistant-drawer.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/api-server typecheck
```

- [ ] **Step 6: Release 2 verification**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-repository.test.ts src/features/assistant/openai-lead-scout-provider.test.ts src/features/assistant/lead-scout-worker.test.ts src/features/assistant/lead-scout-worker-loop.test.ts src/routes/assistant-lead-scout.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/assistant/lead-scout-progress.test.tsx src/components/assistant/lead-scout-candidate-card.test.tsx
pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/features/assistant artifacts/adventure-zone/src/components/assistant
git commit -m "feat: show controllable lead scout progress"
```

---

# Release 3 — Deep Candidate Enrichment

Release 3 turns basic event discoveries into evidence-backed sales prospects: official vendor/application details first, then public news/review/social context where available, with candidate-specific **Research deeper**.

### Task 11: Define evidence hierarchy, fact normalization, and deterministic Adventure Zone fit

**Files:**
- Create: `artifacts/api-server/src/features/assistant/lead-scout-evidence.ts`
- Create: `artifacts/api-server/src/features/assistant/lead-scout-evidence.test.ts`
- Create: `artifacts/api-server/src/features/assistant/lead-scout-fit.ts`
- Create: `artifacts/api-server/src/features/assistant/lead-scout-fit.test.ts`
- Modify: `artifacts/api-server/src/features/assistant/lead-scout-types.ts`

**Interfaces:**

```ts
export type LeadScoutEvidenceFact = {
  key: string;
  value: string;
  category: "identity" | "schedule" | "vendor" | "attendance" | "logistics" | "recurrence" | "social_review" | "competition" | "contact";
  confidence: "high" | "medium" | "low";
  sourceUrls: string[];
  rationale: string;
};

export function selectBestFact(facts: LeadScoutEvidenceFact[]): LeadScoutEvidenceFact | null;
export function scoreAdventureZoneFit(input: LeadScoutFitInput): { score: number; reasons: string[]; cautions: string[] };
```

Evidence authority ordering is exactly: official event > official government/tourism/chamber > official vendor material > venue/partner > reputable news > public social > review/forum.

- [ ] **Step 1: Write failing evidence/fit tests**

Prove an official vendor deadline beats a contradictory review post; social-only hard facts remain low-confidence; fit rewards family/outdoor/vendor/multi-day/contactable signals and penalizes exclusive carnival provider, passed application deadline, weak existence, or no participation path.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-evidence.test.ts src/features/assistant/lead-scout-fit.test.ts
```

- [ ] **Step 3: Implement pure evidence/fit functions**

Keep scoring deterministic/testable. Do not let provider prose directly set final score without normalized signals.

- [ ] **Step 4: Run tests + typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-evidence.test.ts src/features/assistant/lead-scout-fit.test.ts
pnpm --filter @workspace/api-server typecheck
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/assistant/lead-scout-evidence* artifacts/api-server/src/features/assistant/lead-scout-fit* artifacts/api-server/src/features/assistant/lead-scout-types.ts
git commit -m "feat: rank lead scout evidence and fit"
```

### Task 12: Add evidence-backed candidate enrichment provider

**Files:**
- Modify: `artifacts/api-server/src/features/assistant/lead-scout-provider.ts`
- Modify: `artifacts/api-server/src/features/assistant/openai-lead-scout-provider.ts`
- Modify/Test: `artifacts/api-server/src/features/assistant/openai-lead-scout-provider.test.ts`

**Interface extension:**

```ts
enrichCandidate(input: {
  criteria: LeadDiscoveryCriteria;
  candidate: LeadScoutCandidateInput;
  knownSources: LeadScoutSourceInput[];
  signal?: AbortSignal;
}): Promise<{ facts: LeadScoutEvidenceFact[]; sources: LeadScoutSourceInput[]; coverageGaps: string[] }>;
```

- [ ] **Step 1: Write failing enrichment tests**

Mock an event with official event page + vendor PDF + news recap + indexed social result. Assert all facts require cited URLs, source categories are normalized, bounded excerpts only, social/review facts cannot be elevated to high confidence for official date/contact/deadline, and inaccessible social coverage is represented as a `coverageGap` rather than fabricated detail.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/openai-lead-scout-provider.test.ts
```

- [ ] **Step 3: Implement enrichment prompt/parser**

Explicitly request vendor/exhibitor/application, attendance, recurrence, logistics, public news recaps, public indexed social/review evidence, competing amusement provider, organizer/contact, and missing-evidence statements. Do not request or bypass login/private content.

- [ ] **Step 4: Run test + typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/openai-lead-scout-provider.test.ts
pnpm --filter @workspace/api-server typecheck
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/assistant/lead-scout-provider.ts artifacts/api-server/src/features/assistant/openai-lead-scout-provider*
git commit -m "feat: enrich lead scout candidates"
```

### Task 13: Persist candidate facts and implement Research deeper

**Files:**
- Modify: `artifacts/api-server/src/features/assistant/lead-scout-repository.ts`
- Modify: `artifacts/api-server/src/features/assistant/lead-scout-worker.ts`
- Modify: `artifacts/api-server/src/features/assistant/lead-scout-service.ts`
- Modify: `artifacts/api-server/src/routes/assistant-lead-scout.ts`
- Modify/Test: `artifacts/api-server/src/routes/assistant-lead-scout.test.ts`
- Modify/Test: `artifacts/api-server/src/features/assistant/lead-scout-worker.test.ts`

**New route:**

```text
POST /assistant/lead-scout/runs/:id/candidates/:candidateId/deepen
```

- [ ] **Step 1: Write failing persistence/route tests**

Prove candidate facts replace/upsert idempotently, source references belong to the same run, `Research deeper` can only target an actor-owned candidate, dismissed/saved candidates are not silently reactivated, and `deepen` queues only that candidate rather than restarting broad source discovery.

- [ ] **Step 2: Write worker enrichment-stage tests**

Prove normal broad runs enrich candidates incrementally after discovery, fit score updates only after normalized evidence is persisted, and stop/cancel still interrupts between candidates.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-worker.test.ts src/routes/assistant-lead-scout.test.ts
```

- [ ] **Step 4: Implement facts/deepen queue**

Use run progress/candidate state to mark a candidate `needs_enrichment | enriching | enriched | enrichment_failed`. Candidate failure keeps the candidate visible with `Needs more research`.

- [ ] **Step 5: Run tests + typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-worker.test.ts src/routes/assistant-lead-scout.test.ts
pnpm --filter @workspace/api-server typecheck
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/assistant/lead-scout-* artifacts/api-server/src/routes/assistant-lead-scout*
git commit -m "feat: deepen individual lead scout candidates"
```

### Task 14: Show evidence, uncertainty, and Research deeper in candidate profile previews

**Files:**
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-types.ts`
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-api.ts`
- Modify: `artifacts/adventure-zone/src/components/assistant/lead-scout-candidate-card.tsx`
- Modify/Test: `artifacts/adventure-zone/src/components/assistant/lead-scout-candidate-card.test.tsx`

- [ ] **Step 1: Write failing candidate-detail tests**

Assert cards can show vendor opportunity, organizer/contact, attendance, application deadline, route fit, social/review observations, evidence confidence, coverage gaps, cautions, `Open sources`, `Research deeper`, and `Not a fit`. Verify qualitative review/social evidence is visibly labeled and not rendered as an official fact.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/assistant/lead-scout-candidate-card.test.tsx
```

- [ ] **Step 3: Implement compact-first candidate UI**

Default card shows identity/date/location, `Unsaved prospect`, fit summary, best vendor/contact signal, top uncertainty, and actions. Put full evidence/facts under an expandable `Research details` area so the drawer remains scannable.

- [ ] **Step 4: Wire Research deeper**

POST the deepen route, refresh the run, and resume polling while candidate/run enrichment is active. Disable duplicate deepen requests while the candidate is already enriching.

- [ ] **Step 5: Release 3 verification**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-evidence.test.ts src/features/assistant/lead-scout-fit.test.ts src/features/assistant/openai-lead-scout-provider.test.ts src/features/assistant/lead-scout-worker.test.ts src/routes/assistant-lead-scout.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/assistant/lead-scout-candidate-card.test.tsx
pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/features/assistant artifacts/adventure-zone/src/components/assistant/lead-scout-candidate-card*
git commit -m "feat: show deep lead scout evidence"
```

---

# Release 4 — Unsaved Profile Intake

Release 4 makes an unsaved prospect intentionally convertible into a normal CRM lead while retaining duplicate safety and the user's required next action.

### Task 15: Extract reusable single-prospect intake service from Source Scout safeguards

**Files:**
- Create: `artifacts/api-server/src/features/profile-research/research-prospect-intake.ts`
- Create: `artifacts/api-server/src/features/profile-research/research-prospect-intake.test.ts`
- Modify: `artifacts/api-server/src/features/profile-research/profile-research-bulk-intake.ts`
- Modify/Test: `artifacts/api-server/src/features/profile-research/profile-research-bulk-intake.test.ts`
- Read/reuse: `artifacts/api-server/src/routes/profile-research-intake.ts`

**Interfaces:**

```ts
export type ResearchProspectSaveInput = {
  event: RelatedEventOpportunity;
  accepted: {
    name: string;
    city: string;
    region: string;
    startsAt: string | null;
    endsAt: string | null;
    website: string;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
  };
  nextActionKind: "call" | "email" | "prepare_quote";
  nextActionDueAt: string;
};

export class ResearchProspectIntakeService {
  create(input: ResearchProspectSaveInput): Promise<
    | { kind: "created"; profileId: string; bookingId: string }
    | { kind: "duplicate"; match: RelatedEventCrmMatch }
  >;
}
```

- [ ] **Step 1: Write failing single-intake tests**

Prove action/date are required, unsafe URL/location is rejected, duplicate is rechecked immediately before transaction, created record has `new_lead` + `possible` + open follow-up, accepted manual values win over stale research, and no full research narrative is inserted into Notes.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/profile-research/research-prospect-intake.test.ts src/features/profile-research/profile-research-bulk-intake.test.ts
```

- [ ] **Step 3: Implement reusable service**

Move shared validation/classify/create transaction logic out of `ProfileResearchBulkIntakeService`; make bulk intake call the single service sequentially so existing Source Scout behavior stays compatible.

- [ ] **Step 4: Run regression tests + typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/profile-research/research-prospect-intake.test.ts src/features/profile-research/profile-research-bulk-intake.test.ts
pnpm --filter @workspace/api-server typecheck
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/profile-research/research-prospect-intake* artifacts/api-server/src/features/profile-research/profile-research-bulk-intake*
git commit -m "refactor: share researched prospect intake"
```

### Task 16: Add Lead Scout candidate save/dismiss APIs and candidate-to-CRM linkage

**Files:**
- Modify: `artifacts/api-server/src/features/assistant/lead-scout-repository.ts`
- Modify: `artifacts/api-server/src/features/assistant/lead-scout-service.ts`
- Modify: `artifacts/api-server/src/routes/assistant-lead-scout.ts`
- Modify/Test: `artifacts/api-server/src/routes/assistant-lead-scout.test.ts`
- Reuse: `artifacts/api-server/src/features/profile-research/research-prospect-intake.ts`

**Routes:**

```text
POST /assistant/lead-scout/runs/:id/candidates/:candidateId/dismiss
POST /assistant/lead-scout/runs/:id/candidates/:candidateId/save
```

Save body:

```ts
{
  accepted: { name, city, region, startsAt, endsAt, website, contactName, contactEmail, contactPhone },
  nextActionKind: "call" | "email" | "prepare_quote",
  nextActionDueAt: "YYYY-MM-DD"
}
```

- [ ] **Step 1: Write failing route/service tests**

Prove an unsaved candidate creates no CRM rows before `/save`; dismiss only changes Scout review status; save requires action/date; server reloads the candidate and duplicate-checks at save time; duplicate result does not mark candidate saved; successful save records `saved_organization_id`/`saved_booking_id` and returns `In Command Center` linkage.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server test -- src/routes/assistant-lead-scout.test.ts
```

- [ ] **Step 3: Implement dismiss/save**

Only `new_prospect` + `unreviewed|shortlisted` candidates can save. Do not allow saving `possible_match` until the user resolves the match through existing CRM review flow.

- [ ] **Step 4: Run tests + typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/routes/assistant-lead-scout.test.ts
pnpm --filter @workspace/api-server typecheck
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/assistant/lead-scout-* artifacts/api-server/src/routes/assistant-lead-scout*
git commit -m "feat: save reviewed lead scout prospects"
```

### Task 17: Build Save as lead confirmation and saved-profile transition

**Files:**
- Create: `artifacts/adventure-zone/src/components/assistant/lead-scout-save-dialog.tsx`
- Create: `artifacts/adventure-zone/src/components/assistant/lead-scout-save-dialog.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/assistant/lead-scout-candidate-card.tsx`
- Modify/Test: `artifacts/adventure-zone/src/components/assistant/lead-scout-candidate-card.test.tsx`
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-api.ts`

- [ ] **Step 1: Write failing dialog tests**

Prove researched name/location/date/website/contact are prefilled but editable, `Save as lead` stays disabled until first action + first follow-up date are set, save request contains only accepted structured fields, duplicate response routes to review instead of claiming creation, and successful response changes the card to **In Command Center** with an Open profile link.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/assistant/lead-scout-save-dialog.test.tsx src/components/assistant/lead-scout-candidate-card.test.tsx
```

- [ ] **Step 3: Implement compact confirmation dialog**

First-action options are exactly `Call`, `Email`, `Prepare quote`. Use the existing business-date input conventions. Keep evidence/read-only research outside the save payload except accepted core fields.

- [ ] **Step 4: Implement Not a fit**

The candidate card calls dismiss, refreshes the run, and hides/collapses dismissed candidates from default results without mutating CRM status.

- [ ] **Step 5: Run UI tests + typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/assistant/lead-scout-save-dialog.test.tsx src/components/assistant/lead-scout-candidate-card.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/components/assistant/lead-scout-* artifacts/adventure-zone/src/features/assistant/assistant-api.ts
git commit -m "feat: approve lead scout prospects into CRM"
```

### Task 18: Optional batch intake only after individual intake passes end-to-end

**Files:**
- Modify: `artifacts/adventure-zone/src/components/assistant/lead-discovery-results.tsx`
- Create: `artifacts/adventure-zone/src/components/assistant/lead-scout-bulk-save.tsx`
- Create: `artifacts/adventure-zone/src/components/assistant/lead-scout-bulk-save.test.tsx`
- Modify: `artifacts/api-server/src/routes/assistant-lead-scout.ts`
- Modify/Test: `artifacts/api-server/src/routes/assistant-lead-scout.test.ts`
- Reuse: `artifacts/api-server/src/features/profile-research/profile-research-bulk-intake.ts`

- [ ] **Step 1: Gate this task on verified individual flow**

Do not begin until Task 17 tests pass and a manual/staging run proves one candidate can be saved and linked correctly.

- [ ] **Step 2: Write failing batch tests**

Only `new_prospect` unsaved candidates can be selected; maximum 20; one shared action/date required; each candidate is duplicate-rechecked; created/skipped results are returned separately; existing/possible matches are never selected automatically.

- [ ] **Step 3: Implement batch API/UI by reusing current Source Scout bulk service**

Do not add a second bulk creation implementation.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @workspace/api-server test -- src/routes/assistant-lead-scout.test.ts src/features/profile-research/profile-research-bulk-intake.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/assistant/lead-scout-bulk-save.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/assistant-lead-scout* artifacts/adventure-zone/src/components/assistant/lead-scout-bulk-save*
git commit -m "feat: bulk save approved lead scout prospects"
```

### Task 19: Full release verification and operational checks

**Files:**
- Modify if needed: `.github/workflows/*` only if an actual workflow configuration defect is demonstrated; do not edit workflows merely because GitHub produced a zero-step runner failure.
- Add/modify focused regression tests only for failures found during this task.

- [ ] **Step 1: Run backend focused suite**

```bash
pnpm --filter @workspace/api-server test -- \
  src/features/assistant/lead-scout-criteria.test.ts \
  src/features/assistant/lead-scout-crm-search.test.ts \
  src/features/assistant/lead-scout-repository.test.ts \
  src/features/assistant/lead-scout-service.test.ts \
  src/features/assistant/openai-lead-scout-provider.test.ts \
  src/features/assistant/lead-scout-worker.test.ts \
  src/features/assistant/lead-scout-worker-loop.test.ts \
  src/features/assistant/lead-scout-evidence.test.ts \
  src/features/assistant/lead-scout-fit.test.ts \
  src/routes/assistant-lead-scout.test.ts \
  src/features/profile-research/research-prospect-intake.test.ts \
  src/features/profile-research/profile-research-bulk-intake.test.ts
```

Expected: PASS with actual executed tests.

- [ ] **Step 2: Run frontend focused suite**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/assistant/lead-discovery-results.test.tsx \
  src/components/assistant/lead-scout-progress.test.tsx \
  src/components/assistant/lead-scout-candidate-card.test.tsx \
  src/components/assistant/lead-scout-save-dialog.test.tsx \
  src/components/assistant/assistant-drawer.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run full type/build checks**

```bash
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Manual/staging acceptance flow**

Verify this exact flow against a non-production-safe test profile/data set:
1. Ask: `I need to find an event between Montana and Utah in September 2026`.
2. Confirm CRM matches appear before any web Scout activity.
3. Confirm historical September records are labeled **Likely recurring**, never confirmed.
4. Press **Find me new leads**.
5. Confirm visible stage/progress starts and partial unsaved prospects appear before completion.
6. Press **Stop search** during work; confirm `Stopping… -> Search stopped — partial results` and that partial candidates remain after closing/reopening the drawer.
7. Press **Continue search** and confirm it resumes the same run.
8. Open a candidate and inspect official/vendor/news/social/review evidence plus coverage gaps.
9. Press **Research deeper** and confirm only that candidate enriches.
10. Press **Save as lead**; confirm Save is blocked until first action/date are chosen.
11. Save, then confirm normal profile + New Lead booking + open follow-up exist and candidate flips to **In Command Center**.
12. Re-run duplicate check against the saved candidate and confirm another profile cannot be created silently.

- [ ] **Step 5: Restart/recovery acceptance**

Start a Scout, let at least one candidate persist, restart the API process, reopen the drawer, and confirm the run is recoverable/resumable with the persisted candidate still present.

- [ ] **Step 6: Verify privacy boundaries**

Inspect logged/provider request fixtures and assert no raw ACT/private note bodies are present in broad web prompts; only normalized criteria and public candidate/source data may be sent.

- [ ] **Step 7: Record GitHub Actions evidence**

For each PR head, inspect workflow jobs and steps. If steps execute, record their real result. If jobs contain `steps: []`, document the known runner infrastructure failure and do not claim test/build success from CI.

- [ ] **Step 8: Final commit**

```bash
git add artifacts lib/db/migrations .github/workflows
git commit -m "test: verify staged lead scout workflow"
```

## Release/PR sequencing

Implement and review as four feature PRs so each release is independently understandable:

1. `feature/lead-scout-crm-discovery` — Tasks 1–5.
2. `feature/lead-scout-web-stages` — Tasks 6–10, starting from merged Release 1 `main`.
3. `feature/lead-scout-enrichment` — Tasks 11–14, starting from merged Release 2 `main`.
4. `feature/lead-scout-intake` — Tasks 15–19, starting from merged Release 3 `main`.

Do not stack later-release implementation onto an unmerged earlier-release branch unless explicitly requested. At every release boundary, fetch current `main`, verify prior PR merged, create the next branch, then run that release's focused tests before opening the next PR.
