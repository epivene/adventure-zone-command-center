# Google Email Review and Profile Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner resolve ambiguous Gmail validation items to profiles and store approved sample attachments as durable profile files without enabling historical backfill.

**Architecture:** Extend the existing validation repository with pending review rows and manual decisions. Reuse the existing approved mapping as the single downstream ownership source. Add a small attachment-copy service over the existing private-object-storage adapter and expose owner-only review/file APIs plus profile UI.

**Tech Stack:** TypeScript, Express 5, PostgreSQL, Gmail read-only API, existing Google Cloud private object storage, React/Vite, Vitest/Supertest.

**Spec:** `docs/superpowers/specs/2026-08-24-google-email-review-files-design.md`

## Global Constraints

- Keep full historical Gmail processing disabled.
- Never persist ignored/personal message bodies.
- Needs Review stays unlinked until explicit owner action.
- Manual resolution must verify the target organization exists and is live.
- Gmail stays read-only.
- File bytes are private, checksum-deduplicated, and profile-authorized.
- Signed file URLs expire after 900 seconds.
- Leg managers have no routes for this data.
- AI remains disabled and unnecessary.

---

### Task 1: Persist review items and manual decisions

**Files:**
- Modify: `artifacts/api-server/src/db/google-workspace-startup-migration.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-validation-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-validation-review.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-recent-validation-service.ts`

**Interfaces:**

```ts
export type GoogleValidationReviewItem = {
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  internalDateMs: number | null;
  evidenceCodes: string[];
  candidates: Array<{ id: string; name: string }>;
  hasAttachments: boolean;
  state: "pending" | "resolved" | "ignored";
  resolvedOrganizationId: string | null;
};

listReviewItems(): Promise<GoogleValidationReviewItem[]>;
resolveReviewItem(input: { messageId: string; organizationId: string; actorId: string; now: Date }): Promise<void>;
ignoreReviewItem(input: { messageId: string; actorId: string; now: Date }): Promise<void>;
```

- [ ] Write failing repository/service tests for persistence, target verification, resolution, ignore, and audit.
- [ ] Implement startup table `google_workspace_validation_review_items` with one row per connection/message.
- [ ] Persist current Needs Review metadata after each bounded validation run.
- [ ] Resolve by upserting the normal validation mapping; ignore without mapping.
- [ ] Ensure rerunning validation preserves explicit resolved/ignored decisions.

### Task 2: Add owner review APIs

**Files:**
- Modify: `artifacts/api-server/src/routes/google-workspace-validation.ts`
- Modify: `artifacts/api-server/src/routes/google-workspace-validation.test.ts`

**Routes:**

```text
GET  /google-workspace/validation/review
PUT  /google-workspace/validation/review/:messageId   { organizationId }
POST /google-workspace/validation/review/:messageId/ignore
```

- [ ] Write route tests for list/resolve/ignore and invalid organization/message IDs.
- [ ] Implement owner-only routes under existing owner mount.
- [ ] Return safe 404 for stale/unknown targets.

### Task 3: Add read-only Gmail attachment bytes and durable sample file storage

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-types.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-api-attachment.test.ts`
- Modify: `artifacts/api-server/src/db/google-workspace-startup-migration.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-file-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-file-service.test.ts`

**Interfaces:**

```ts
getAttachment(input: { messageId: string; attachmentId: string }): Promise<Uint8Array>;
copyApprovedThreadAttachments(input: { organizationId: string; threadId: string }): Promise<GoogleProfileFile[]>;
listProfileFiles(organizationId: string): Promise<GoogleProfileFile[]>;
openProfileFile(input: { organizationId: string; fileId: string }): Promise<string>;
```

- [ ] Add Gmail attachment read method only; no mutation methods.
- [ ] Add private sample-file table with checksum, storage key, source identity, profile ID, availability and timestamps.
- [ ] Parse attachment IDs from the already-authorized full thread response.
- [ ] Upload bytes with `GoogleCloudPrivateObjectStorage` using `GOOGLE_CLOUD_STORAGE_BUCKET`.
- [ ] Deduplicate identical bytes by SHA-256 and keep idempotent source rows.
- [ ] Signed open URL TTL is 900 seconds.

### Task 4: Add profile file/review routes and UI

**Files:**
- Modify: `artifacts/api-server/src/routes/google-workspace-profile-email.ts`
- Modify: `artifacts/api-server/src/routes/google-workspace-profile-email.test.ts`
- Modify: `artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-validation-review.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-validation-review.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.tsx`
- Modify: `artifacts/adventure-zone/src/components/google-workspace/profile-google-email-panel.tsx`
- Modify: `artifacts/adventure-zone/src/components/google-workspace/profile-google-email-panel.test.tsx`

**Routes:**

```text
POST /google-workspace/profiles/:organizationId/threads/:threadId/copy-files
GET  /google-workspace/profiles/:organizationId/files
POST /google-workspace/profiles/:organizationId/files/:fileId/open
```

- [ ] Add Needs Review panel with suggested profile buttons, profile search/select, and Ignore.
- [ ] Add `Files` view beside `Emails` on the profile Google panel.
- [ ] Allow owner to copy attachments from an approved thread, then list/open stored files.
- [ ] Show unavailable/retry state without hiding the conversation.

### Task 5: Verification and PR

- [ ] Run focused API/frontend Google tests and builds when executable runner is available.
- [ ] Verify no Gmail mutation method exists and full backfill flags remain untouched.
- [ ] Compare branch against `main`; remove unrelated drift.
- [ ] Open a draft PR if Actions again fails before step 1; do not claim passing CI without output.