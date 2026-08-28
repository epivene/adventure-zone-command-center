# Qualified Potential Leg Auto-Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically suggest or assign the best travel leg for qualified potentials while preserving prior-year ownership, route feasibility, workload balance, manual overrides, and 8+ hour travel warnings.

**Architecture:** Add a focused leg-assignment domain/service that evaluates only qualified potentials. It reads event history and confirmed route blocks, filters out infeasible legs, prioritizes prior-year ownership, then scores remaining legs using workload balance and route fit; the result is persisted as a suggestion/assignment with an explanation and warning metadata surfaced in event profiles and route views.

**Tech Stack:** TypeScript, Express 5, PostgreSQL/Drizzle, React/Vite/Wouter, TanStack Query, Vitest/Supertest.

**Spec:** `docs/superpowers/specs/2026-08-28-leg-auto-assignment-and-david-calendar-sync-design.md`

## Global Constraints

- Cold/new outreach does not require a leg and must not trigger assignment.
- Assignment begins only after a lead becomes a qualified potential.
- Confirmed bookings must have a leg.
- Same event handled by the same active leg last year gets first priority when still feasible.
- A candidate leg normally needs roughly 3–4 days of operational breathing room around the reserved block.
- Workload balance counts distinct confirmed events, not package rows.
- Driving fit is a tiebreaker after feasibility and workload balance.
- Under 8 hours is normal; 8–12 hours is `Long travel`; over 12 hours is `Major travel concern`.
- Unrealistic travel/setup gaps make a leg ineligible instead of merely warning.
- Ambiguous results become `Needs leg assignment` rather than a guess.
- Manual assignment is authoritative and must not be overwritten automatically.

---

### Task 1: Define assignment result and persistence contract

**Files:**
- Create: `artifacts/api-server/src/features/leg-assignment/leg-assignment-domain.ts`
- Create: `artifacts/api-server/src/features/leg-assignment/leg-assignment-domain.test.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `artifacts/api-server/src/db/schema.ts`
- Create migration for assignment suggestion metadata if existing booking columns are insufficient.

**Interfaces:**
- Produces:
```ts
export type LegAssignmentWarning = "long_travel" | "major_travel_concern";
export type LegAssignmentDecision = {
  bookingId: string;
  assignedLegId: string | null;
  suggestedLegId: string | null;
  source: "prior_year" | "route_score" | "manual" | "needs_review";
  explanation: string;
  warning: LegAssignmentWarning | null;
  previousStopDriveMinutes: number | null;
  nextStopDriveMinutes: number | null;
  confidence: "high" | "medium" | "low";
};
```

- [ ] **Step 1: Write failing domain tests** for warning thresholds, manual-authority precedence, and `needs_review` shape.
- [ ] **Step 2: Run:** `pnpm --filter @workspace/api-server exec vitest run src/features/leg-assignment/leg-assignment-domain.test.ts` and verify RED.
- [ ] **Step 3: Implement the exact result types/helpers** and any minimal schema/migration fields needed to persist suggestion source, explanation, warning, and confidence separately from authoritative `travelLegId`.
- [ ] **Step 4: Run the test and schema/typecheck**; expected PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: add leg assignment decision contract"`.

---

### Task 2: Build qualification trigger

**Files:**
- Create: `artifacts/api-server/src/features/leg-assignment/qualification.ts`
- Create: `artifacts/api-server/src/features/leg-assignment/qualification.test.ts`
- Modify the existing booking/event-profile status-update route/service that transitions lead statuses.

**Interfaces:**
- Produces:
```ts
export function shouldEvaluateLegAssignment(input: {
  previousStatus: string | null;
  nextStatus: string;
  manuallyAssignedLegId: string | null;
}): boolean;
```

- [ ] **Step 1: Write tests** proving `new_lead`, `researching`, and first-contact-only states do not trigger; `interested`, `quote_sent`, `pending_decision`, `pending_contract`, and confirmed-like qualified states do; manual assignments skip auto-overwrite.
- [ ] **Step 2: Run focused test and verify RED.**
- [ ] **Step 3: Implement qualification mapping using existing canonical booking statuses.**
- [ ] **Step 4: Wire the status transition to enqueue/call leg evaluation only when `shouldEvaluateLegAssignment` returns true.**
- [ ] **Step 5: Run route/service tests and commit:** `git commit -m "feat: trigger leg evaluation for qualified potentials"`.

---

### Task 3: Load prior-year ownership and confirmed route context

**Files:**
- Create: `artifacts/api-server/src/features/leg-assignment/leg-assignment-repository.ts`
- Create: `artifacts/api-server/src/features/leg-assignment/leg-assignment-repository.pglite.test.ts`
- Reuse canonical travel-leg and event-family/profile tables.

**Interfaces:**
- Produces:
```ts
export type AssignmentCandidateContext = {
  legId: string;
  legName: string;
  priorYearMatch: boolean;
  confirmedEventCount: number;
  previousStop: RouteStop | null;
  nextStop: RouteStop | null;
};

export class LegAssignmentRepository {
  loadCandidateContexts(bookingId: string): Promise<AssignmentCandidateContext[]>;
}
```

- [ ] **Step 1: Seed tests** with one event family attended last season, multiple package rows for one confirmed event, and active/inactive legs.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement queries** so prior-year ownership is based on the same event profile/family, workload dedupes package rows to one event, archived legs are excluded, and surrounding stops come only from confirmed operational bookings.
- [ ] **Step 4: Run PGlite tests.**
- [ ] **Step 5: Commit:** `git commit -m "feat: load route context for leg assignment"`.

---

### Task 4: Add feasibility and travel-time evaluation

**Files:**
- Create: `artifacts/api-server/src/features/leg-assignment/leg-feasibility.ts`
- Create: `artifacts/api-server/src/features/leg-assignment/leg-feasibility.test.ts`
- Reuse the existing route/directions adapter used by route suggestions where possible.

**Interfaces:**
- Produces:
```ts
export type FeasibilityResult = {
  eligible: boolean;
  previousDriveMinutes: number | null;
  nextDriveMinutes: number | null;
  availableBeforeMinutes: number | null;
  availableAfterMinutes: number | null;
  warning: LegAssignmentWarning | null;
  reason: string;
};

export async function evaluateLegFeasibility(input: {...}): Promise<FeasibilityResult>;
```

- [ ] **Step 1: Write tests** for 7h59 normal, 8h long travel, 12h+ major concern, 8h with several open days eligible, same 8h with insufficient travel/setup window ineligible, and missing location returning ineligible/reviewable rather than guessing.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement the evaluator** using the full operational reserved block and actual driving minutes.
- [ ] **Step 4: Run tests.**
- [ ] **Step 5: Commit:** `git commit -m "feat: evaluate leg travel feasibility"`.

---

### Task 5: Score and choose a leg

**Files:**
- Create: `artifacts/api-server/src/features/leg-assignment/leg-assignment-service.ts`
- Create: `artifacts/api-server/src/features/leg-assignment/leg-assignment-service.test.ts`

**Interfaces:**
- Consumes: repository contexts + feasibility results.
- Produces:
```ts
export class LegAssignmentService {
  evaluate(bookingId: string): Promise<LegAssignmentDecision>;
}
```

- [ ] **Step 1: Write tests** proving prior-year leg wins when feasible, impossible prior-year leg falls back, lowest distinct-event workload wins among feasible legs, route fit breaks close workload ties, close/insufficient evidence yields `needs_review`, and manual `travelLegId` remains unchanged.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement deterministic scoring** with previous-year priority first, feasibility hard filter second, workload ranking third, route fit fourth, and an explicit ambiguity threshold producing `needs_review`.
- [ ] **Step 4: Persist suggestion metadata and auto-assign only high-confidence decisions; medium/low remain suggestions.**
- [ ] **Step 5: Run tests and commit:** `git commit -m "feat: recommend balanced travel legs"`.

---

### Task 6: Surface suggestions and manual override in event profiles

**Files:**
- Modify: `artifacts/api-server/src/routes/event-profiles.ts`
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-form.tsx`
- Add focused frontend tests near the event-profile form.

**Interfaces:**
- API profile projection adds `legAssignment` with decision metadata from Task 1.

- [ ] **Step 1: Write API/frontend tests** for `Suggested: Hulk`, prior-year explanation, long-travel badge, `Needs leg assignment`, and manual override.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Add API projection and UI** showing assigned leg, suggested leg, explanation, warning, and editable selector.
- [ ] **Step 4: Ensure a manual change records source `manual` and prevents later auto-overwrite.**
- [ ] **Step 5: Run tests and commit:** `git commit -m "feat: show and override leg suggestions"`.

---

### Task 7: Add route/map warning visibility and regression coverage

**Files:**
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/manager-route-map-layers.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.test.tsx`

- [ ] **Step 1: Write tests** proving qualified potentials may show with their assigned/suggested leg, remain visually potential, never enter confirmed route-line geometry, and 8+ hour warnings are visible without changing confirmed status.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Add warning/suggestion display while preserving current confirmed-only route line generation.**
- [ ] **Step 4: Run Leaflet/route suite.**
- [ ] **Step 5: Commit:** `git commit -m "feat: surface leg travel warnings on routes"`.

---

### Task 8: End-to-end verification

- [ ] Run `pnpm --filter @workspace/api-server exec vitest run src/features/leg-assignment`.
- [ ] Run route/event-profile API tests.
- [ ] Run frontend event-profile and route-map tests.
- [ ] Run API and frontend typechecks/builds used by `Calendar Route Handoff CI` and `Office Coordinator CI`.
- [ ] Verify manually with fixtures representing Kristy/Hulk and a prior-year event.
- [ ] Commit any final test-only adjustments as `test: harden leg assignment workflow`.