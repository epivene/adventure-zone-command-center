# Scout Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically monitor profiles created from Scout Results and surface durable, evidence-backed Scout Alerts on the owner Today screen.

**Architecture:** A saved Scout candidate atomically activates one durable watch. A dedicated worker performs daily local deadline/gap evaluation and bounded periodic public re-research, compares normalized snapshots, and writes idempotent alerts. Today reads visible alerts and provides snooze/dismiss actions without changing CRM fields.

**Tech Stack:** TypeScript, Node.js, Express, React, PostgreSQL, raw parameterized SQL, Vitest, Testing Library, existing Lead Scout provider/evidence helpers.

**Spec:** `docs/superpowers/specs/2026-08-25-scout-alerts-design.md`

## Global Constraints

- Scout Alerts are in-app only and appear on the owner Today screen.
- Calls and overdue follow-ups remain the highest-priority Today work.
- Monitor only profiles created from saved Scout Results.
- No background operation may edit organization, booking, contact, follow-up, or Scout Notes fields.
- Hard-field alerts require operationally reliable non-social evidence.
- External research cadence is 7 days normally and 24 hours near a deadline/event date.
- Deadline thresholds are 30, 14, 7, and 1 day; initial setup emits only the most urgent applicable threshold.
- Source persistence is bounded metadata only; no full scraped pages or hidden reasoning.
- Alert writes must be idempotent through unique fingerprints.
- Tests are written and observed failing before production implementation.

---

## File map

### New server files

- `artifacts/api-server/src/features/assistant/scout-alert-types.ts` — domain contracts shared by classifier, repository, worker, and route.
- `artifacts/api-server/src/features/assistant/scout-alert-classifier.ts` — pure snapshot comparison, deadline, gap, severity, and fingerprint rules.
- `artifacts/api-server/src/features/assistant/scout-alert-snapshot.ts` — baseline/researched snapshot normalization using existing evidence reliability rules.
- `artifacts/api-server/src/features/assistant/scout-alert-repository.ts` — durable watch claim/load/success/failure/list/action persistence.
- `artifacts/api-server/src/features/assistant/scout-alert-worker.ts` — one-watch orchestration and provider refresh.
- `artifacts/api-server/src/features/assistant/scout-alert-worker-loop.ts` — process loop scheduling and clean shutdown.
- `artifacts/api-server/src/db/scout-alerts-startup-migration.ts` — additive startup schema guard.
- `lib/db/migrations/068_scout_alerts.sql` — canonical SQL migration.

### New client files

- `artifacts/adventure-zone/src/components/today/scout-alerts-section.tsx` — focused Today alert list and actions.

### Modified files

- `artifacts/api-server/src/features/assistant/lead-scout-candidate-save-store.ts` — activate a watch atomically with candidate save linkage.
- `artifacts/api-server/src/db/act-review-startup.ts` — run and report the new schema guard.
- `artifacts/api-server/src/index.ts` — start and close the Scout Alert worker loop.
- `artifacts/api-server/src/routes/today.ts` — include alerts and expose snooze/dismiss endpoints.
- `artifacts/adventure-zone/src/pages/TodayPage.tsx` — render Scout Alerts under My Work.

### New/focused tests

- `artifacts/api-server/src/features/assistant/scout-alert-classifier.test.ts`
- `artifacts/api-server/src/features/assistant/scout-alert-snapshot.test.ts`
- `artifacts/api-server/src/features/assistant/scout-alert-repository.test.ts`
- `artifacts/api-server/src/features/assistant/scout-alert-worker.test.ts`
- `artifacts/api-server/src/features/assistant/scout-alert-worker-loop.test.ts`
- `artifacts/api-server/src/db/scout-alerts-startup-migration.test.ts`
- `artifacts/adventure-zone/src/components/today/scout-alerts-section.test.tsx`
- `artifacts/adventure-zone/src/pages/TodayPage.scout-alerts.test.tsx`

---

### Task 1: Define Scout Alert domain rules

**Files:**
- Create: `artifacts/api-server/src/features/assistant/scout-alert-types.ts`
- Create: `artifacts/api-server/src/features/assistant/scout-alert-classifier.ts`
- Test: `artifacts/api-server/src/features/assistant/scout-alert-classifier.test.ts`

**Interfaces:**
- Produces:

```ts
export type ScoutAlertKind =
  | "application_opened"
  | "deadline_approaching"
  | "dates_announced"
  | "dates_changed"
  | "contact_changed"
  | "needs_verification"
  | "monitoring_problem";

export type ScoutAlertSeverity = "info" | "attention" | "urgent";

export type ScoutAlertSource = {
  url: string;
  title: string;
  publisher: string | null;
  category: string;
  retrievedAt: string;
};

export type ScoutAlertSnapshot = {
  startsAt: string | null;
  endsAt: string | null;
  applicationAvailable: boolean;
  applicationUrl: string | null;
  applicationDeadline: string | null;
  organizerName: string | null;
  organizerEmail: string | null;
  organizerPhone: string | null;
  coverageGaps: string[];
  sources: ScoutAlertSource[];
  capturedAt: string;
};

export type ScoutAlertDraft = {
  kind: ScoutAlertKind;
  severity: ScoutAlertSeverity;
  title: string;
  body: string;
  beforeValue: unknown | null;
  afterValue: unknown | null;
  sources: ScoutAlertSource[];
  confidence: "high" | "medium" | "low" | null;
  fingerprint: string;
  dueAt: string | null;
};

export function evaluateScoutAlerts(input: {
  watchId: string;
  profileName: string;
  previous: ScoutAlertSnapshot | null;
  current: ScoutAlertSnapshot;
  now: Date;
  baseline: boolean;
}): ScoutAlertDraft[];

export function monitoringProblemAlert(input: {
  watchId: string;
  profileName: string;
  failureCount: number;
}): ScoutAlertDraft | null;
```

- [ ] **Step 1: Write failing classifier tests**

Cover these exact cases:

```ts
it("alerts once when dates are first announced", () => {
  const alerts = evaluateScoutAlerts({
    watchId: "watch-1",
    profileName: "Twin Falls County Fair",
    previous: snapshot({ startsAt: null, endsAt: null }),
    current: snapshot({ startsAt: "2026-09-02", endsAt: "2026-09-07" }),
    now: new Date("2026-08-25T12:00:00Z"),
    baseline: false,
  });
  expect(alerts).toContainEqual(expect.objectContaining({
    kind: "dates_announced",
    severity: "attention",
    afterValue: { startsAt: "2026-09-02", endsAt: "2026-09-07" },
  }));
});
```

Also assert:

- baseline snapshots do not emit date/contact/application change alerts,
- changed dates include before/after values,
- `applicationAvailable: false -> true` emits `application_opened`,
- normalized contact whitespace/case does not alert,
- a real email or phone change emits one `contact_changed` alert,
- stable snapshots emit no alerts,
- critical coverage gaps are grouped into one `needs_verification` alert,
- noncritical prose gaps are ignored,
- deadlines at 25, 13, 6, and 0 days map to 30/14/7/1-day fingerprints,
- a past deadline does not emit an approaching alert,
- baseline at six days emits only the 7-day alert,
- failure count 3 creates `monitoring_problem`; failure count 2 does not.

- [ ] **Step 2: Run the classifier test and verify RED**

Run:

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/scout-alert-classifier.test.ts
```

Expected: FAIL because the domain files/functions do not exist.

- [ ] **Step 3: Implement minimal domain types and pure classifier**

Implementation rules:

```ts
function deadlineThreshold(days: number) {
  if (days < 0) return null;
  if (days <= 1) return 1;
  if (days <= 7) return 7;
  if (days <= 14) return 14;
  if (days <= 30) return 30;
  return null;
}
```

Use a stable SHA-256 fingerprint helper over `watchId`, kind, and normalized distinguishing values. Bound titles to 180 characters, bodies to 1200, gap lists to 8 items, and source lists to 8 safe HTTP/HTTPS entries.

Critical gaps match only:

```ts
/date|organizer|contact|vendor|application|entertainment|power|electric|space|insurance|water/i
```

Severity:

- deadline 7/1 days: `urgent`
- date change, application opened, deadline 14 days: `attention`
- date announced, contact change, deadline 30 days, grouped gaps, monitoring problem: `info` or `attention` as asserted by tests.

- [ ] **Step 4: Run the classifier test and verify GREEN**

Run the same Vitest command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/assistant/scout-alert-types.ts \
  artifacts/api-server/src/features/assistant/scout-alert-classifier.ts \
  artifacts/api-server/src/features/assistant/scout-alert-classifier.test.ts
git commit -m "feat: define Scout Alert rules"
```

---

### Task 2: Add durable schema and activate watches on profile creation

**Files:**
- Create: `lib/db/migrations/068_scout_alerts.sql`
- Create: `artifacts/api-server/src/db/scout-alerts-startup-migration.ts`
- Create: `artifacts/api-server/src/db/scout-alerts-startup-migration.test.ts`
- Modify: `artifacts/api-server/src/db/act-review-startup.ts`
- Modify: `artifacts/api-server/src/features/assistant/lead-scout-candidate-save-store.ts`
- Modify test: `artifacts/api-server/src/features/assistant/lead-scout-candidate-save-store.test.ts`

**Interfaces:**
- Produces:

```ts
export async function ensureScoutAlertsSchema(client: {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<boolean>;
```

- Existing `LeadScoutCandidateSaveLinker.markSaved(...)` keeps its public signature but now atomically updates the candidate and upserts one active watch.

- [ ] **Step 1: Write failing startup migration tests**

Assert:

- ready marker returns `false` without executing DDL,
- missing marker executes DDL and returns `true`,
- DDL includes both tables, status checks, unique fingerprint, due-watch index, and visible-alert index.

- [ ] **Step 2: Write the canonical migration SQL**

Create the two tables exactly as specified in the design. Required indexes:

```sql
create index scout_alert_watches_due_idx
  on scout_alert_watches(status, next_evaluation_at, next_research_at, lease_expires_at);

create unique index scout_alerts_fingerprint_unique
  on scout_alerts(fingerprint);

create index scout_alerts_visible_idx
  on scout_alerts(status, snoozed_until, severity, due_at, detected_at desc);
```

Use checks for all watch/alert statuses, alert kinds, severities, and confidence values. Require `failure_count >= 0`.

- [ ] **Step 3: Run startup migration test and verify RED**

```bash
pnpm exec vitest run artifacts/api-server/src/db/scout-alerts-startup-migration.test.ts
```

Expected: FAIL because `ensureScoutAlertsSchema` does not exist.

- [ ] **Step 4: Implement the startup schema guard and wire it into startup migrations**

`ensureScoutAlertsSchema` first checks both tables and required indexes/constraints. It runs the same SQL as `068_scout_alerts.sql` only when the marker is incomplete.

Update `runActReviewMigrationsAtStartup` to call the guard after Lead Scout Release 3 and report `068_scout_alerts.sql` when applied.

- [ ] **Step 5: Extend the save-linker test first**

The fake query result should represent the final watch row. Assert the SQL:

- updates only a reviewable `new_prospect`,
- inserts into `scout_alert_watches`,
- uses `on conflict (candidate_id) do update`,
- sets `next_evaluation_at=now()`,
- sets `next_research_at` from `coalesce(candidate.enriched_at, now()) + interval '7 days'`,
- returns exactly one row for success.

- [ ] **Step 6: Run save-linker test and verify RED**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/lead-scout-candidate-save-store.test.ts
```

Expected: FAIL because the SQL does not activate a watch.

- [ ] **Step 7: Implement atomic candidate-link + watch activation**

Use one parameterized CTE statement:

```sql
with saved as (
  update lead_scout_candidates candidate
  set review_status='saved', crm_match_status='existing',
      matched_organization_id=$4, matched_booking_id=$5,
      saved_organization_id=$4, saved_booking_id=$5, updated_at=now()
  where ...
  returning candidate.id, candidate.run_id, candidate.enriched_at
), activated as (
  insert into scout_alert_watches
    (candidate_id, actor_id, organization_id, booking_id, status,
     next_evaluation_at, next_research_at, created_at, updated_at)
  select saved.id, run.actor_id, $4, $5, 'active', now(),
         coalesce(saved.enriched_at, now()) + interval '7 days', now(), now()
  from saved join lead_scout_runs run on run.id=saved.run_id and run.actor_id=$2
  on conflict (candidate_id) do update
    set organization_id=excluded.organization_id,
        booking_id=excluded.booking_id,
        actor_id=excluded.actor_id,
        status='active', updated_at=now()
  returning candidate_id
)
select candidate_id from activated
```

- [ ] **Step 8: Run migration and save-linker tests and verify GREEN**

Run both focused Vitest files.

- [ ] **Step 9: Commit**

```bash
git add lib/db/migrations/068_scout_alerts.sql \
  artifacts/api-server/src/db/scout-alerts-startup-migration.ts \
  artifacts/api-server/src/db/scout-alerts-startup-migration.test.ts \
  artifacts/api-server/src/db/act-review-startup.ts \
  artifacts/api-server/src/features/assistant/lead-scout-candidate-save-store.ts \
  artifacts/api-server/src/features/assistant/lead-scout-candidate-save-store.test.ts
git commit -m "feat: persist Scout Alert watches"
```

---

### Task 3: Build snapshots and durable repository operations

**Files:**
- Create: `artifacts/api-server/src/features/assistant/scout-alert-snapshot.ts`
- Create: `artifacts/api-server/src/features/assistant/scout-alert-snapshot.test.ts`
- Create: `artifacts/api-server/src/features/assistant/scout-alert-repository.ts`
- Create: `artifacts/api-server/src/features/assistant/scout-alert-repository.test.ts`

**Interfaces:**
- Consumes: `ScoutAlertSnapshot`, `ScoutAlertDraft`, existing Lead Scout types/evidence helpers.
- Produces:

```ts
export type ScoutAlertWatchClaim = {
  watchId: string;
  workerId: string;
  actorId: string;
  candidateId: string;
  organizationId: string;
  bookingId: string | null;
  nextResearchAt: string;
  snapshot: ScoutAlertSnapshot | null;
};

export type ScoutAlertWatchContext = {
  claim: ScoutAlertWatchClaim;
  profileName: string;
  bookingStatus: string | null;
  bookingEndsAt: string | null;
  criteria: LeadDiscoveryCriteria;
  candidate: LeadScoutCandidateView;
  knownSources: LeadScoutSourceInput[];
};

export class ScoutAlertRepository {
  claimDue(input: { workerId: string; now: Date; leaseMs: number }): Promise<ScoutAlertWatchClaim | null>;
  loadContext(claim: ScoutAlertWatchClaim): Promise<ScoutAlertWatchContext | null>;
  saveSuccess(input: {
    claim: ScoutAlertWatchClaim;
    snapshot: ScoutAlertSnapshot;
    alerts: ScoutAlertDraft[];
    now: Date;
    nextEvaluationAt: Date;
    nextResearchAt: Date;
    researched: boolean;
  }): Promise<void>;
  recordFailure(input: {
    claim: ScoutAlertWatchClaim;
    profileName: string;
    now: Date;
    safeError: string;
    nextRetryAt: Date;
    failureAlert: ScoutAlertDraft | null;
  }): Promise<void>;
  completeWatch(input: { claim: ScoutAlertWatchClaim; now: Date }): Promise<void>;
  listVisible(now: Date): Promise<ScoutAlertView[]>;
  snooze(alertId: string, until: Date): Promise<boolean>;
  dismiss(alertId: string): Promise<boolean>;
}

export function baselineScoutAlertSnapshot(input: {
  candidate: LeadScoutCandidateView;
  sources: LeadScoutSourceInput[];
  now: Date;
}): ScoutAlertSnapshot;

export function researchedScoutAlertSnapshot(input: {
  candidate: LeadScoutCandidateView;
  facts: LeadScoutEvidenceFact[];
  sources: LeadScoutSourceInput[];
  coverageGaps: string[];
  now: Date;
}): ScoutAlertSnapshot;
```

- [ ] **Step 1: Write failing snapshot tests**

Assert:

- baseline keeps candidate dates/contact/deadline/gaps,
- baseline recognizes a vendor/application path only from meaningful vendor summary/source evidence,
- researched snapshot selects reliable schedule dates, deadline, application URL, organizer name/email/phone,
- two ISO dates in one schedule fact become start/end,
- low-confidence social/review facts cannot replace hard fields,
- unsafe URLs are discarded,
- source list is deduplicated and bounded.

- [ ] **Step 2: Run snapshot test and verify RED**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/scout-alert-snapshot.test.ts
```

- [ ] **Step 3: Implement snapshot normalization**

Reuse `selectBestFact` and `isOperationallyReliableFact` from `lead-scout-evidence.ts`.

Use key/value patterns:

```ts
const startPattern = /start|starts|begin|event_date|date_from/i;
const endPattern = /end|ends|through|date_to/i;
const deadlinePattern = /deadline|due_date|apply_by/i;
const contactNamePattern = /organizer.*name|contact.*name/i;
const emailPattern = /email/i;
const phonePattern = /phone|telephone/i;
const applicationPattern = /application|apply|vendor|exhibitor|entertainment|attraction/i;
```

Extract only valid `YYYY-MM-DD` values. Normalize email lowercase, phone to digits for comparison while preserving readable values, and collapse whitespace in names.

- [ ] **Step 4: Write failing repository tests**

Using a fake query database, assert:

- `claimDue` uses `for update skip locked`, claims only active due watches, and sets a lease,
- `loadContext` returns candidate, facts, sources, run criteria, profile, booking, and contact values,
- `saveSuccess` uses one atomic CTE to update the watch and insert alert drafts with `on conflict (fingerprint) do nothing`,
- `recordFailure` increments failure count and optionally inserts the monitoring alert,
- `completeWatch` marks watch complete and resolves open/snoozed alerts,
- `listVisible` includes open and expired-snoozed alerts only and maps safe source metadata,
- `snooze` and `dismiss` return false for missing IDs.

- [ ] **Step 5: Run repository test and verify RED**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/scout-alert-repository.test.ts
```

- [ ] **Step 6: Implement repository methods**

Bounds:

- safe error: 500 characters,
- title: 180,
- body: 1200,
- source array: 8,
- visible Today list: 50 alerts.

Severity ordering SQL:

```sql
case severity when 'urgent' then 0 when 'attention' then 1 else 2 end,
due_at nulls last,
detected_at desc,
id
```

Expired snoozes are visible when `snoozed_until <= $1` without mutating status during read.

- [ ] **Step 7: Run snapshot/repository tests and verify GREEN**

Run both focused Vitest files.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/features/assistant/scout-alert-snapshot.ts \
  artifacts/api-server/src/features/assistant/scout-alert-snapshot.test.ts \
  artifacts/api-server/src/features/assistant/scout-alert-repository.ts \
  artifacts/api-server/src/features/assistant/scout-alert-repository.test.ts
git commit -m "feat: add Scout Alert snapshots and repository"
```

---

### Task 4: Implement the automatic alert worker and lifecycle

**Files:**
- Create: `artifacts/api-server/src/features/assistant/scout-alert-worker.ts`
- Create: `artifacts/api-server/src/features/assistant/scout-alert-worker.test.ts`
- Create: `artifacts/api-server/src/features/assistant/scout-alert-worker-loop.ts`
- Create: `artifacts/api-server/src/features/assistant/scout-alert-worker-loop.test.ts`
- Modify: `artifacts/api-server/src/index.ts`

**Interfaces:**
- Produces:

```ts
export class ScoutAlertWorker {
  constructor(options?: {
    repository?: Pick<ScoutAlertRepository,
      "claimDue" | "loadContext" | "saveSuccess" | "recordFailure" | "completeWatch">;
    provider?: Pick<LeadScoutProvider, "enrichCandidate">;
    leaseMs?: number;
  });

  runOne(input: { workerId: string; now: Date }): Promise<{ kind: "idle" | "progress" }>;
}

export class ScoutAlertWorkerLoop {
  start(): void;
  close(): Promise<void>;
}
```

- [ ] **Step 1: Write failing worker tests**

Use fake repository/provider objects. Cover:

1. no claim -> `idle`, provider untouched,
2. missing context -> completes/abandons safely without provider,
3. first evaluation seeds baseline, creates only local deadline/gap alerts, and does not call provider when research is not due,
4. due research calls provider once with at most 32 known sources,
5. researched changes produce date/application/contact alerts and save the new snapshot,
6. stable refresh saves no change alerts,
7. near-term date/deadline schedules next research in 24 hours; normal schedules 7 days,
8. completed/cancelled/declined booking or event ended 14+ days completes the watch,
9. provider failure schedules 6/12/24-hour then max-7-day backoff,
10. third failure supplies one monitoring-problem alert,
11. successful refresh resets failure state through `saveSuccess`.

- [ ] **Step 2: Run worker test and verify RED**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/scout-alert-worker.test.ts
```

- [ ] **Step 3: Implement `ScoutAlertWorker`**

Worker algorithm:

```ts
const claim = await repository.claimDue(...);
if (!claim) return { kind: "idle" };
const context = await repository.loadContext(claim);
if (!context || isFinal(context, now)) {
  await repository.completeWatch({ claim, now });
  return { kind: "progress" };
}

const baseline = claim.snapshot ?? baselineScoutAlertSnapshot(...);
let current = baseline;
let researched = false;

if (new Date(claim.nextResearchAt) <= now) {
  const enrichment = await provider.enrichCandidate({
    criteria: context.criteria,
    candidate: candidateInput(context.candidate),
    knownSources: context.knownSources.slice(0, 32),
  });
  current = researchedScoutAlertSnapshot(...);
  researched = true;
}

const alerts = evaluateScoutAlerts({
  watchId: claim.watchId,
  profileName: context.profileName,
  previous: claim.snapshot,
  current,
  now,
  baseline: claim.snapshot === null,
});

await repository.saveSuccess(...);
return { kind: "progress" };
```

Do not update Lead Scout candidate facts or CRM fields.

- [ ] **Step 4: Write failing loop tests**

Mirror `LeadScoutWorkerLoop` behavior:

- start only once,
- schedule immediately,
- idle retry 30 seconds,
- progress retry 1 second,
- unexpected error retry 60 seconds,
- close cancels pending schedule and waits for active work.

- [ ] **Step 5: Run loop test and verify RED**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/scout-alert-worker-loop.test.ts
```

- [ ] **Step 6: Implement loop and wire server lifecycle**

In `index.ts`:

```ts
const scoutAlertLoop = new ScoutAlertWorkerLoop({
  worker: new ScoutAlertWorker(),
  workerId: `scout-alert-${randomUUID()}`,
  clock: { now: () => new Date() },
  scheduler: systemScoutAlertWorkerLoopScheduler,
});
```

Start it with the other background workers and include `scoutAlertLoop.close()` in shutdown.

- [ ] **Step 7: Run worker/loop tests and verify GREEN**

Run both focused files.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/features/assistant/scout-alert-worker.ts \
  artifacts/api-server/src/features/assistant/scout-alert-worker.test.ts \
  artifacts/api-server/src/features/assistant/scout-alert-worker-loop.ts \
  artifacts/api-server/src/features/assistant/scout-alert-worker-loop.test.ts \
  artifacts/api-server/src/index.ts
git commit -m "feat: monitor saved Scout profiles"
```

---

### Task 5: Add Today alert data and actions

**Files:**
- Modify: `artifacts/api-server/src/routes/today.ts`
- Add focused test: `artifacts/api-server/src/routes/today-scout-alerts.test.ts`

**Interfaces:**
- Consumes: `ScoutAlertRepository.listVisible`, `.snooze`, `.dismiss`.
- Produces API response fields:

```ts
scoutAlerts: ScoutAlertView[];
scoutAlertTotal: number;
scoutUrgentAlertTotal: number;
```

- Produces endpoints:

```text
POST /today/scout-alerts/:alertId/snooze  { until: ISO timestamp }
POST /today/scout-alerts/:alertId/dismiss
```

- [ ] **Step 1: Write failing Today route tests**

Use the route’s existing Express/request logging test harness or a focused mocked repository wrapper. Assert:

- `/today` includes visible alerts and counts,
- alert loading failure returns the rest of Today with `scoutAlerts: []`,
- valid snooze calls repository and returns `{ ok: true }`,
- invalid date returns 400,
- missing alert returns 404,
- dismiss success/missing behavior.

- [ ] **Step 2: Run route test and verify RED**

```bash
pnpm exec vitest run artifacts/api-server/src/routes/today-scout-alerts.test.ts
```

- [ ] **Step 3: Implement Today integration**

Create one repository instance per request or a small factory at module scope. Load alerts in the existing `Promise.all`, but catch/log alert failures separately:

```ts
const scoutAlerts = await alertRepository.listVisible(now).catch((error) => {
  req.log.warn({ err: error }, "Scout Alerts could not be loaded for Today");
  return [];
});
```

For snooze, require a finite future timestamp and cap it to no more than one year. The UI sends exactly seven days.

- [ ] **Step 4: Run route test and verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/today.ts \
  artifacts/api-server/src/routes/today-scout-alerts.test.ts
git commit -m "feat: expose Scout Alerts on Today"
```

---

### Task 6: Build the Today Scout Alerts section

**Files:**
- Create: `artifacts/adventure-zone/src/components/today/scout-alerts-section.tsx`
- Create: `artifacts/adventure-zone/src/components/today/scout-alerts-section.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/TodayPage.scout-alerts.test.tsx`

**Interfaces:**
- Produces:

```ts
export type ScoutAlertView = {
  id: string;
  organizationId: string;
  bookingId: string | null;
  profileName: string;
  kind: ScoutAlertKind;
  severity: ScoutAlertSeverity;
  title: string;
  body: string;
  beforeValue: unknown | null;
  afterValue: unknown | null;
  sources: ScoutAlertSource[];
  confidence: "high" | "medium" | "low" | null;
  dueAt: string | null;
  detectedAt: string;
};

export function ScoutAlertsSection(props: {
  alerts: ScoutAlertView[];
  urgentCount: number;
  onSnooze(alertId: string): Promise<void>;
  onDismiss(alertId: string): Promise<void>;
}): JSX.Element | null;
```

- [ ] **Step 1: Write failing component tests**

Assert:

- no alerts renders nothing,
- heading shows `Scout Alerts (N)`,
- urgent alerts set the details element open,
- severity/date/source/profile links render,
- before/after values are readable and bounded,
- Snooze/Dismiss invoke callbacks and disable only the active alert,
- rejected action keeps the alert and shows inline error.

- [ ] **Step 2: Run component test and verify RED**

```bash
pnpm exec vitest run artifacts/adventure-zone/src/components/today/scout-alerts-section.test.tsx
```

- [ ] **Step 3: Implement the focused component**

Use existing button/link classes. Source links require `target="_blank"` and `rel="noreferrer"`. Profile href:

```ts
const href = alert.bookingId
  ? `/profiles/${alert.organizationId}?bookingId=${alert.bookingId}`
  : `/profiles/${alert.organizationId}`;
```

Order incoming alerts defensively by urgent/attention/info, due date, detected date.

- [ ] **Step 4: Write failing TodayPage integration test**

Mock `/today` with one urgent Scout Alert. Assert the section appears after Contracts and before Needs a decision in DOM order. Click Snooze, verify:

```ts
apiPost(`/today/scout-alerts/${alert.id}/snooze`, {
  until: expect.any(String),
});
```

and verify the alert disappears locally after success. Repeat for Dismiss.

- [ ] **Step 5: Run TodayPage integration test and verify RED**

```bash
pnpm exec vitest run artifacts/adventure-zone/src/pages/TodayPage.scout-alerts.test.tsx
```

- [ ] **Step 6: Integrate into TodayPage**

Normalize `dashboard.scoutAlerts ?? []` and hold a local visible-alert list. Add:

```ts
async function snoozeScoutAlert(alertId: string) {
  const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await apiPost(`/today/scout-alerts/${alertId}/snooze`, { until });
  setScoutAlerts((current) => current.filter((alert) => alert.id !== alertId));
}
```

Add analogous dismiss behavior. Render the section after Contracts and before Needs a decision. Do not add Scout Alerts to `deriveTodayFocus` in this release.

- [ ] **Step 7: Run component and TodayPage tests and verify GREEN**

- [ ] **Step 8: Commit**

```bash
git add artifacts/adventure-zone/src/components/today/scout-alerts-section.tsx \
  artifacts/adventure-zone/src/components/today/scout-alerts-section.test.tsx \
  artifacts/adventure-zone/src/pages/TodayPage.tsx \
  artifacts/adventure-zone/src/pages/TodayPage.scout-alerts.test.tsx
git commit -m "feat: show Scout Alerts on Today"
```

---

### Task 7: Full verification and release review

**Files:**
- Review all files changed by Tasks 1–6.
- Update plan/spec only if implementation exposes a real contradiction.

- [ ] **Step 1: Run all focused Scout Alert tests**

```bash
pnpm exec vitest run \
  artifacts/api-server/src/features/assistant/scout-alert-classifier.test.ts \
  artifacts/api-server/src/features/assistant/scout-alert-snapshot.test.ts \
  artifacts/api-server/src/features/assistant/scout-alert-repository.test.ts \
  artifacts/api-server/src/features/assistant/scout-alert-worker.test.ts \
  artifacts/api-server/src/features/assistant/scout-alert-worker-loop.test.ts \
  artifacts/api-server/src/features/assistant/lead-scout-candidate-save-store.test.ts \
  artifacts/api-server/src/db/scout-alerts-startup-migration.test.ts \
  artifacts/api-server/src/routes/today-scout-alerts.test.ts \
  artifacts/adventure-zone/src/components/today/scout-alerts-section.test.tsx \
  artifacts/adventure-zone/src/pages/TodayPage.scout-alerts.test.tsx
```

Expected: all pass with zero unhandled errors.

- [ ] **Step 2: Run adjacent regression tests**

```bash
pnpm exec vitest run \
  artifacts/api-server/src/features/assistant/lead-scout-save.test.ts \
  artifacts/api-server/src/features/assistant/lead-scout-worker.test.ts \
  artifacts/api-server/src/features/assistant/lead-scout-worker-loop.test.ts \
  artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx \
  artifacts/adventure-zone/src/pages/TodayPage.test.tsx \
  artifacts/adventure-zone/src/pages/TodayPage.simple-layout.test.tsx
```

- [ ] **Step 3: Run workspace typecheck**

```bash
pnpm run typecheck
```

Expected: exit 0.

- [ ] **Step 4: Run workspace build**

```bash
pnpm run build
```

Expected: exit 0.

- [ ] **Step 5: Review the final diff against the spec**

Confirm:

- watches activate only for saved Scout Results,
- no CRM mutation exists in worker code,
- Today failures remain isolated,
- alert source URLs are safe/bounded,
- social evidence cannot trigger hard-field changes,
- deadline threshold behavior matches 30/14/7/1,
- all worker loops close during shutdown,
- no unrelated UI or navigation changes are present.

- [ ] **Step 6: Commit any verification-only corrections**

```bash
git add -A
git commit -m "test: verify Scout Alerts workflow"
```

- [ ] **Step 7: Open PR with exact verification evidence**

The PR body must list commands actually executed and their results. If GitHub Actions terminates without running steps, state that separately and do not present it as test evidence.