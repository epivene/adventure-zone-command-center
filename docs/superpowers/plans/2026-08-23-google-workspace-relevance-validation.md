# Google Workspace Relevance Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded, owner-only recent Gmail validation flow that broadly discovers recent mailbox metadata, retains only deterministic business/profile-relevant items for review, and prevents clearly unrelated mail from entering durable CRM content.

**Architecture:** Extend the existing read-only Google client with metadata-only Gmail listing and message-header lookup. Add a deterministic relevance classifier that consumes CRM contact/profile evidence without AI, then expose an owner-only validation endpoint and settings UI summary for the newest 100 items. This is a validation layer, not the full Phase-2 historical archive.

**Tech Stack:** TypeScript, Express 5, PostgreSQL, googleapis/fetch client patterns already used by Phase 1, React/Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-google-workspace-relevance-validation-design.md`

## Global Constraints

- Google remains read-only.
- AI stays disabled for the validation sample.
- System labels are context signals, not automatic business relevance, except Spam is explicitly scanned.
- Exact known contact/profile/business evidence may retain a message even when it has no selected custom business label.
- Clearly unrelated content is not persisted into durable Gmail body/file tables and is not sent to AI.
- Leg managers receive no Gmail metadata/content/validation data.
- Full historical backfill remains disabled.

---

### Task 1: Add Gmail metadata-only client interfaces

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-types.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.ts`
- Test: `artifacts/api-server/src/features/google-workspace/google-api-client.test.ts`

**Produces:** `listRecentMessageRefs(limit)` and `getMessageMetadata(id)` read-only methods returning IDs, thread IDs, label IDs, headers, snippet/date, and attachment presence without fetching/storing full bodies.

- [ ] Write failing tests for pagination/limit and metadata format.
- [ ] Verify the tests fail because methods do not exist.
- [ ] Implement the minimum Gmail read-only methods.
- [ ] Verify focused tests pass.

### Task 2: Add deterministic business/profile relevance classifier

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/google-relevance-classifier.ts`
- Test: `artifacts/api-server/src/features/google-workspace/google-relevance-classifier.test.ts`

**Produces:** `classifyGoogleMessageRelevance(input)` returning `matched`, `review`, or `ignored` plus evidence codes and optional candidate IDs.

Required rules:
- exact saved contact email => retained/matched;
- exact unique non-public organization domain => retained/matched;
- approved business/custom label => retained/review when ownership is unknown;
- Spam/system label alone => not enough for relevance;
- INBOX/SENT/IMPORTANT/STARRED/etc. alone => ignored unless other evidence exists;
- existing approved thread/source association => retained/matched;
- weak text resemblance alone => review only when bounded exact profile-name evidence exists, never automatic ownership.

- [ ] Write failing classifier tests covering every rule above.
- [ ] Verify red failures.
- [ ] Implement classifier and public-domain protection.
- [ ] Verify focused tests pass.

### Task 3: Build owner-only bounded validation service and route

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/google-recent-validation-service.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-validation.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Test: `artifacts/api-server/src/features/google-workspace/google-recent-validation-service.test.ts`
- Test: `artifacts/api-server/src/routes/google-workspace-validation.test.ts`

**Produces:** `POST /api/google-workspace/validation/recent` with a hard maximum of 100 Gmail items.

Response contains only safe validation evidence:
- counts: discovered, matched, needsReview, ignored;
- retained/review rows with subject, date, participants, labels, evidence, candidate display names/IDs;
- ignored rows only with minimal metadata needed for owner review, no full bodies.

No full historical worker is started and no profile fields are changed.

- [ ] Write failing service and owner-auth route tests.
- [ ] Verify manager/leg-manager requests fail server-side.
- [ ] Implement service and route.
- [ ] Verify focused tests pass.

### Task 4: Add owner validation UI

**Files:**
- Modify: `artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts`
- Modify: `artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-recent-validation.tsx`
- Test: `artifacts/adventure-zone/src/components/google-workspace/google-recent-validation.test.tsx`
- Test: `artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.test.tsx`

**Produces:** a `Run recent email check` control under the saved business scope with summary cards and review rows.

UI copy must clearly state:
- only the newest 100 are checked;
- AI is off;
- this does not start the historical import;
- matched and needs-review items are visible with exact evidence;
- ignored count is visible and expandable for owner inspection.

- [ ] Write failing UI tests.
- [ ] Verify red failures.
- [ ] Implement API client/types and UI component.
- [ ] Verify focused tests pass.

### Task 5: Verification and rollout guard

- [ ] Run API Google Workspace focused tests.
- [ ] Run frontend Google Workspace focused tests.
- [ ] Run API and frontend builds.
- [ ] Confirm `GOOGLE_WORKSPACE_SYNC_ENABLED=false` and `GOOGLE_WORKSPACE_AI_ENABLED=false` remain the production defaults.
- [ ] Review final diff for accidental body persistence, Google write methods, manager exposure, or automatic profile writes.
- [ ] Open PR as draft if full CI cannot execute; do not enable historical backfill.