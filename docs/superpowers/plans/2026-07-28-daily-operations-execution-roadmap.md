# Daily Operations Foundation Execution Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the three approved Phase 1 implementation plans in a safe order, integrate their shared boundaries, and resolve all validated safety and review findings before the pull request is ready.

**Architecture:** Work proceeds sequentially by subsystem so schema migrations and shared files cannot collide. Each task uses a fresh implementation agent followed by specification and code-quality reviews. Cross-system data reaches Today and the Call Workspace through `BookingOperationsSummaryProvider`, `TransferTimeLookup`, and the existing repository/service boundaries.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Drizzle/PostgreSQL, Clerk, Zod 4, MapLibre, Google Routes API v2, Vitest, Testing Library, Playwright, Render.

## Global Constraints

- Execute migrations sequentially: CRM `0006`, packages/resources `0007`, routes/trips `0008`.
- Never run schema-writing tasks from separate plans concurrently.
- Use a fresh implementation subagent for each numbered task and two-stage review before continuing.
- Preserve existing Act! identities, imported contacts, bookings, follow-ups, travel-leg IDs, and audit history.
- No automatic Act!, phone, email, or calendar effects.
- Google Routes calls occur only from explicit Estimate/Refresh actions and use cached results.
- No production deployment or pull-request readiness claim occurs until full tests, security review, and code review pass.
- Every validated safety issue is fixed and rechecked before the pull request is marked ready.

---

### Task 1: Establish the verified baseline

**Files:**

- Read: `docs/superpowers/specs/2026-07-28-daily-operations-foundation-design.md`
- Read: all three plans linked below
- Modify only if already failing: the exact test or source file responsible

**Interfaces:**

- Produces: a clean baseline commit and recorded passing command set

- [ ] **Step 1: Confirm branch and worktree state**

Run:

```bash
git status --short
git branch --show-current
git log -5 --oneline
```

Expected: only approved plan/spec changes are present before the planning commit;
implementation starts from a clean worktree afterward.

- [ ] **Step 2: Run the baseline suite**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Expected: PASS. If an existing failure appears, isolate and fix it in a separate
baseline commit before feature work.

- [ ] **Step 3: Record baseline**

```bash
git status --short
```

Expected: clean.

### Task 2: Execute CRM and Call Workspace

**Files:**

- Plan: `docs/superpowers/plans/2026-07-28-crm-call-workspace.md`

**Interfaces:**

- Produces: activities, Last Resort, organization/contact follow-ups, normalized
  caller matching, Quick Add, Call Workspace, and initial
  `BookingOperationsSummaryProvider` consumption

- [ ] **Step 1: Execute Tasks 1–7 from the CRM plan in order**

Use one fresh implementation subagent per task. After each task, run the listed
focused tests and inspect its commit.

- [ ] **Step 2: Run two-stage review after every task**

First review specification compliance against the CRM plan. Then review code
quality, authorization, transaction boundaries, audit coverage, and regression
risk. Fix findings before the next task.

- [ ] **Step 3: Run the CRM plan's full verification**

Run exactly the final verification commands in the CRM plan and require PASS.

### Task 3: Execute packages and resources

**Files:**

- Plan: `docs/superpowers/plans/2026-07-28-packages-resources.md`

**Interfaces:**

- Consumes: CRM migration `0006` and Call Workspace summary port
- Produces: migration `0007`, package/resource services, booking editors,
  resource warnings, and real `BookingOperationsSummaryProvider`

- [ ] **Step 1: Execute Tasks 1–6 from the package/resource plan in order**

Use one fresh implementation subagent per task. Never edit or regenerate
migration `0006`.

- [ ] **Step 2: Run two-stage review after every task**

Review specification compliance first. Then review physical-count correctness,
attribution uniqueness, approval rules, conflict fingerprints, transactions,
authorization, and audit coverage.

- [ ] **Step 3: Verify call and Today integration**

Confirm package labels, shared totals, pending requests, and resource warnings
appear through `BookingOperationsSummaryProvider`, without package-table queries
inside call or Today components.

- [ ] **Step 4: Run the package/resource plan's full verification**

Run exactly the final verification commands in the package/resource plan and
require PASS.

### Task 4: Execute legs, trips, routes, and fuel

**Files:**

- Plan: `docs/superpowers/plans/2026-07-28-legs-trips-routes-fuel.md`

**Interfaces:**

- Consumes: migrations `0006`/`0007`, resources, summary provider, and transfer
  lookup port
- Produces: migration `0008`, configurable legs, trips, route cache/provider,
  fuel breakdown, trip resource assignments, and routed transfer warnings

- [ ] **Step 1: Execute Tasks 1–7 from the routes/fuel plan in order**

Use one fresh implementation subagent per task. Never edit or regenerate
migrations `0006` or `0007`.

- [ ] **Step 2: Run two-stage review after every task**

Review specification compliance first. Then review historical-data
preservation, route immutability, cache keys, provider cost controls, secret
handling, arithmetic/rounding, resource-warning wiring, authorization, and
audit coverage.

- [ ] **Step 3: Verify operational integration**

Confirm trip/resource transfers use `TransferTimeLookup`; booking, Call
Workspace, and Today receive route/fuel warnings through the shared summary;
Google is never called on page load.

- [ ] **Step 4: Run the routes/fuel plan's full verification**

Run exactly the final verification commands in the routes/fuel plan and require
PASS.

### Task 5: Run cross-system acceptance and migration rehearsal

**Files:**

- Modify only when a failing acceptance test identifies an exact defect
- Verify: `docs/operations/daily-operations-migration.md`
- Verify: `docs/operations/routes-migration.md`
- Verify: `docs/operations/backup-and-restore.md`

**Interfaces:**

- Consumes: all Phase 1 modules
- Produces: one verified release candidate

- [ ] **Step 1: Rehearse database upgrade on a disposable restored backup**

Run the documented preflight/migration/seed sequence. Verify record counts and
stable IDs before/after for contacts, organizations, bookings, follow-ups, Act!
links, audits, and the original four legs. Verify Legs 5–9 and the three package
templates/paintball resource are added once.

- [ ] **Step 2: Run complete automated verification**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e
```

Expected: PASS with no skipped new Phase 1 acceptance scenarios.

- [ ] **Step 3: Manually verify the approved daily flow**

Verify:

1. Today → overdue call → Call Workspace → note/result/next action.
2. Unknown caller → Quick Add → organization/contact/activity.
3. Last Resort reason inherited across the organization.
4. Adventure Zone + Weekend Warriors → 11 physical attractions, not 15.
5. Paintball conflict and reasoned override.
6. Nine legs → add/reorder/archive/restore.
7. Trip → suggested/manual order → confirm → refresh without reorder.
8. Segment and total mileage/time/gallons/cost with source labels.
9. Manual mileage remains usable with Google key absent.

- [ ] **Step 4: Commit only exact acceptance fixes**

```bash
git add -u
git add tests features app components db docs scripts
git commit -m "fix: resolve daily operations integration defects"
```

Skip the commit when no fixes were needed.

### Task 6: Complete safety, security, and pull-request review

**Files:**

- Review: all changes since the pre-Phase-1 baseline
- Modify: only files required to resolve validated findings

**Interfaces:**

- Produces: reviewed pull-request head with no unresolved validated safety issue

- [ ] **Step 1: Run a security diff scan**

Use `codex-security:security-diff-scan` against the full Phase 1 diff. Require
special attention to owner authorization, server-only Act!/Google credentials,
route/contact privacy, input validation, SQL constraints, transaction
atomicity, audit payloads, error sanitization, and accidental external effects.

- [ ] **Step 2: Fix and validate every confirmed security finding**

For each finding, add or strengthen a test that fails before the fix, implement
the smallest correction, rerun the focused test, and rerun the security
validation. Do not dismiss a finding without evidence.

- [ ] **Step 3: Request independent code review**

Use `superpowers:requesting-code-review` and the configured code-review tool for
the full Phase 1 diff. Resolve correctness, maintainability, accessibility,
performance, migration, and test-coverage findings.

- [ ] **Step 4: Run final verification after all fixes**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e
git diff --check
git status --short
```

Expected: every command passes and the worktree is clean.

- [ ] **Step 5: Update the pull request**

Push the reviewed branch, update the pull-request summary with migrations,
configuration, tests, manual verification, security review, and rollback
instructions, then mark it ready only after all checks are green. Do not merge
without the user's instruction.
