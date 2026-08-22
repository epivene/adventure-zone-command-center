# Google Workspace CRM Sync Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete read-only Google Workspace CRM system through five independently reviewable phases: secure connection/scope, Gmail/files archive, Calendar archive, deterministic matching with bounded AI/review, and profile presentation with continuous sync.

**Architecture:** Build one durable Google archive behind strict business-scope filters, then layer matching and profile presentation over immutable Google source identities. Each phase ships as a separate branch and pull request, passes its own TDD/build gate, and exposes only the interfaces required by the following phase. Production historical processing remains disabled until the final rollout gate is implemented and the owner explicitly approves the recent-history validation sample.

**Tech Stack:** TypeScript, Express 5, PostgreSQL/Drizzle, `googleapis`, Google Cloud private object storage, Node AES-256-GCM, Zod, existing provider-agnostic AI client, React/Vite/Wouter, TanStack Query, Vitest, PGlite, Supertest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-22-google-workspace-crm-sync-design.md`

## Global Constraints

- One company Google account supplies Gmail, approved Drive-linked files, and four Google Calendars.
- Release 1 is read-only on Google's side.
- Gmail messages, labels, read state, archive state, and deletion state are never changed.
- Google Calendar events are never created, edited, deleted, accepted, or declined.
- Only these Gmail roots and saved descendants are in scope: Shows, Receipts, Off Season Business Opportunities, Employees, Associations.
- Only these four Calendar IDs are in scope: Adventure Zone Calendar, Pirates Rebellion Calendar, Warriors Playground Calendar, and the separate calendar identified by `zone.pirate.warrior@gmail.com`.
- Personal/unselected content is excluded before body storage and before any AI prompt.
- Inbox and Sent messages are reconstructed into complete threads.
- Accessible attachments and Drive-linked files are copied into private Command Center storage and retain original Google links.
- Deterministic evidence is the only authority for automatic ownership.
- AI may categorize, summarize, extract possible facts, and rank a bounded candidate list; AI may not create ownership links or update CRM fields.
- Existing nonblank CRM values are never silently overwritten.
- Owner has full settings/sync/review/profile access.
- Office Coordinator has approved business profile/review access but no credentials, scope settings, sync toggles, or owner-private fields.
- Leg managers have zero email, file, note, Google event, sync, review, or suggestion access.
- Every source reaches a visible state; there is no hidden unlinked bucket.
- All source writes and review actions are idempotent and auditable.
- `GOOGLE_WORKSPACE_SYNC_ENABLED` and `GOOGLE_WORKSPACE_AI_ENABLED` default to false.
- Do not run the production full historical backfill before Phase 5 validation/rollout controls are merged and the owner approves the validation sample.

## Phase Interfaces and Dependency Order

| Phase | Plan | Produces | Consumed by |
|---|---|---|---|
| 1 | `2026-08-22-google-workspace-connection-scope.md` | encrypted connection, OAuth, exact label/calendar scope, read-only Google clients | Phases 2–5 |
| 2 | `2026-08-22-google-workspace-gmail-files-backfill.md` | Gmail threads/messages, file versions/sources, durable sync run/item ledger | Phases 4–5 |
| 3 | `2026-08-22-google-workspace-calendar-sync.md` | Calendar source archive, exact Calendar links/candidates, nonduplicate schedule projection | Phases 4–5 |
| 4 | `2026-08-22-google-workspace-matching-ai-review.md` | exact match rules, candidates, bounded AI analyses, suggestions, owner/Office review | Phase 5 |
| 5 | `2026-08-22-google-workspace-profile-incremental-sync.md` | profile tabs, ACT provenance links, incremental checkpoints, repair and rollout controls | Production release |

No phase may rename or weaken an interface produced by an earlier merged phase without updating the dependent plans and their contract tests first.

---

### Task 1: Implement and merge the secure connection and scope foundation

**Plan:** `docs/superpowers/plans/2026-08-22-google-workspace-connection-scope.md`

**Suggested branch:** `feature/google-workspace-connection-scope`

- [ ] **Step 1: Create an isolated worktree from current `main`**

Use `superpowers:using-git-worktrees`, confirm the worktree is isolated, install with `pnpm install --frozen-lockfile`, and run the repository's existing API/frontend baseline tests selected by the phase plan.

- [ ] **Step 2: Implement every phase task with RED → GREEN → REFACTOR**

Required deliverables are strict environment parsing, encrypted refresh tokens, one-use OAuth state, durable connection/scope tables, startup schema, typed read-only Google clients, owner-only settings routes, and the Google Workspace settings page.

- [ ] **Step 3: Run the complete Phase-1 gate**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace src/routes/google-workspace-oauth-callback.test.ts src/routes/google-workspace-settings.test.ts src/db/google-workspace-required-startup.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/features/google-workspace src/components/google-workspace src/pages/SettingsGoogleWorkspacePage.test.tsx
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: every command exits 0; no message/file/event backfill tables contain source content.

- [ ] **Step 4: Request code review and resolve all Critical/Important issues**

Review specifically for OAuth replay, token leakage, insufficient scopes, accidental write scopes, callback route ordering, Office/manager access, and default-deny scope behavior.

- [ ] **Step 5: Merge before Phase 2 starts**

Use a squash merge titled `feat: add Google Workspace connection and scope`. Do not configure production OAuth or connect the company account until deployment documentation and environment values are ready.

---

### Task 2: Implement and merge the Gmail and durable-file archive

**Plan:** `docs/superpowers/plans/2026-08-22-google-workspace-gmail-files-backfill.md`

**Suggested branch:** `feature/google-workspace-gmail-files`

**Consumes:** Phase-1 connection repository, selected label IDs, authenticated Gmail/Drive client factory, and private object storage.

- [ ] **Step 1: Create a new worktree from `main` after Phase 1 is merged**

Verify the Phase-1 connection/scope tests pass before writing Phase-2 tests.

- [ ] **Step 2: Implement the archive and worker tasks test-first**

Required deliverables are message/thread/file/work-ledger schema, MIME parsing, selected-label discovery, complete Inbox/Sent thread persistence, checksum-based file deduplication/versioning, bounded backfill worker, progress APIs/UI, and a privacy/idempotency E2E fixture.

- [ ] **Step 3: Run the complete Phase-2 gate**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace src/routes/google-workspace-sync.test.ts src/db/google-workspace-required-startup.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/features/google-workspace src/components/google-workspace src/pages/SettingsGoogleWorkspacePage.test.tsx
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: every command exits 0; the E2E fixture stores no personal body, reconstructs Inbox/Sent, deduplicates identical files, and remains idempotent on a second run.

- [ ] **Step 4: Request privacy/storage/restart review**

Review selected-label proof before body fetch, complete-thread boundary, file rollback behavior, signed URL access, lease reclaim, pause/resume, and absence of Google mutation methods.

- [ ] **Step 5: Merge without running production full backfill**

Squash title: `feat: archive approved Gmail threads and files`. Keep production historical processing off. Fixture/staging verification is allowed; the production company archive waits for Phase 5 validation controls.

---

### Task 3: Implement and merge the four-calendar archive and schedule projection

**Plan:** `docs/superpowers/plans/2026-08-22-google-workspace-calendar-sync.md`

**Suggested branch:** `feature/google-workspace-calendar`

**Consumes:** Phase-1 selected Calendar IDs and Phase-2 sync ledger.

- [ ] **Step 1: Create a new worktree from `main` after Phase 2 is merged**

Run Phase-1 and Phase-2 Google tests as baseline.

- [ ] **Step 2: Implement Calendar tasks test-first**

Required deliverables are all-day/timed/recurring/cancelled event normalization, exact calendar/event/instance identity, full-history discovery/import, conservative exact matching, owner/Office profile Calendar reads, and Schedule integration that suppresses a duplicate Google card when a linked CRM booking is already present.

- [ ] **Step 3: Run the complete Phase-3 gate**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/calendar src/features/google-workspace/matching src/routes/google-workspace-calendar.test.ts src/routes/office-google-workspace-calendar.test.ts src/routes/calendar.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/google-workspace src/features/calendar/google-calendar-source.test.ts src/pages/SettingsGoogleWorkspacePage.test.tsx src/pages/SchedulePage.test.tsx
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: every command exits 0; all four source calendars remain distinct; linked bookings appear once; ambiguous/conflicting events remain visible.

- [ ] **Step 4: Request Calendar/time/access review**

Review exclusive all-day end dates, time zones, recurrence identity, cancellation retention, exact matching thresholds, schedule deduplication, Office reads, and manager exclusion.

- [ ] **Step 5: Merge without production Calendar backfill**

Squash title: `feat: archive and present approved Google Calendars`. Keep production source processing off until Phase 5 rollout approval.

---

### Task 4: Implement and merge deterministic matching, bounded AI, and review

**Plan:** `docs/superpowers/plans/2026-08-22-google-workspace-matching-ai-review.md`

**Suggested branch:** `feature/google-workspace-matching-review`

**Consumes:** Gmail/thread/file archive, Calendar archive, content-link repository, existing AI client, CRM organization/contact/booking tables, owner auth, and Office auth.

- [ ] **Step 1: Create a new worktree from `main` after Phase 3 is merged**

Run the Gmail, file, Calendar, owner-auth, and Office-auth baseline suites.

- [ ] **Step 2: Implement matching/review tasks test-first**

Required deliverables are normalized exact evidence, public-domain protection, visible reversible rules, deterministic Gmail matching, strict AI prompt/output validation, allowlisted profile suggestions, shared owner/Office review service, restart-safe analysis stages, and role-specific review pages.

- [ ] **Step 3: Run the complete Phase-4 gate**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/matching src/features/google-workspace/ai src/features/google-workspace/suggestions src/features/google-workspace/review src/routes/google-workspace-review.test.ts src/routes/office-google-workspace-review.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/google-workspace src/pages/GoogleWorkspaceReviewPage.test.tsx src/pages/OfficeGoogleWorkspaceReviewPage.test.tsx
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: every command exits 0; no AI-only ownership link exists; public domains do not infer organizations; owner/Office decisions are auditable; manager requests fail.

- [ ] **Step 4: Request matching/AI/authorization review**

Review automatic-link thresholds, contradictory evidence, prompt injection resistance, candidate-ID bounding, invalid-output handling, suggestion field allowlist, stale-target protection, rule reversal, Office factual boundaries, and manager exclusion.

- [ ] **Step 5: Merge with AI still disabled by default**

Squash title: `feat: match and review Google business records`. Leave `GOOGLE_WORKSPACE_AI_ENABLED=false` in production until the recent validation sample is inspected.

---

### Task 5: Implement profile presentation, ACT links, continuous sync, and production rollout

**Plan:** `docs/superpowers/plans/2026-08-22-google-workspace-profile-incremental-sync.md`

**Suggested branch:** `feature/google-workspace-profile-continuous-sync`

**Consumes:** all Phase-1 through Phase-4 contracts.

- [ ] **Step 1: Create a new worktree from `main` after Phase 4 is merged**

Run the complete Google Workspace CI command set as baseline.

- [ ] **Step 2: Implement final phase tasks test-first**

Required deliverables are shared profile projections and APIs, owner/Office Emails & Files tabs, conservative ACT↔Gmail provenance links, Gmail history and per-calendar sync-token checkpoints, known Drive-file version refresh, independent continuous worker/runtime, reconnect/repair status, recent-validation/full-backfill/continuous-sync owner gates, and complete release E2E coverage.

- [ ] **Step 3: Run the complete release gate**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace src/routes/google-workspace-*.test.ts src/routes/office-google-workspace-*.test.ts src/routes/google-workspace-role-boundary.e2e.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/features/google-workspace src/components/google-workspace src/pages/SettingsGoogleWorkspacePage.test.tsx src/pages/GoogleWorkspaceReviewPage.test.tsx src/pages/OfficeGoogleWorkspaceReviewPage.test.tsx src/pages/EventProfilePage.test.tsx src/pages/OfficeProfilePage.test.tsx src/pages/SchedulePage.test.tsx
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: every command exits 0; source totals reconcile; replay is duplicate-free; personal content is absent; no Google mutation occurs; role boundaries hold.

- [ ] **Step 4: Request full-system release review**

Review profile cross-tenant leakage, signed-file authorization, ACT preservation, cursor transaction boundaries, invalid-cursor repair, source deletion semantics, runtime shutdown, feature switches, rollout gates, monitoring, and end-to-end permission checks.

- [ ] **Step 5: Merge with production switches off**

Squash title: `feat: complete read-only Google Workspace CRM sync`. Deploy with:

```text
GOOGLE_WORKSPACE_SYNC_ENABLED=false
GOOGLE_WORKSPACE_AI_ENABLED=false
```

- [ ] **Step 6: Configure and connect production safely**

Follow `docs/operations/google-workspace-readonly-setup.md`: enable the three Google APIs, configure OAuth redirect/environment values, deploy, connect the company account, and verify the displayed account email.

- [ ] **Step 7: Approve exact scope before content processing**

Confirm the five Gmail root IDs and descendants and the four Calendar IDs. Resolve any `Missing expected label/calendar` warnings before validation.

- [ ] **Step 8: Run and inspect the bounded validation sample**

Process at most 500 newest Gmail threads and 250 newest Calendar events. Inspect personal exclusion, Inbox/Sent reconstruction, file copying, exact profile matches, internal filing, Calendar source labels, AI-disabled behavior, and manager access. Rejecting validation stops future processing without deleting the sample archive.

- [ ] **Step 9: Approve full historical backfill**

After validation approval, start the full newest-first backfill. Monitor discovered/processed/review/unavailable/retry counts until Gmail and all four Calendars reconcile with zero hidden/unclassified records.

- [ ] **Step 10: Enable limited AI and inspect its first review batch**

Set `GOOGLE_WORKSPACE_AI_ENABLED=true`, redeploy, and inspect categories, summaries, facts, bounded candidate ranking, and prompt-safety audit metadata. Disable immediately if output is unsafe; deterministic matching and archive processing continue.

- [ ] **Step 11: Enable continuous sync last**

After full backfill completes and review counts are understood, set `GOOGLE_WORKSPACE_SYNC_ENABLED=true`. Confirm Gmail, each Calendar, and Drive checkpoints advance independently and no Gmail/Calendar mutations appear in fake-client/audit verification.

## Final Release Acceptance

- The connected account and approved scope are explicit and auditable.
- Only approved business Gmail roots/descendants and four selected Calendars enter the CRM.
- Inbox and Sent form complete conversations.
- Accessible files are private, durable, versioned, deduplicated, and source-linked.
- Profiles show Conversations, Files, Calendar, and Suggested Updates for owner and Office Coordinator.
- Employees, Business Receipts, and Associations remain distinct internal areas.
- Exact deterministic evidence controls automatic ownership; AI never controls ownership or CRM writes.
- Profile suggestions require explicit acceptance and protect changed targets.
- ACT email history remains stored but exact duplicates present one richer Gmail conversation with provenance.
- Gmail, each Calendar, and known linked Drive files continuously sync through restart-safe checkpoints and visible repair states.
- Linked Google Calendar events do not duplicate CRM bookings on Schedule.
- Source deletion/unavailability never silently deletes durable CRM history.
- Owner has full settings/control; Office has approved business profile/review access; leg managers have no Google/content access.
- Every source reconciles to one visible state, all tests/builds pass, and a second full replay creates no duplicates.
- Gmail and Google Calendar remain unchanged.
