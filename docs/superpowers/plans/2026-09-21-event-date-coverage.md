# Event Date Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Give every event profile a trustworthy next-event date when one is known or can be responsibly inferred, clearly distinguish booked, confirmed, expected, needs-review, and not-found states, and keep inferred dates out of operational scheduling.

**Architecture:** Add an immutable, profile-level event-date fact model beside bookings. A pure resolver gives future non-cancelled bookings first priority, then active confirmed facts, then active expected facts. Extend profile research with a dedicated date candidate and apply path that creates or supersedes facts rather than editing bookings. An owner-only, persisted batch queue audits internal evidence first and performs public research only for unresolved profiles. Read models expose the effective date to profile surfaces, CSV, and assistant context; operational calendar/map/route queries remain booking-only.

**Tech Stack:** TypeScript, React 18, Vite, wouter, TanStack Query, Express, Drizzle ORM, PostgreSQL/PGlite, Zod, Vitest, date-fns, pnpm.

**Spec:** [docs/superpowers/specs/2026-09-21-event-date-coverage-design.md](../specs/2026-09-21-event-date-coverage-design.md)

## Global Constraints

- Preserve every historical booking. Research may never change a booking date or manufacture a booking.
- Treat a date as operational only when backed by an existing non-cancelled booking.
- Store researched dates as date-only values and format them in UTC to avoid timezone drift.
- Allow at most one active researched fact per organization; supersede facts transactionally and keep their history.
- Compute recurrence-derived expected dates in deterministic application code, never by accepting model arithmetic.
- Search existing internal evidence before any web request. Public research starts only through an explicit owner action.
- Require source evidence and rationale for confirmed and expected facts.
- Keep all endpoints behind the existing owner authorization boundary.
- Make migrations idempotent and safe against both empty and populated databases.
- Preserve unrelated work in the branch and use focused commits after every green task.

## Review Focus

- A past booking must never be re-dated when research finds a future date.
- Resolver precedence must be stable at date boundaries and ignore cancelled/declined bookings and needs-review facts.
- Expected facts must never appear in Schedule, Calendar, Map, route planning, or manager operations.
- Batch runs must resume safely after process restart and avoid duplicate work.
- Evidence, status, source, and verification timestamps must remain visible and auditable.
- Coverage counts and filters must agree with the row results.
- Public research must be bounded, rate-limited, and explicitly started.

---

### Task 1: Persist event-date facts and coverage jobs

**Files:**

- Create: **lib/db/src/event-date-coverage-schema.ts**
- Modify: **lib/db/src/index.ts**
- Modify: **lib/db/src/drizzle-schema.ts**
- Create: **lib/db/src/event-date-coverage-schema.test.ts**
- Create: **lib/db/migrations/20260921_event_date_coverage.sql**
- Modify: **lib/db/src/migrations.ts**
- Modify: **lib/db/src/run-migrations.ts** only if its exported migration contract requires explicit registration
- Test: **lib/db/src/event-date-coverage-schema.test.ts**

- [ ] Write a failing schema contract test that imports the new tables from the public DB package and asserts the required columns, status checks, foreign keys, and indexes.

~~~ts
import { describe, expect, it } from "vitest";
import {
  eventDateCoverageItems,
  eventDateCoverageRuns,
  eventDateFacts,
} from "./event-date-coverage-schema";

describe("event date coverage schema", () => {
  it("exports fact and resumable job tables", () => {
    expect(eventDateFacts.organizationId).toBeDefined();
    expect(eventDateFacts.startsOn).toBeDefined();
    expect(eventDateFacts.supersededById).toBeDefined();
    expect(eventDateCoverageRuns.status).toBeDefined();
    expect(eventDateCoverageItems.organizationId).toBeDefined();
  });
});
~~~

- [ ] Run **pnpm --filter @workspace/db test -- event-date-coverage-schema.test.ts** and confirm it fails because the schema does not exist.
- [ ] Define **eventDateFacts** with organization, date range, confirmed/expected/needs_review status, recurrence rule JSON, rationale, source kind, source label/URL/internal pointers, researched/verified timestamps, active flag, supersession link, creator, and timestamps.
- [ ] Define **eventDateCoverageRuns** and **eventDateCoverageItems** with queued/researching/complete/needs_review/failed/skipped states, batch metadata, attempts, error detail, lease timestamps, and a run-plus-organization uniqueness constraint.
- [ ] Add a partial unique index enforcing one active fact per organization and indexes for effective-date lookup, run status, and lease recovery.
- [ ] Export and register the schema in **index.ts** and **drizzle-schema.ts**.
- [ ] Add an idempotent SQL migration using **CREATE TABLE IF NOT EXISTS**, named checks, safe index creation, and an explicit migration marker in **migrations.ts**.

~~~sql
CREATE UNIQUE INDEX IF NOT EXISTS event_date_facts_one_active_per_org
  ON event_date_facts (organization_id)
  WHERE active = true;
~~~

- [ ] Add a PGlite migration test that runs the migration twice and proves existing organizations and bookings are unchanged.
- [ ] Run **pnpm --filter @workspace/db test -- event-date-coverage-schema.test.ts** and the migration test; confirm both pass.
- [ ] Commit: **feat(db): add event date coverage persistence**

---

### Task 2: Implement the effective-date resolver and recurrence calculator

**Files:**

- Create: **artifacts/api-server/src/features/event-date-coverage/event-date-types.ts**
- Create: **artifacts/api-server/src/features/event-date-coverage/effective-event-date.ts**
- Create: **artifacts/api-server/src/features/event-date-coverage/effective-event-date.test.ts**
- Create: **artifacts/api-server/src/features/event-date-coverage/recurrence-date.ts**
- Create: **artifacts/api-server/src/features/event-date-coverage/recurrence-date.test.ts**

- [ ] Write failing table-driven tests for booking precedence, confirmed-over-expected precedence, earliest-date selection, exclusion of needs-review, cancellation handling, and today-as-future behavior.

~~~ts
expect(resolveEffectiveEventDate({
  today: "2026-09-21",
  bookings: [{ id: "booking-1", startsOn: "2026-10-03", endsOn: null, status: "confirmed" }],
  facts: [{ id: "fact-1", startsOn: "2026-09-28", endsOn: null, status: "confirmed", active: true }],
})).toEqual({
  startsOn: "2026-10-03",
  endsOn: null,
  displayStatus: "booked",
  sourceId: "booking-1",
});
~~~

- [ ] Run **pnpm --filter @workspace/api-server test -- effective-event-date.test.ts recurrence-date.test.ts** and confirm missing-module failures.
- [ ] Implement these shared contracts:

~~~ts
export type EffectiveEventDate = {
  startsOn: string;
  endsOn: string | null;
  displayStatus: "booked" | "confirmed" | "expected";
  sourceId: string;
};

export function resolveEffectiveEventDate(input: {
  today: string;
  bookings: BookingDateInput[];
  facts: EventDateFactInput[];
}): EffectiveEventDate | null;
~~~

- [ ] Implement deterministic recurrence calculation for supported rules such as annual month/day and ordinal weekday/month. Return a needs-review result for ambiguous rules or invalid dates instead of guessing.
- [ ] Add leap-year, year-rollover, multi-day range, and invalid-rule tests. Assert no Date parsing shifts a date-only value.
- [ ] Run the targeted tests and **pnpm --filter @workspace/api-server typecheck**; confirm green.
- [ ] Commit: **feat(api): resolve effective profile event dates**

---

### Task 3: Add the fact repository and wire profile read models

**Files:**

- Create: **artifacts/api-server/src/features/event-date-coverage/event-date-repository.ts**
- Create: **artifacts/api-server/src/features/event-date-coverage/event-date-repository.pglite.test.ts**
- Modify: **artifacts/api-server/src/features/event-profiles/event-profile-repository.ts**
- Modify: **artifacts/adventure-zone/src/features/event-profiles/event-profile-repository.ts**
- Modify: **artifacts/api-server/src/features/organizations/organization-repository.ts**
- Modify: **artifacts/api-server/src/features/organizations/organization-repository.test.ts**
- Modify: **artifacts/api-server/src/features/organizations/organization-list-sort.ts**
- Modify: **artifacts/api-server/src/features/organizations/organization-list-sort.test.ts**

- [ ] Write failing repository tests proving create, transactional supersession, active lookup, history retention, and unique-active conflict handling.
- [ ] Write failing read-model tests showing a booked date wins, then confirmed, then expected, and a missing effective date remains null.
- [ ] Run the targeted API tests and confirm failures.
- [ ] Implement repository methods with a transaction and row lock:

~~~ts
export interface EventDateRepository {
  listFacts(organizationId: string): Promise<EventDateFact[]>;
  listActiveFacts(organizationIds: string[]): Promise<Map<string, EventDateFact[]>>;
  supersedeActiveFact(input: NewEventDateFact): Promise<EventDateFact>;
  markNeedsReview(input: NeedsReviewFact): Promise<EventDateFact>;
}
~~~

- [ ] Extend the API and frontend event-profile contracts with **effectiveEventDate** and **eventDateFacts**, without converting facts into bookings.
- [ ] Update organization list queries to fetch facts in bulk and resolve dates without N+1 queries. Sort by the resolved date while preserving the existing stable tie-breaker.
- [ ] Run repository/read-model tests plus **pnpm --filter @workspace/api-server typecheck** and **pnpm --filter @workspace/adventure-zone typecheck**.
- [ ] Commit: **feat(profiles): expose effective event date facts**

---

### Task 4: Make profile research produce safe date candidates

**Files:**

- Modify: **artifacts/api-server/src/features/profile-research/profile-research-types.ts**
- Modify: **artifacts/api-server/src/features/profile-research/profile-research-provider.ts**
- Modify: **artifacts/api-server/src/features/profile-research/openai-profile-research-provider.ts**
- Modify: **artifacts/api-server/src/features/profile-research/openai-profile-research-provider.test.ts**
- Modify: **artifacts/api-server/src/features/profile-research/profile-research-context.ts**
- Modify: **artifacts/api-server/src/features/profile-research/profile-research-context.test.ts**
- Modify: **artifacts/api-server/src/features/profile-research/profile-research-service.ts**
- Modify: **artifacts/api-server/src/features/profile-research/profile-research-service.test.ts**
- Modify: **artifacts/api-server/src/features/profile-research/profile-research-apply.ts**
- Modify: **artifacts/api-server/src/features/profile-research/profile-research-apply.contract.test.ts**

- [ ] Write a failing regression test reproducing the current hazard: a profile has only a past booking, research returns a future event date, and applying it must leave the booking byte-for-byte unchanged while creating a fact.
- [ ] Write failing provider tests for an explicit **EventDateCandidate** with exact/recurring/ambiguous evidence, date range, source, rationale, and confidence.
- [ ] Run the profile-research test group and confirm the new assertions fail.
- [ ] Add the first-class provider contract:

~~~ts
export type EventDateCandidate = {
  startsOn: string | null;
  endsOn: string | null;
  evidenceKind: "published_exact" | "recognized_recurrence" | "ambiguous";
  recurrenceRule: EventRecurrenceRule | null;
  rationale: string;
  source: ResearchSource;
  confidence: number;
};
~~~

- [ ] Update prompts and structured parsing so the provider reports source-backed candidates but never decides a recurrence-computed date.
- [ ] Update context building so **next_event_dates** is satisfied by an effective future booking or fact, not merely by any historical booking.
- [ ] Route event-date candidates to the event-date repository. Remove event dates from the generic booking-field target fallback so a null booking target can never select **profile.bookings[0]**.
- [ ] Apply exact published dates as confirmed facts, recognized recurrence calculations as expected facts, and ambiguous/conflicting evidence as needs-review facts.
- [ ] Run all profile-research tests and typecheck.
- [ ] Commit: **fix(research): store future dates without rewriting bookings**

---

### Task 5: Audit internal evidence before public research

**Files:**

- Create: **artifacts/api-server/src/features/event-date-coverage/internal-event-date-evidence.ts**
- Create: **artifacts/api-server/src/features/event-date-coverage/internal-event-date-evidence.test.ts**
- Create: **artifacts/api-server/src/features/event-date-coverage/coverage-repository.ts**
- Create: **artifacts/api-server/src/features/event-date-coverage/coverage-repository.pglite.test.ts**
- Modify: **artifacts/api-server/src/features/profile-research/profile-research-history-clues.ts**
- Modify: **artifacts/api-server/src/features/profile-research/profile-research-source-library.ts**

- [ ] Write failing tests with evidence in past/future bookings, activity notes, emails, source documents, ACT/import records, attendance history, and prior research sources.
- [ ] Write failing conflict tests where two internal sources disagree and where an internal exact date conflicts with a recurrence expectation.
- [ ] Run targeted tests and confirm failures.
- [ ] Implement a normalized evidence result with stable source pointers and provenance:

~~~ts
export type InternalEventDateEvidence = {
  startsOn: string;
  endsOn: string | null;
  evidenceKind: "booking" | "published_exact" | "recurrence_clue";
  sourceKind: "internal";
  sourceType: string;
  sourceId: string;
  sourceLabel: string;
  excerpt: string | null;
};
~~~

- [ ] Resolve a future booking immediately as booked; create a confirmed fact only from unambiguous non-booking internal evidence; create expected facts only through the recurrence calculator; send conflicts to needs review.
- [ ] Implement coverage summary/list queries with status filters, text search, pagination, and counts derived from the same resolver used for rows.
- [ ] Prove with a query-count test that a 100-row page does not perform per-profile lookups.
- [ ] Run targeted tests and typecheck.
- [ ] Commit: **feat(coverage): audit internal event date evidence**

---

### Task 6: Add resumable owner-triggered batch research

**Files:**

- Create: **artifacts/api-server/src/features/event-date-coverage/coverage-job-repository.ts**
- Create: **artifacts/api-server/src/features/event-date-coverage/coverage-job-repository.pglite.test.ts**
- Create: **artifacts/api-server/src/features/event-date-coverage/coverage-worker.ts**
- Create: **artifacts/api-server/src/features/event-date-coverage/coverage-worker.test.ts**
- Create: **artifacts/api-server/src/features/event-date-coverage/worker-loop.ts**
- Create: **artifacts/api-server/src/routes/event-date-coverage.ts**
- Create: **artifacts/api-server/src/routes/event-date-coverage.test.ts**
- Modify: **artifacts/api-server/src/routes/index.ts**
- Modify: **artifacts/api-server/src/index.ts** only where existing background loops are started

- [ ] Write failing job tests for default batch size 25, explicit selection, deduplication, lease acquisition, stale-lease recovery, retry ceiling, resume after restart, and cancellation/skipping.
- [ ] Write failing worker tests proving internal evidence runs first and the web provider is called only when the profile remains unresolved.
- [ ] Write failing route tests for owner authorization, Zod validation, list/detail/run/retry/review actions, and rate-limit responses.
- [ ] Run targeted tests and confirm failures.
- [ ] Implement atomic claim semantics using **FOR UPDATE SKIP LOCKED**, lease expiry, bounded exponential backoff, and persisted attempt/error fields.
- [ ] Reuse the existing profile-research provider and saved-source machinery; do not create a second web-research implementation.
- [ ] Add endpoints:

~~~text
GET    /api/event-date-coverage/summary
GET    /api/event-date-coverage/profiles
GET    /api/event-date-coverage/profiles/:organizationId
POST   /api/event-date-coverage/runs
GET    /api/event-date-coverage/runs/:runId
POST   /api/event-date-coverage/items/:itemId/retry
POST   /api/event-date-coverage/facts/:factId/review
~~~

- [ ] Start the loop through the API server’s established worker lifecycle and ensure shutdown stops polling cleanly.
- [ ] Run route, worker, repository, and typecheck suites.
- [ ] Commit: **feat(coverage): add resumable date research jobs**

---

### Task 7: Build the Event Date Coverage admin tool

**Files:**

- Create: **artifacts/adventure-zone/src/pages/EventDateCoveragePage.tsx**
- Create: **artifacts/adventure-zone/src/pages/event-date-coverage-page.test.tsx**
- Create: **artifacts/adventure-zone/src/features/event-date-coverage/event-date-coverage-api.ts**
- Create: **artifacts/adventure-zone/src/features/event-date-coverage/event-date-coverage-api.test.ts**
- Create: **artifacts/adventure-zone/src/features/event-date-coverage/event-date-status-badge.tsx**
- Modify: **artifacts/adventure-zone/src/App.tsx**

- [ ] Write failing UI tests for summary totals, Booked/Confirmed/Expected/Needs review/Date not found filters, search, row selection, default 25-profile run, progress polling, retry, review, and source-detail disclosure.
- [ ] Write a route/navigation test proving the Admin Tools card links to **/settings/event-date-coverage** and the owner-protected route renders.
- [ ] Run **pnpm --filter @workspace/adventure-zone test -- event-date-coverage** and confirm failures.
- [ ] Implement typed fetch functions and query keys for summary, rows, run state, retry, and review.
- [ ] Build the page with one canonical coverage table, compact summary cards, bulk selection, explicit “Research selected” and “Research next 25” controls, and a details panel showing rationale and clickable public sources or internal record pointers.
- [ ] Poll only while a run has active items; invalidate summary and row queries as items settle.
- [ ] Add accessible status text in addition to badge color and preserve filters in the URL.
- [ ] Run targeted UI tests, frontend typecheck, and frontend build.
- [ ] Commit: **feat(admin): add event date coverage workspace**

---

### Task 8: Show effective dates on profiles, lists, CSV, and assistant context

**Files:**

- Modify: **artifacts/adventure-zone/src/components/profiles/profile-at-a-glance.tsx**
- Create: **artifacts/adventure-zone/src/components/profiles/profile-at-a-glance.test.tsx**
- Modify: **artifacts/adventure-zone/src/components/organizations/organization-list.tsx**
- Modify: **artifacts/api-server/src/features/organizations/profile-csv.ts**
- Modify: **artifacts/api-server/src/features/organizations/profile-csv.test.ts**
- Modify: **artifacts/api-server/src/features/assistant/profile-context-repository.ts**
- Modify: the nearest existing assistant profile-context test beside that repository

- [ ] Write failing component tests showing “Booked”, “Confirmed”, and “Expected” labels, date ranges, “Date not found”, and an evidence link/details affordance.
- [ ] Write failing CSV tests for **Next event date** and **Next event status** columns.
- [ ] Write a failing assistant-context test proving the effective date and confidence status are included without describing an expected date as booked.
- [ ] Run the targeted tests and confirm failures.
- [ ] Replace the client-side booking-only calculation in **profile-at-a-glance.tsx** with the server-resolved **effectiveEventDate** contract.
- [ ] Render the same status vocabulary on organization cards/list rows and keep date-only formatting UTC-safe.
- [ ] Extend CSV and assistant context with resolved date, range, status, rationale, and source reference where appropriate.
- [ ] Run targeted suites and both API/frontend typechecks.
- [ ] Commit: **feat(profiles): display sourced next event dates**

---

### Task 9: Lock down operational isolation and complete verification

**Files:**

- Create: **artifacts/api-server/src/features/event-date-coverage/operational-isolation.test.ts**
- Modify: existing schedule/calendar/map/route repository tests nearest to their implementations
- Modify: **docs/superpowers/specs/2026-09-21-event-date-coverage-design.md** only if implementation reveals an approved contract correction
- Create: **docs/superpowers/reports/2026-09-21-event-date-coverage-verification.md**

- [ ] Write regression tests that seed one expected fact with no booking and assert it is absent from Schedule, operational calendar sync, map markers, route planning, manager operations, booking exports, and booking counts.
- [ ] Seed a real future booking for the same profile and assert those operational surfaces include only the booking.
- [ ] Run the isolation tests first and fix any accidental fact joins.
- [ ] Run all targeted feature tests:

~~~bash
pnpm --filter @workspace/db test
pnpm --filter @workspace/api-server test -- event-date-coverage profile-research organization-repository profile-csv
pnpm --filter @workspace/adventure-zone test -- event-date-coverage profile-at-a-glance
~~~

- [ ] Run repository-wide verification:

~~~bash
pnpm run typecheck
pnpm -r --if-present run test
pnpm -r --if-present run build
~~~

- [ ] Apply the migration twice to a disposable database snapshot containing historical bookings; record row counts and booking date checksums before and after.
- [ ] Manually verify in the browser: Admin Tools navigation, coverage counts/filters, a booked profile, a confirmed profile, an expected recurring profile, a needs-review conflict, a not-found profile, batch progress, retry, evidence links, and CSV export.
- [ ] Verify Schedule calendar and map contain no expected-only profile.
- [ ] Record commands, results, screenshots or route notes, migration evidence, and any deliberately deferred non-blocking findings in the verification report.
- [ ] Run the **superpowers:requesting-code-review** workflow, address findings, then rerun affected verification.
- [ ] Commit: **test(coverage): verify event date coverage end to end**
