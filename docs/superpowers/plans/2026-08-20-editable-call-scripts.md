# Editable Call Scripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent owner-editable Call Scripts settings screen whose wording overrides are used by every guided Call Workspace while branch behavior remains code-controlled.

**Architecture:** Store only `say` and `coach` overrides in a small Postgres table keyed by script kind/node id. The frontend continues to own the canonical safe guided-script graph. Saved overrides are merged only into the **visible script wording**; the call state/branch engine always uses the protected code graph. Settings endpoints validate known script/node ids and placeholders; reset deletes the override.

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

- [x] Write tests for validation and trusted placeholders.
- [ ] Verify RED when a test runner is available.
- [x] Implement a single-flight `CREATE TABLE IF NOT EXISTS call_script_overrides` initializer and repository.
- [ ] Verify GREEN when a test runner is available.

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

- [x] Write route contract tests.
- [ ] Verify RED when a test runner is available.
- [x] Add settings routes and workspace override loading.
- [x] Add post-listen schema initialization via `runStartupStep`.
- [ ] Verify GREEN when a test runner is available.

### Task 3: Safe frontend wording merge

**Files:**
- Modify: `artifacts/adventure-zone/src/features/calls/guided-call-scripts.ts`
- Modify: `artifacts/adventure-zone/src/features/calls/guided-call-scripts.test.ts`
- Create: `artifacts/adventure-zone/src/features/calls/guided-call-script-settings-context.tsx`
- Modify: `artifacts/adventure-zone/src/components/calls/guided-call-script-card.tsx`
- Modify: `artifacts/adventure-zone/src/pages/CallWorkspacePage.tsx`

**Interfaces:**
- Add `GuidedCallScriptOverride` type.
- Add `getConfiguredGuidedCallScript(kind, overrides)` pure merge helper.
- Provide overrides to the visible `GuidedCallScriptCard` through a small context provider.
- Keep `CallWorkspace` state/branch logic on `getGuidedCallScript()` so database wording can never become workflow configuration.

- [x] Write tests proving wording is overridden while response ids/next-node ids remain unchanged.
- [ ] Verify RED when a test runner is available.
- [x] Implement pure wording-only override merge.
- [x] Provide saved overrides to the visible guided script while leaving branching on the protected graph.
- [ ] Verify GREEN when a test runner is available.

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

- [x] Write UI/source contract tests for script selector, Say this, Coaching tip, placeholder buttons, Preview, Customized badge, Save, Reset, and intentionally blank coaching overrides.
- [ ] Verify RED when a test runner is available.
- [x] Implement the mobile-first settings page and API client.
- [x] Preserve intentionally blank coaching overrides and persistent Save/Reset feedback.
- [ ] Verify GREEN when a test runner is available.

### Task 5: Navigation and routing

**Files:**
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-menu.tsx`
- Test: `artifacts/adventure-zone/src/call-script-settings-navigation.test.ts`

**Interfaces:**
- Route `/settings/call-scripts`.
- Menu label `Call scripts` under Settings.

- [x] Write navigation contract test.
- [ ] Verify RED when a test runner is available.
- [x] Add page import, route, and menu entry.
- [ ] Verify GREEN when a test runner is available.

### Task 6: Verification and review

- [x] Compare feature branch to latest main and confirm intended scope.
- [x] Inspect Guided Calling CI job evidence; current repository runner failure reports `steps: null`, so no test execution is claimed.
- [x] Open draft PR with scope and safety invariants.
- [ ] Obtain executable test/build evidence when the repository runner is functioning.
- [ ] Complete code review before marking ready to merge.
