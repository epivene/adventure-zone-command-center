# Route-aware outreach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Turn the approved route-aware outreach design into an integrated Booking workflow.
**Architecture:** A pure outreach policy and interval-aware capacity evaluator feed a persistent planning service, existing Today/profile surfaces, and commitment checks. Reuse existing source history, configured resources, and calendar evidence.
**Tech Stack:** TypeScript, Express, React, Drizzle/PostgreSQL, Vitest, PGlite.
**Spec:** docs/superpowers/specs/2026-09-09-route-aware-outreach-design.md

## Global Constraints

- No outgoing messages are sent by accepting or storing this design.
- Unknown historic tiers remain unclassified for review rather than being bulk relabeled.
- Missing facts do not count as qualified.
- A draft, scheduled-but-unsent message, or failed send does not start the sequence.
- Default first no-response follow-up day 3, second day 10, advancement day 15; retain full 3-day, 7-day, then 5-day stage waits after delayed attempts.
- Meaningful replies and explicit callback/decision dates pause generic no-response sequencing.
- Package and leg capacity are distinct; shared equipment and operational travel windows matter.
- Pinning changes work order, not capacity or contact restrictions.
- Preserve existing Early Bird, reply, callback, protected-contact, and manual follow-up behavior.
- Feature flag defaults off until rollout verification; no live bulk changes.
- Tests run locally against test data; no production database access or emails.
- New migrations are additive and idempotent.

## Task 1: Pure outreach and capacity policies

**Files:**
- Create: artifacts/api-server/src/features/outreach-planner/outreach-policy.ts
- Create: artifacts/api-server/src/features/outreach-planner/outreach-policy.test.ts
- Create: artifacts/api-server/src/features/outreach-planner/capacity-policy.ts
- Create: artifacts/api-server/src/features/outreach-planner/capacity-policy.test.ts

**Interfaces:**
Export the types and functions below. ISO date-only windows are inclusive. Stored instant strings must parse strictly; bad/missing inputs produce needs_review rather than usable availability.
```ts
export type OutreachTier = "dedicated" | "convention" | "strong" | "filler" | "unclassified";
export type OutreachAttempt = {
  id: string;
  occurredAt: string;
  stage: "initial" | "follow_up_1" | "follow_up_2";
  successful: boolean;
};
export type OutreachPolicyInput = {
  tier: OutreachTier;
  status: string;
  attempts: OutreachAttempt[];
  meaningfulReplyAt: string | null;
  decisionDueAt: string | null;
  conventionEndsOn: string | null;
  operationalStartsOn: string | null;
  blockedReason: string | null;
};
export type OutreachDecision = {
  state: "ready" | "waiting" | "follow_up" | "advance" | "reply" | "decision" | "closed" | "needs_review";
  dueAt: string | null;
  reason: string;
  nextStage: OutreachAttempt["stage"] | null;
};
export function evaluateOutreach(input: OutreachPolicyInput, now: Date): OutreachDecision;
export function compareOutreachPriority(
  left: { tier: OutreachTier; manualRank: number; id: string },
  right: { tier: OutreachTier; manualRank: number; id: string },
): number;

export type CapacityWindow = { startsOn: string; endsOn: string };
export type CapacityReservation = CapacityWindow & {
  id: string; canonicalId: string;
  legId: string | null; quantities: Record<string, number>;
  confidence: "verified" | "ambiguous";
};
export type CapacityInput = {
  window: CapacityWindow | null;
  legId: string | null;
  quantities: Record<string, number>;
  capacities: Record<string, number>;
  reservations: CapacityReservation[];
  evidenceVerified: boolean;
  travelVerified: boolean;
  excludeCanonicalId?: string | null;
};
export type CapacityDecision = { status: "fits" | "conflict" | "needs_review"; reasons: string[] };
export function evaluateCapacity(input: CapacityInput): CapacityDecision;
```

Requirements: Respect explicit blockers and closed statuses; booked is closed for pursuit. Interested/booking_in_progress/meaningful reply never advance through silence. Explicit decision date produces decision/waiting. No attempts produces ready, with convention due within two business days after convention. Use existing business timezone helpers for routine weekdays. Sequence only advances with successful initial then ordered successful follow_up_1 and follow_up_2 evidence, each chronologically later; duplicates by id do not multiply attempts. Future attempts and invalid dates require review. Delayed outreach must not instantly trigger the next chase: due date is the later of the cumulative day-3/day-10/day-15 target or the prior completed stage plus its full 3-day/7-day/5-day interval. At day 15 without completed follow-ups return overdue follow-up, not advance. Operational start within45 days adds a timeline review for untouched/no-response work rather than silently shortening the cadence; do not mask due reply/decision tasks. Unknown tier returns review for new pursuit. compare function uses tier then explicit manual rank then stable id.

Capacity: validate real calendar dates, positive integer requested quantities, nonnegative integer inventory. Missing leg/window/inventory/evidence/travel => review. Dedupe matching canonical reservations only if all relevant facts agree; contradictory mirrors => review. Skip excluded current booking. Check leg overlaps and each resource at interval breakpoints; two nonoverlapping bookings within requested window do not consume two simultaneous units. Ambiguous overlapping reservation blocks. Empty demand is review. Existing reservation malformed window/demand cannot silently disappear. Reservation leg null is review if relevant. The evaluator is pure and does not allocate or send.

- [x] Add behavior tests first:
```ts
expect(evaluateOutreach({ ...base, attempts: [initial] }, new Date("2026-09-30T18:00:00Z")).state).toBe("follow_up");
expect(evaluateOutreach({ ...base, attempts: [initial, first, second] }, new Date("2026-09-30T18:00:00Z")).state).toBe("advance");
expect(evaluateCapacity({ ...capacity, capacities: { az: 2 }, reservations: [earlyBooking, laterBooking] }).status).toBe("fits");
```
Define fixtures with verified inputs; cover every requirement above with meaningful behavior cases, including DST/business-date boundaries and canonical duplicates.
- [x] Run focused tests to establish red using existing API Vitest config.
- [x] Implement the exported interfaces with small helpers and no new dependencies.
- [x] Run focused tests and TypeScript checking for these files.
- [x] Commit only these four files and write report with exact tests and concerns.

## Task 2: Persist openings, candidates, evidence, and research work

**Files:**
- Create: lib/db/src/outreach-planner-schema.ts
- Modify: lib/db/src/index.ts, lib/db/src/drizzle-schema.ts, lib/db/package.json, artifacts/api-server/src/db/schema.ts, lib/db/src/migrations.ts
- Create: lib/db/migrations/20260909_outreach_planner.sql
- Create: artifacts/api-server/src/features/outreach-planner/outreach-repository.ts
- Create: artifacts/api-server/src/features/outreach-planner/outreach-service.ts
- Create: artifacts/api-server/src/features/outreach-planner/outreach-sources.ts
- Create: artifacts/api-server/src/features/outreach-planner/outreach-repository.pglite.test.ts
- Create: artifacts/api-server/src/routes/outreach-planner.ts
- Create: artifacts/api-server/src/routes/outreach-planner.test.ts
- Modify: artifacts/api-server/src/routes/index.ts

**Interfaces:** REST under /outreach-planner. GET / returns enabled, openings, candidates, researchTasks, leg/package configuration; POST /openings creates planning window, POST /candidates associates an existing opportunity, PATCH /candidates/:id changes tier/rank/decision, POST /candidates/:id/attempts records a logged call/outreach reference, POST /candidates/:id/advance releases pursuit only when policy permits, POST /openings/:id/research creates idempotent criteria task. Service uses evaluateOutreach and evaluateCapacity from Task1, never trusts a client supplied capacity result.

- [x] Inspect actual schema/source identifiers and expose strongly typed DTOs to the UI task.
- [x] Add migration with foreign keys, validated dates/year and nonnegative rank, unique opening/opportunity membership, unique evidence ids, and idempotent research task creation. Migration marker verifies all objects used by runtime.
- [x] Add PGlite lifecycle tests: save/load edits, candidate duplicate prevention, source replay, unknown profile, invalid dates, existing manual next-action preservation.
- [x] Implement repository with transactions for changes and audit activity. Return disabled state without querying new tables when flag is false.
- [x] Add convention attribution from explicit submissions; read successful sends and logged calls from actual source state, preserve meaningful replies. Do not manufacture send history.
- [x] Add service and validated routes behind existing owner authorization. Failed actions preserve state and return actionable 400/404/409; integration failures are needs_review.
- [x] Add source evidence adapter that reconciles booking/calendar/resource data, records check timestamps, and preserves unknowns.
- [x] Verify routes cannot be used by unauthenticated/leg-manager identities and feature flag gating works.
- [x] Commit and report.

## Task 3: Shared allocation and offer safety

**Files:**
- Create: artifacts/api-server/src/features/outreach-planner/outreach-allocation.ts
- Create: artifacts/api-server/src/features/outreach-planner/outreach-allocation.pglite.test.ts
- Modify: schema/migration/service/routes from Task2 for holds
- Modify: existing booking commitment and specific offer dispatch paths identified from call graph

**Interfaces:** createHold(candidateId, expiresAt, actor), releaseHold(holdId, actor), extendHold(holdId, expiresAt, actor), and evaluateCommitment(bookingId) use shared authoritative evidence. A hold has exact quantities, leg, operational dates, owner, expiry, and lifecycle state. Customer-specific offer references a live hold.

- [x] Trace every booking status write and email dispatch path before enforcement.
- [x] Write transactional allocation tests showing two contenders for the last resource yield one success, plus expiry/release/extension/conversion and self-exclusion.
- [x] Serialize overlapping allocation checks using database locking; re-read authoritative booking inventory and live holds inside transaction. Reconcile with external Calendar evidence before allocation, treating missing evidence as review.
- [x] Enforce available capacity on commitment paths and recheck specific offers immediately before dispatch. General exploratory outreach remains possible; no automatic sends added.
- [x] Invalidate affected planning evaluations when dates, assignments, resources, calendar sync, or hold lifecycle changes; preserve conversation history.
- [x] Ensure rollout flag keeps current behavior unchanged until enabled. No double-counting on hold-to-booking conversion.
- [x] Run focused source, dispatch, and allocation tests; commit and report.

## Task 4: Booking workspace and profile controls

**Files:**
- Create: artifacts/adventure-zone/src/features/outreach-planner/outreach-api.ts
- Create: artifacts/adventure-zone/src/components/today/outreach-planner.tsx
- Create: artifacts/adventure-zone/src/components/today/outreach-planner.test.tsx
- Modify: artifacts/adventure-zone/src/pages/TodayPage.tsx
- Modify: artifacts/adventure-zone/src/pages/EventProfilePage.tsx
- Modify: artifacts/api-server/src/features/today/master-work-queue-repository.ts as needed for ranked candidate work

**Interfaces:** Consume Task2 DTOs and allocation actions through existing apiGet/apiPost/apiPatch helpers. Today displays existing urgent work first, then eligible convention-first outreach and explicit waiting/research work.

- [x] Write interaction tests: create opening, classify/add existing opportunity, save decision date, log attempt, advance only when eligible, request research, show holds/conflicts.
- [x] Build mobile-friendly cards and forms with visible labels, disabled/busy actions, preserved form input on error, and no forced horizontal scrolling.
- [x] Show candidate year/tier, event dates, next action, real contact evidence, waiting reason and package/leg fit. Unverified capacity must never be styled as available.
- [x] Link full existing event profile with Today return context. Preserve current Today features and Early Bird card.
- [x] Add empty-state setup using real configured legs and packages. Unknown dates/tier remain reviewable. Do not seed fake business data.
- [x] Run React interaction tests and relevant existing Today tests.
- [x] Commit and report.

## Task 5: Integrated review and delivery

- [x] Verify migrations twice on isolated PGlite and targeted domain/API/UI tests.
- [x] Typecheck modified units; build production bundles where complete dependency graph is available. Record baseline failures separately.
- [x] Inspect diff for unrelated changes, permissions, stale evidence and duplicate writes.
- [x] Create a reviewable feature branch/PR with precise tested scope and rollout instructions.
- [x] Report actual completion and any unverified live behavior. No production data mutation or external communication.


## Task 3 dependency slices

Task3 is implemented and reviewed in three sequential slices because it spans independent source, mutation, and dispatch boundaries. All original Task3 requirements remain binding; Task3 is not complete until all slices pass.
- 3A: Shared authoritative evidence projection, persisted exact candidate demand, expiring holds/global mutex, owner API. Holds-only concurrency/lifecycle/self-exclusion. Production enforcement is incomplete until3B/3C.
- 3B: Shared transactional enforcement across every booking/capacity writer, external fact reconciliation, invalidation/backstop, hold-to-booking conversion. Test hold-versus-booking and commitment-edit races.
- 3C: Explicit content-bound offer intent and dispatch claims at opportunity and office coordinators. Scheduled/retry paths, editing invalidation, livehold/content/identity/expiry checks, outcome reconciliation; preserve general exploratory contact and EarlyBird.

Full rollout stays disabled throughout implementation and review.

## Task 4 dependency slices

- [x] 4A: Complete backend contracts for audited snooze/cadence, safe profile/year admission, shared-resource pursuit priority, qualified research results, named recovery catalogs and existing contact blocks.
- [x] 4B: Integrate reviewed contracts into Today, profile and actual owner draft-review screens; verify mobile interactions and preserve current urgent work and Early Bird behavior.
- [x] 4C: Add explicit owner-confirmed binding of an undated, unlinked opportunity to its verified matching event, preserving existing linked-event identity and history.

Task 4 is complete only after all three slices pass review. Task 3A–3C are reviewed complete; the final feature review also covers their integration with Task 4.
