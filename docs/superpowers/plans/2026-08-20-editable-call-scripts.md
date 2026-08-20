# Editable Call Scripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent owner-editable Call Scripts settings screen whose wording overrides are used by every guided Call Workspace while branch behavior remains code-controlled.

**Architecture:** Store only `say` and `coach` overrides in a small Postgres table keyed by script kind/node id. The frontend continues to own the canonical safe guided-script graph and merges API-provided wording overrides into that graph. Settings endpoints validate known script/node ids and placeholders; reset deletes the override.

**Tech Stack:** React + TypeScript + Wouter, Express, Zod, Drizzle/Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-20-editable-call-scripts-design.md`

## Global Constraints

- Response buttons, branch destinations, dispositions, next actions, DNC, Last Resort, and call-saving behavior are not editable.
- Persistent rows contain wording overrides only.
- The code-default Adventure Zone scripts remain the canonical reset/default source.
- Supported placeholders are exactly `contactName`, `eventName`, `eventDate`, `location`, and `packageInterest`.
- Owner-only access is inherited from the existing Settings and Calls routes.
- Mobile-first editor; no drag/drop required.

---

### Task 1: Override domain and persistence

**Files:**
- Create: `artifacts/api-server/src/features/calls/call-script-settings.ts`
- Test: `artifacts/api-server/src/features/calls/call-script-settings.test.ts`

**Interfaces:**
- Produces `CallScriptOverrideRecord`, `callScriptOverrideInputSchema`, `DrizzleCallScriptSettingsRepository`.
- Repository methods: `listOverrides()`, `upsertOverride(input, actorId)`, `deleteOverride(scriptKind, nodeId)`, `ensureSchema()`.

- [ ] Write failing tests for schema idempotency, validation, list/upsert/delete behavior, and placeholder validation.
- [ ] Verify RED when runnable.
- [ ] Implement a single-flight `CREATE TABLE IF NOT EXISTS call_script_overrides` initializer and repository.
- [ ] Verify GREEN when runnable.

### Task 2: Settings API and live workspace payload

**Files:**
- Modify: `artifacts/api-server/src/routes/settings.ts`
- Modify: `artifacts/api-server/src/routes/calls.ts`
- Modify: `artifacts/api-server/src/index.ts`
- Test: `artifacts/api-server/src/routes/call-script-settings-routes.test.ts`

**Interfaces:**
- `GET /settings/call-scripts`
- `PUT /settings/call-scripts/:scriptKind/:nodeId`
- `DELETE /settings/call-scripts/:scriptKind/:nodeId`
- `/calls/workspace` response includes `guidedScriptOverrides`.

- [ ] Write failing route contract tests.
- [ ] Verify RED when runnable.
- [ ] Add settings routes and workspace override loading.
- [ ] Add post-listen schema initialization via `runStartupStep`.
- [ ] Verify GREEN when runnable.

### Task 3: Safe frontend merge

**Files:**
- Modify: `artifacts/adventure-zone/src/features/calls/guided-call-scripts.ts`
- Modify: `artifacts/adventure-zone/src/features/calls/guided-call-scripts.test.ts`
- Modify: `artifacts/adventure-zone/src/components/calls/call-workspace.tsx`
- Modify: `artifacts/adventure-zone/src/pages/CallWorkspacePage.tsx`

**Interfaces:**
- Add `GuidedCallScriptOverride` type.
- Add `getConfiguredGuidedCallScript(kind, overrides)` or equivalent pure merge helper.
- `CallWorkspace` accepts `guidedScriptOverrides`.

- [ ] Write failing tests proving wording is overridden while response ids/next-node ids remain unchanged.
- [ ] Verify RED when runnable.
- [ ] Implement pure override merge.
- [ ] Thread overrides through Call Workspace initialization, script changes, response choices, and draft reset paths.
- [ ] Verify GREEN when runnable.

### Task 4: Call Scripts editor UI

**Files:**
- Create: `artifacts/adventure-zone/src/pages/SettingsCallScriptsPage.tsx`
- Create: `artifacts/adventure-zone/src/features/calls/call-script-settings-client.ts`
- Test: `artifacts/adventure-zone/src/pages/SettingsCallScriptsPage.test.tsx`

**Interfaces:**
- Loads `/settings/call-scripts`.
- Saves one step with PUT.
- Resets one step with DELETE.
- Uses code defaults for editable cards and preview.

- [ ] Write failing UI/source contract tests for script selector, Say this, Coaching tip, placeholder buttons, Preview, Customized badge, Save, and Reset.
- [ ] Verify RED when runnable.
- [ ] Implement the mobile-first settings page and API client.
- [ ] Verify GREEN when runnable.

### Task 5: Navigation and routing

**Files:**
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-menu.tsx`
- Test: `artifacts/adventure-zone/src/call-script-settings-navigation.test.ts`

**Interfaces:**
- Route `/settings/call-scripts`.
- Menu label `Call scripts` under Settings.

- [ ] Write failing navigation contract test.
- [ ] Verify RED when runnable.
- [ ] Add page import, route, and menu entry.
- [ ] Verify GREEN when runnable.

### Task 6: Verification and review

- [ ] Compare feature branch to latest main and confirm only intended files changed.
- [ ] Run focused tests if a runner becomes available; otherwise inspect workflow job steps and report infrastructure failures precisely.
- [ ] Confirm API build/type errors are not visible in available CI evidence.
- [ ] Open a draft PR with scope, safety invariants, and verification status.
- [ ] Request code review before marking complete.
