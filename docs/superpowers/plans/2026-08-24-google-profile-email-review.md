# Google Profile Email Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve Gmail validation matches through real contact→organization relationships, add an explicit sample approval gate, and show approved sample conversations with live read-only thread detail on owner profiles.

**Architecture:** Extend the existing bounded validator rather than introducing historical archive tables. Persist only validation mapping/approval state; fetch full thread content live from Gmail only when the owner opens a mapped conversation. Keep full backfill, AI, and durable attachment/body archival disabled.

**Tech Stack:** TypeScript, Express 5, PostgreSQL/Drizzle, Gmail REST read-only client, React/Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-google-profile-email-review-design.md`

## Global Constraints

- PR #453 behavior is the base: no Receipt/Spam required scope and no Spam/Trash discovery.
- Contact→profile resolution uses active CRM organization relationships only.
- Ambiguous multi-organization contacts never auto-resolve.
- Approval never starts historical backfill.
- Gmail stays read-only.
- Email bodies and attachment bytes are not durably archived in this PR.
- Owner-only profile/API access; no manager route.

---

### Task 1: Resolve contact matches to organization/profile

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/google-contact-profile-resolver.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-contact-profile-resolver.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-recent-validation-service.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-recent-validation-service.test.ts`

**Interfaces:**
- Consumes exact contact candidates from `classifyGoogleMessageRelevance`.
- Produces `resolvedOrganization` and `matchedContact` fields for validation rows.

- [ ] Write failing tests for one active organization, multiple active organizations, retired organizations, and no relationship.
- [ ] Implement resolver against `organization_contacts`/live organizations.
- [ ] Integrate into validation service without weakening existing exact evidence.
- [ ] Verify focused tests and API build when executable CI is available.

### Task 2: Persist validation mappings and approval state

**Files:**
- Create: `lib/db/src/google-workspace-validation-schema.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `artifacts/api-server/src/db/schema.ts`
- Modify: `artifacts/api-server/src/db/google-workspace-startup-migration.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-validation-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-validation-repository.test.ts`

**Interfaces:**
- `upsertValidationRows(rows)` idempotently stores message/thread IDs, organization/contact links, evidence, and state.
- `setValidationDecision({status:'approved'|'rejected', actorId, now})` records owner decision.
- `listApprovedForOrganization(organizationId)` returns only approved mapped source identities.

- [ ] Write schema/repository tests first.
- [ ] Add idempotent validation mapping and connection-level approval state.
- [ ] Do not store body/snippet beyond what existing validation result already exposes; no attachment bytes.

### Task 3: Add owner validation approval API

**Files:**
- Modify: `artifacts/api-server/src/routes/google-workspace-validation.ts`
- Modify: `artifacts/api-server/src/routes/google-workspace-validation.test.ts`

**Routes:**
- `POST /google-workspace/validation/recent`
- `POST /google-workspace/validation/decision` body `{ decision: 'approve' | 'reject' }`

- [ ] Add tests proving approve/reject are owner-only and never start historical import.
- [ ] Return current `validationStatus` in recent-validation response.

### Task 4: Add read-only Gmail thread detail

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-types.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-api-thread-detail.test.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-profile-email.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-profile-email.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Routes:**
- `GET /google-workspace/profiles/:organizationId/emails`
- `GET /google-workspace/profiles/:organizationId/emails/:threadId`

- [ ] Test that profile list returns only approved mappings for that organization.
- [ ] Test cross-profile thread IDs return 404.
- [ ] Add live Gmail thread fetch with chronological readable bodies and attachment metadata only.
- [ ] No Google mutation method may be introduced.

### Task 5: Add profile Email UI and sample approval controls

**Files:**
- Modify: `artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts`
- Modify: `artifacts/adventure-zone/src/components/google-workspace/google-recent-validation.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/profile-google-email-panel.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/profile-google-email-panel.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.tsx`

- [ ] Show resolved profile next to contact matches in validation results.
- [ ] Add `Approve sample` and `Reject / keep reviewing` controls.
- [ ] Add profile Emails panel/list; thread opens inline/modal with full live Gmail thread and attachment list.
- [ ] Clearly label that approved sample is not the historical backfill.

### Task 6: Verification and stacked PR

- [ ] Compare against `fix/google-workspace-business-relevance-only` and ensure only this phase is included.
- [ ] Run focused Google API/frontend tests and builds if runner executes.
- [ ] Open a draft PR with base `fix/google-workspace-business-relevance-only` until PR #453 merges, then retarget to `main`.
- [ ] Keep `GOOGLE_WORKSPACE_SYNC_ENABLED=false` and `GOOGLE_WORKSPACE_AI_ENABLED=false`.