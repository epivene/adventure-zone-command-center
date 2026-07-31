# Event Profiles and Five9 Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each event a unified profile, automatically consolidate safe Act! duplicates, and provide a Five9-style calling workspace integrated with Today and one creation flow.

**Architecture:** Keep normalized place/contact tables and relationship integrity in the database, then expose an event-profile read model that joins all event context into one route. Reuse the reviewed migration/apply queue for bulk-safe consolidation and durable decisions. Replace split booking/quick-add entry points with a single profile creation flow and deep-link Today cards into the workspace.

**Tech Stack:** Next.js App Router, React, TypeScript, Drizzle ORM/PostgreSQL, Vitest.

## Global Constraints

- Event profiles are per event/place and include all associated Contacts and Act! details.
- Exact normalized name + normalized location duplicates consolidate automatically.
- Keep all unique values and source provenance; preserve conflicts in history/notes.
- Safe exact/unchanged proposals are bulk-approved; only ambiguous proposals remain queued.
- Act! is read-only; apply writes only to Command Center and is idempotent.
- Today remains the dashboard; event profiles own call, note, follow-up, and booking actions.
- New booking and Quick add become one **New event profile** flow.

---

### Task 1: Build the event-profile read model and route

**Files:**
- Create: `features/event-profiles/event-profile-repository.ts`
- Create: `app/(private)/event-profiles/[profileId]/page.tsx`
- Create: `components/event-profiles/event-profile-workspace.tsx`
- Modify: `features/organizations/organization-repository.ts` only for shared query helpers
- Test: `tests/unit/event-profile-repository.test.ts`
- Test: `tests/unit/event-profile-workspace.test.tsx`

- [ ] Add failing tests for one profile returning place, all contacts, phones/emails, notes, groups, bookings, follow-ups, and source provenance.
- [ ] Implement a typed `EventProfile` read model with stable ordering and contact selection.
- [ ] Render a single profile workspace with event summary, contacts, call outcome, notes, follow-up, and booking context.
- [ ] Preserve `/organizations/:id` compatibility by redirecting or rendering the profile workspace.
- [ ] Run focused tests and typecheck; commit `feat: add unified event profile workspace`.

### Task 2: Automate safe duplicate decisions and conflict preservation

**Files:**
- Modify: `features/act-migration/preview-service.ts`
- Modify: `features/act-migration/reconciliation.ts`
- Modify: `features/act-migration/apply-manifest.ts`
- Create: `features/act-migration/auto-review.ts`
- Test: `tests/unit/act-migration-auto-review.test.ts`
- Test: `tests/integration/act-migration-release.test.ts`

- [ ] Add tests proving exact groups become approved automatically, near-matches remain pending, and conflicts retain all unique values/history.
- [ ] Implement bounded auto-review for exact duplicate groups and safe unchanged proposals; never auto-approve ambiguous locations or conflicting identities.
- [ ] Ensure merged contacts/phones/notes/groups/bookings are deduplicated while source IDs remain complete.
- [ ] Re-run reconciliation so only genuinely ambiguous proposals are shown as review work.
- [ ] Run focused tests and typecheck; commit `feat: automate safe event profile consolidation`.

### Task 3: Replace New booking and Quick add with one creation flow

**Files:**
- Create: `app/(private)/event-profiles/new/page.tsx`
- Create: `components/event-profiles/event-profile-form.tsx`
- Modify: `app/(private)/bookings/new/page.tsx`
- Modify: `app/(private)/quick-add/page.tsx`
- Modify: `components/navigation/app-shell.tsx`
- Test: `tests/unit/event-profile-form.test.tsx`
- Test: `tests/unit/creation-route-compatibility.test.tsx`

- [ ] Add tests for find/create event, add/select contacts, optional booking creation, and legacy-route compatibility.
- [ ] Implement **New event profile** with event identity first, contact capture second, and optional booking creation third.
- [ ] Redirect legacy New booking and Quick add entry points into the unified flow with preserved query/context.
- [ ] Add the single creation action to Today and the event-profile workspace.
- [ ] Run focused tests/typecheck; commit `feat: unify event profile creation`.

### Task 4: Integrate Today with the calling workspace

**Files:**
- Modify: `app/(private)/today/page.tsx`
- Modify: `features/follow-ups/today-query.ts`
- Modify: `components/today/follow-up-list.tsx`
- Modify: `components/today/next-call-card.tsx`
- Modify: `components/today/summary-cards.tsx`
- Test: `tests/unit/today-event-profile-links.test.tsx`

- [ ] Add tests that Next call, follow-ups, new leads, and upcoming events link to the correct event profile and selected Contact/booking context.
- [ ] Update dashboard links to use the unified profile route and preserve action context.
- [ ] Keep Today as prioritization only; profile workspace owns call/note/follow-up/booking mutations.
- [ ] Run focused tests/typecheck; commit `fix: route Today work into event profiles`.

### Task 5: Verify end-to-end bulk migration and calling workflow

**Files:**
- Modify: `tests/integration/act-migration-release.test.ts`
- Create: `tests/integration/event-profile-workflow.test.ts`
- Modify: `docs/superpowers/specs/2026-07-31-event-profiles-five9-workspace-design.md` only for verified rollout notes

- [ ] Fixture three exact duplicate event rows with shared/unique contacts, conflicting notes/phones, and one near-match.
- [ ] Assert one event profile, complete unique values/provenance, queued near-match only, and zero Act! writes.
- [ ] Apply the approved batch, repeat it, and assert stable Command Center counts and relationships.
- [ ] Assert Today → profile → call outcome → follow-up/booking workflow in one profile context.
- [ ] Run focused suite, typecheck, diff checks, and the PostgreSQL release suite when `CRM_TEST_DATABASE_URL` is configured.
- [ ] Record the rollout sequence and commit `test: verify event profile calling workflow`.
