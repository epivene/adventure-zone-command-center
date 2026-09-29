# Profile and Assistant Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open full profiles directly, simplify daily actions and follow-ups, and offer the same context-aware assistant beside profiles and in the workspace.

**Architecture:** Retain existing profile and follow-up APIs. Consolidate the newer assistant's controller above route transitions, with a shared conversation view and an atomically captured selection per submitted message. Keep old history and specialist tools reachable while removing competing generic launchers.

**Tech Stack:** TypeScript, React, Wouter, TanStack Query, Radix Dialog, react-day-picker, Express, PostgreSQL, Vitest, Testing Library, PGlite.

**Spec:** `docs/superpowers/specs/2026-09-28-profile-assistant-layout-design.md`

## Global Constraints

- Keep the current visual theme.
- Cap serialized brief text at 4,000 characters and identify omitted material.
- Interpret date-only selections in the existing business timezone, America/Chicago, and serialize at local noon through the existing timestamp API.
- Preserve existing routes and authorization.
- Historical assistant conversations remain accessible.
- Use fixtures for writes; do not alter real follow-ups merely to test the UI.
- Existing draft review, spending controls, offline preparation, and action confirmation behavior must survive the shared view refactor.
- No new dependencies are expected. Use Node 22 and the repository's pnpm setup.

## Review Focus

1. Storage denied or a direct profile link: Back has a safe Profiles fallback (Task 1).
2. Impossible typed dates and DST boundary shortcuts: no rollover or unexpected day change (Task 2).
3. A late email response after profile navigation: no cross-profile results (Task 3).
4. Reusing a request key after changing scope: the accepted run cannot be retargeted (Task 5).
5. Expanding chat while a draft is unsaved or a response is running: retain state and make no duplicate request (Task 7).

## File map and conventions

Paths below are repository-relative. `FE` means `artifacts/adventure-zone/src`; `BE` means `artifacts/api-server/src`. These prefixes expand to exact file paths, not search patterns. New files are explicitly marked. Existing exported APIs remain compatible unless the task states an additive extension.

The work has two dependent slices: Tasks 1–4 produce independently testable profile improvements; Tasks 5–8 consolidate the assistant and navigation. Keep both in this plan because the final profile Assistant action depends on the shared controller and scope contract.

Before Task 1, fetch main and inspect changes since `cb32da44f3801a8a432b43b63233bab5171d02dc`; preserve the local design/plan commits. Read applicable repository instructions. Record baseline typecheck results before product changes. The isolated clone already exists at `work/adventure-zone-command-center` on `codex/profile-assistant-layout`; reuse it.

### Task 1: Direct full-profile navigation and return state

**Files:** Modify `FE/components/organizations/organization-list.tsx`, `FE/pages/OrganizationsPage.tsx`, `FE/pages/EventProfilePage.tsx`, `FE/lib/profile-navigation.ts`. Create `FE/lib/profile-navigation.test.ts` and `FE/components/organizations/organization-list-navigation.test.tsx`.

**Interfaces:** Add `saveProfileReturnState(path: string, scrollY: number): void` and `readProfileReturnState(): { path: string; scrollY: number } | null`. Keep existing origin-label exports. Validate same-app relative paths; use `/profiles` when absent or invalid.

- [ ] Write failing tests: clicking a card navigates to `/profiles/:id`, no preview dialog mounts, checkbox selection does not navigate, and return restores a query containing search/filter/sort/page. Assert `readProfileReturnState()` returns `null` with blocked storage or an external URL. Restore scroll only after the directory data renders.
- [ ] Run `pnpm --filter @workspace/adventure-zone test src/lib/profile-navigation.test.ts src/components/organizations/organization-list-navigation.test.tsx`; confirm failures describe the absent behavior.
- [ ] Replace preview selection with full-page links; remove the preview-only layout column and empty placeholder. Save and restore the return state. Preserve contact and booking query parameters and normal browser Back.
- [ ] Run those tests plus existing organization-list and boss-profile-navigation tests; verify direct-link fallback.
- [ ] Commit only Task 1 files: `fix: open full profiles directly from directory`.

### Task 2: Shared follow-up dialog and date picker

**Files:** Create `FE/components/follow-ups/follow-up-dialog.tsx`, `FE/components/follow-ups/follow-up-date-picker.tsx`, and colocated `.test.tsx` files. Modify `FE/components/follow-ups/follow-up-controls.tsx`, `FE/components/event-profiles/event-profile-workspace.tsx`, `FE/pages/EventProfilePage.tsx`. Reuse `FE/lib/business-date.ts`; extend `FE/lib/business-date.test.ts` for calendar shortcuts if necessary.

**Interfaces:** `FollowUpDatePicker({ value, onChange }: { value: string; onChange(value: string): void })` uses YYYY-MM-DD state with a visible labeled editable field, word-form selected date, calendar, and Today/Tomorrow/Next week. `FollowUpDialog({ open, onOpenChange, profileId, contactId, bookingId, followUp, onSaved })` uses nullable optional IDs; `followUp?: FollowUpRecord` selects edit mode; `onSaved(record: FollowUpRecord): void` refreshes consumers. Consume existing `parseBusinessDate` and `businessDateKey`, not browser-local parsing.

- [ ] Write tests for dialog open/focus, required type/date, save failure retaining fields, duplicate-click prevention, and success callback. Date assertions include `expect(parseBusinessDate('2026-02-30')).toBeNull()` and `expect(businessDateKey(parseBusinessDate('2026-03-08')!)).toBe('2026-03-08')`; cover both DST transitions and browsers in UTC, Denver, and Tokyo. Pin shortcut calculations to the Chicago calendar day.
- [ ] Run `pnpm --filter @workspace/adventure-zone test src/components/follow-ups src/lib/business-date.test.ts`; observe expected failures.
- [ ] Implement the portaled dialog using existing Dialog and Calendar components. Use month/year dropdowns and a readable MM/DD/YYYY editable field mapped to validated internal date state. Keep the save footer visible and the body scrollable. Use existing create/edit actions and preserve outcome/active-follow-up rules.
- [ ] Wire deep-link opening to the dialog; closing removes only `action=follow-up`. Replace the buried inline creation form and the separate inline edit form. On successful create/edit refetch profile and invalidate existing queue queries. Correct affected profile follow-up displays to use the shared business date.
- [ ] Rerun the tests plus `src/components/event-profiles/event-profile-workspace.follow-up.test.tsx`; verify no residual inline form is required. Commit: `fix: make profile follow-up scheduling visible and consistent`.

### Task 3: One honest profile email view

**Files:** Modify `FE/components/google-workspace/use-profile-google-email.ts`, `FE/components/google-workspace/profile-google-email-panel.tsx`, `FE/components/profiles/simple-full-profile.tsx`, `FE/components/profiles/profile-email-summary.tsx`, and their existing tests.

**Interfaces:** Preserve `useProfileGoogleEmail(organizationId, currentYear?)` and its public loading/error/current/historical/reload fields. Back it with a query keyed by profile identity and session ownership, using the existing app QueryClient. Expose no previous profile's result while the key changes. Clear private caches at logout through the existing auth lifecycle.

- [ ] Add tests asserting no numeric email count before loading, a distinct retryable error, merged/deduplicated historical threads, and genuine empty copy only after success. Resolve profile A's deferred response after switching to B and assert A's subject is absent.
- [ ] Run `pnpm --filter @workspace/adventure-zone test src/components/google-workspace/use-profile-google-email.test.tsx src/components/profiles/simple-full-profile.gmail-history.test.tsx`; confirm regressions fail.
- [ ] Consolidate the duplicated email fetches and replace the email tile/summary entry points with Open emails. Activate and scroll the existing email section into view, including `?section=emails`. Keep draft creation and email association/review controls there. Failed requests retain a visible error and never become zero.
- [ ] Run all tests in `src/components/google-workspace` and the simple-full-profile email tests. Use linked-thread fixtures to check existing API behavior; document a separate association defect if one is found. Commit: `fix: replace profile email counts with a reliable email view`.

### Task 4: Profile hierarchy and primary actions

**Files:** Modify `FE/components/profiles/simple-full-profile.tsx`, `FE/components/profiles/profile-actions-menu.tsx`, `FE/pages/EventProfilePage.tsx`. Create `FE/components/profiles/profile-workspace-actions.tsx` and `FE/components/profiles/profile-workspace-actions.test.tsx`.

**Interfaces:** `ProfileWorkspaceActions({ onFollowUp, onOpenEmails, onAddNote, onAssistant })` takes four `() => void` callbacks. Consume Task 2's dialog and Task 3's email activation. Keep the assistant callback adapter replaceable until Task 7.

- [ ] Write tests that all four named actions are directly visible and open the intended control. Verify More contains Edit, research, family membership, and flags; contact Call remains present. Check existing invoice/document/source content remains reachable after reordering.
- [ ] Run `pnpm --filter @workspace/adventure-zone test src/components/profiles/profile-workspace-actions.test.tsx`; confirm missing component/behavior failures.
- [ ] Place profile identity and next action first. Group content into Overview, Contacts, Bookings, History, Documents; put invoices/contracts and booking creation in their relevant section. Remove duplicate action rows and CSS child-position hiding. Reuse existing content components, with labeled section state that honors email/research deep links.
- [ ] Run profile action tests and existing simple-full-profile/booking-creator/document tests. Commit: `refactor: organize profile content around daily actions`.

### Task 5: Atomic assistant message scope

**Files:** Modify `BE/features/assistant-workspace/http-schema.ts`, `BE/features/assistant-workspace/run-store.ts`, `BE/routes/assistant-workspace.ts`, `BE/features/assistant-workspace/run-store.test.ts`. Create `BE/features/assistant-workspace/selection-access.ts`, `BE/features/assistant-workspace/selection-access.test.ts`, and `BE/routes/assistant-workspace.scope.test.ts`.

**Interfaces:** Add optional `selection: Selection` to `messageInput` using `selectionSchema`; do not change required fields. Add `validateSelectionAccess(db: Queryable, actor: Actor, selection: Selection): Promise<Selection>`, checking referenced record existence, existing owner/connection access, and booking/thread/draft membership. Reuse current access rules; never infer ownership from a supplied ID. Existing `RunStore.submit` retains its atomic message/run write and receives the effective selection.

- [ ] Add tests for omitted selection preserving old behavior; explicit empty/general selection; single/multiple profile IDs; malformed IDs; mismatched booking/thread/draft; unauthorized actor; and concurrent scope edits. Submit profile A with a request key, retry with B, and assert the first stored `input.selection.organizationIds` remains `[A]` and only one run exists. Return a conflict for changed content/scope; reconciliation recovers the original accepted run.
- [ ] Run `pnpm --filter @workspace/api-server test src/features/assistant-workspace/selection-access.test.ts src/features/assistant-workspace/run-store.test.ts src/routes/assistant-workspace.scope.test.ts`; observe failures.
- [ ] Validate new requests before submission, capture the snapshot in the existing atomic write, and expose effective requested scope via the existing run/message response. Extend idempotency comparison to include selection for new explicit-scope requests without breaking legacy retries. Do not overwrite an accepted run from current conversation state. Recheck membership inside the write transaction where mutable associations affect authorization.
- [ ] Rerun tests with PGlite transaction coverage and existing workspace route tests. Commit: `feat: capture authorized assistant scope per message`.

### Task 6: Bounded current profile context

**Files:** Create `BE/features/assistant-workspace/profile-brief.ts` and `profile-brief.test.ts`. Modify `BE/features/assistant-workspace/production-reads.ts`, `runtime.ts`, `worker.ts`, and `model-context.test.ts` within the same directory.

**Interfaces:** `loadProfileBrief(db: Queryable, context: RunContext): Promise<Evidence[]>` returns one explicitly partial brief for exactly one selected profile; general/multi-profile requests continue using existing selection/search tools. `serializeProfileBrief(input: { identity: string; primaryContact: string; nextFollowUp: string | null; recentActivity: string[] }): string` limits the complete serialized string to 4,000 characters including omission markers. Evidence carries the profile ID and a content/version fingerprint.

- [ ] Add assertions `expect(brief.length).toBeLessThanOrEqual(4000)` and `expect(evidence.complete).toBe(false)` for oversized fixtures. Test no automatic full email/document retrieval, changed contact/follow-up versions, empty/multi-profile selection, and unchanged sources represented once in model input.
- [ ] Run `pnpm --filter @workspace/api-server test src/features/assistant-workspace/profile-brief.test.ts src/features/assistant-workspace/model-context.test.ts`; confirm missing behavior.
- [ ] Load brief at the run's first model step from its captured scope using bounded queries. Reuse it for that run; retrieve a fresh brief on subsequent messages. Feed it through existing evidence projection, preserving retrieval tools and source completeness. Do not add a second historical-context system or truncate saved records.
- [ ] Rerun focused tests and worker/conversation-context regressions. Capture representative before/after serialized context sizes; report real usage metrics when available. Commit: `perf: supply bounded profile context to assistant runs`.

### Task 7: Shared workspace controller and profile panel

**Files:** Create `FE/features/assistant-workspace/WorkspaceSessionProvider.tsx`, `FE/features/assistant-workspace/profile-scope.ts`, `FE/components/assistant-workspace/ConversationView.tsx`, `FE/components/assistant-workspace/ProfileAssistantPanel.tsx`, and corresponding tests. Modify `FE/pages/AssistantWorkspacePage.tsx`, `FE/features/assistant-workspace/types.ts`, `FE/App.tsx`, and `FE/pages/EventProfilePage.tsx`.

**Interfaces:** `profileSelection(profileId: string): Selection` returns only that organization ID with all other selection fields cleared. `WorkspaceSessionProvider` lives within authenticated admin scope above route transitions. `useWorkspaceSession()` exposes `openProfile(profileId: string): Promise<void>`, `openConversation(id: string): Promise<void>`, `expand(): void`, `closePanel(): void`, and the existing workspace controller state/handlers moved without changing their contracts. `ConversationView({ placement }: { placement: 'panel' | 'workspace' })` consumes that provider.

- [ ] Test exact profile scope clearing, explicit General workspace selection, multi-profile selection, and scope labels. Enter unsaved text/edit a draft, start a run, expand/collapse, and assert conversation ID/text/edits persist and the message POST count remains one. Switch profiles during a run and assert the run retains its original scope; keep each conversation's pending state separate. Test logout clears session state.
- [ ] Run `pnpm --filter @workspace/adventure-zone test src/features/assistant-workspace src/components/assistant-workspace`; confirm new scope/panel tests fail before extraction.
- [ ] Extract the existing controller and shared chat rendering. Preserve request fingerprints, attachments, draft saves, polling cancellation, spending UI, offline preparation, and action confirmations. Add selection to message requests from Task 5, include it in retry fingerprints, and retain the accepted scope on retries.
- [ ] Implement per-profile conversation association under the authenticated session; validate stored IDs against server access/lifecycle on reload. Opening a missing/archived conversation offers a new one without silently reviving it. Keep general and multi-profile conversations separate from automatic profile association. Panel opening selects context but sends no message automatically.
- [ ] Wire the profile Assistant action and visible Working with label. Desktop side panel and mobile sheet share the same session; full-page transitions retain a return-to-profile path. In-flight responses and unsaved edits stay with their original session.
- [ ] Rerun the full existing assistant-workspace frontend suite plus scope tests. Commit: `feat: share assistant conversations between profiles and workspace`.

### Task 8: Navigation consolidation and whole-flow verification

**Files:** Modify `FE/components/navigation/app-shell.tsx`, `FE/components/navigation/app-menu.tsx`, `FE/components/navigation/mobile-bottom-nav.tsx`, `FE/components/assistant/assistant-launcher.tsx`. Create `FE/components/navigation/assistant-entry-points.test.tsx` and `docs/profile-assistant-layout-verification.md`.

**Interfaces:** All generic admin Assistant entries open the Task 7 session/workspace. Older conversations explicitly opens the retained legacy drawer/history. Specialist lead-scout/call tools retain their existing context APIs; no general launcher routes there by accident.

- [ ] Add navigation tests for one generic Assistant destination, visible daily destinations, grouped Administration items, and reachable older history/specialist tools. Assert boss/manager route guards and offline workspace links remain unchanged.
- [ ] Run `pnpm --filter @workspace/adventure-zone test src/components/navigation`; verify expected failures, then update menus/launcher wiring and remove competing generic launchers.
- [ ] Run focused profile/navigation/assistant tests from Tasks 1–7 and existing API workspace suites. Run `pnpm run typecheck`, `pnpm --filter @workspace/adventure-zone build`, and `pnpm --filter @workspace/api-server build`. Compare failures to the baseline; new regressions must be fixed.
- [ ] Use a local fixture-backed browser session to exercise directory → full profile → follow-up save → emails → assistant → expand → Back at 390, 768, and 1440 pixel widths. Check long-page scroll, keyboard focus, and simulated request errors. Record limitations for physical keyboard/phone behavior that cannot be observed.
- [ ] Record actual test/build results, before/after context-size evidence, screenshots where useful, and remaining limitations in the verification document. Review the complete diff against the spec, especially retry scope and unsaved draft behavior. Commit: `refactor: consolidate assistant and admin navigation`.

## Completion and handoff

All eight tasks must pass their acceptance checks before reporting implementation complete. Preserve local changes and commit history. Prepare a reviewable branch/PR when implementation is ready; do not deploy or merge as part of plan creation. Keep the approved spec and this checklist with the change.

Self-review: every spec section maps to a task; all five review-focus conditions have owning tests; the Chicago timezone correction reuses existing business policy; no product files were changed during planning.

## Execution record

Implemented all eight work areas on `codex/profile-assistant-layout`. See [verification and deviations](2026-09-28-profile-assistant-layout-verification.md) for the executed checks, independent review, baseline failures, and remaining live-integration limits. The checklist above is the original plan; the execution record documents substitutions rather than implying every originally named test existed.
