# Gmail Profile Label Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Email Review assignments apply one stable profile label to the real Gmail thread and archive that reviewed thread, while ignored mail remains untouched and future replies stay unread and visible in Inbox.

**Architecture:** Extend the existing Google Workspace integration with a narrowly scoped Gmail mutation port, a durable profile-to-label-ID mapping, and an idempotent mutation outbox. Route both review assignment paths through one orchestration service; hook later thread-inherited messages into message-level labeling without removing `INBOX` or `UNREAD`.

**Tech Stack:** TypeScript 5.9, Node.js, Express 5, PostgreSQL, Drizzle ORM 0.45, React 19, Vite 7, Vitest 4, Testing Library, Gmail REST API.

**Spec:** `docs/superpowers/specs/2026-09-08-gmail-profile-label-sync-design.md`

## Global Constraints

- Reuse the exact Gmail hierarchy `Z - AdventureZone/Profiles/<Profile Name>`; never create a second Profiles root.
- Gmail label IDs, not names, are the durable profile-label identity.
- A profile has at most one Gmail profile label per Workspace connection, and a Gmail label ID belongs to at most one active profile mapping.
- Assign applies the target profile label to the whole current thread, removes other managed profile labels, and removes `INBOX`.
- Ignore makes no Gmail API mutation.
- A future inbound reply receives the profile label at message level but keeps both `INBOX` and `UNREAD`.
- No sender-based Gmail filters are created.
- Never automatically delete a Gmail label.
- Conflicting existing labels stop with a visible error; the system never guesses or creates another.
- Mutations remain disabled unless `GOOGLE_WORKSPACE_GMAIL_PROFILE_LABEL_SYNC_ENABLED=true`.
- Automated tests use fake fetch/Gmail clients and never mutate the real mailbox.
- No OAuth tokens, message bodies, or complete recipient lists may be logged.

---

## File Structure

- `lib/db/src/google-workspace-schema.ts`: Drizzle definitions for profile-label mappings and Gmail mutation jobs.
- `lib/db/migrations/20260908_gmail_profile_label_sync.sql`: forward-only production migration.
- `artifacts/api-server/src/db/google-workspace-startup-migration.ts`: idempotent startup compatibility migration.
- `artifacts/api-server/src/features/google-workspace/google-api-types.ts`: Gmail mutation port types.
- `artifacts/api-server/src/features/google-workspace/google-api-client.ts`: OAuth scope and Gmail REST mutation adapter.
- `artifacts/api-server/src/features/google-workspace/google-profile-label-config.ts`: feature switch and canonical root.
- `artifacts/api-server/src/features/google-workspace/google-profile-label-repository.ts`: stable label mapping persistence.
- `artifacts/api-server/src/features/google-workspace/google-profile-label-resolver.ts`: adopt/create/rename/conflict logic.
- `artifacts/api-server/src/features/google-workspace/google-gmail-mutation-repository.ts`: durable idempotency and retry state.
- `artifacts/api-server/src/features/google-workspace/google-profile-label-sync-service.ts`: explicit thread assignment and future-message labeling.
- Existing validation repositories/routes: persist CRM decisions and invoke the shared sync service.
- Existing React review/settings files: display completion, reconnect, conflict, and retry states.

---

### Task 1: Persist Stable Label Mappings and Mutation State

**Files:**
- Modify: `lib/db/src/google-workspace-schema.ts`
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/20260908_gmail_profile_label_sync.sql`
- Modify: `artifacts/api-server/src/db/google-workspace-startup-migration.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-workspace-schema-contract.test.ts`
- Create: `artifacts/api-server/src/db/google-workspace-profile-label-migration.pglite.test.ts`

**Interfaces:**
- Produces: `googleWorkspaceProfileLabels` and `googleWorkspaceGmailMutations`.
- Produces: `GoogleWorkspaceGmailMutationState = "pending" | "processing" | "completed" | "retryable_error" | "permanent_error" | "conflict"`.

- [ ] **Step 1: Write failing schema contract tests**

Add exact assertions:

```ts
expect(source).toContain("google_workspace_profile_labels_connection_organization_unique");
expect(source).toContain("google_workspace_profile_labels_connection_label_unique");
expect(source).toContain("google_workspace_gmail_mutations_idempotency_unique");
expect(source).toContain("google_workspace_gmail_mutations_retry_idx");
expect(source).toContain("gmail_sync_state");
```

The PGlite test must create a connection and two organizations, run `ensureGoogleWorkspaceSchema`, and assert that duplicate `(connection_id, organization_id)`, duplicate `(connection_id, gmail_label_id)`, and duplicate nonblank `idempotency_key` inserts each fail with a uniqueness violation.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server test -- google-workspace-schema-contract.test.ts google-workspace-profile-label-migration.pglite.test.ts
```

Expected: FAIL because the tables, constraints, and review sync columns do not exist.

- [ ] **Step 3: Add the Drizzle schema**

Define these records:

```ts
export const googleWorkspaceGmailMutationStates = [
  "pending",
  "processing",
  "completed",
  "retryable_error",
  "permanent_error",
  "conflict",
] as const;

export const googleWorkspaceProfileLabels = pgTable(
  "google_workspace_profile_labels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id").notNull()
      .references(() => googleWorkspaceConnections.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    gmailLabelId: text("gmail_label_id").notNull(),
    gmailLabelName: text("gmail_label_name").notNull(),
    state: text("state").$type<"active" | "conflict" | "unavailable">()
      .default("active").notNull(),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("google_workspace_profile_labels_connection_organization_unique")
      .on(table.connectionId, table.organizationId),
    uniqueIndex("google_workspace_profile_labels_connection_label_unique")
      .on(table.connectionId, table.gmailLabelId),
  ],
);
```

Define `google_workspace_gmail_mutations` with `connection_id`, `message_id`, `thread_id`, `organization_id`, `operation` (`assign_thread` or `label_inbound_message`), `target_label_id`, JSONB `remove_label_ids`, `idempotency_key`, state, attempt count, last error, next attempt, actor ID, and timestamps. Add `gmail_sync_state` and `gmail_sync_error_code` to `google_workspace_validation_review_items`.

- [ ] **Step 4: Add forward-only SQL and startup migration SQL**

Use the same columns and named constraints as the Drizzle schema. Add these checks:

```sql
CHECK (btrim(gmail_label_id) <> '' AND btrim(gmail_label_name) <> '');
CHECK (state IN ('active','conflict','unavailable'));
CHECK (operation IN ('assign_thread','label_inbound_message'));
CHECK (state IN ('pending','processing','completed','retryable_error','permanent_error','conflict'));
CHECK (jsonb_typeof(remove_label_ids) = 'array');
```

Default legacy review rows to `gmail_sync_state = 'not_requested'`; allow `not_requested`, `pending`, `completed`, `retryable_error`, `permanent_error`, and `conflict`. Mirror the migration with idempotent `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements in startup migration.

- [ ] **Step 5: Run migration, schema, and library checks**

Run:

```bash
pnpm --filter @workspace/api-server test -- google-workspace-schema-contract.test.ts google-workspace-profile-label-migration.pglite.test.ts
pnpm run typecheck:libs
```

Expected: PASS.

- [ ] **Step 6: Commit the persistence slice**

```bash
git add lib/db/src/google-workspace-schema.ts lib/db/src/schema/index.ts lib/db/migrations/20260908_gmail_profile_label_sync.sql artifacts/api-server/src/db/google-workspace-startup-migration.ts artifacts/api-server/src/features/google-workspace/google-workspace-schema-contract.test.ts artifacts/api-server/src/db/google-workspace-profile-label-migration.pglite.test.ts
git commit -m "feat: persist Gmail profile label mappings"
```

---

### Task 2: Add Gmail Modify Authorization and a Narrow Mutation Client

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-types.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-gmail-label-client.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-connection-repository.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-connection-repository.test.ts`
- Modify: `artifacts/api-server/src/routes/google-workspace-oauth-callback.test.ts`
- Modify: `artifacts/api-server/src/routes/google-workspace-account-change.test.ts`

**Interfaces:**
- Produces: `GOOGLE_WORKSPACE_GMAIL_MODIFY_SCOPE`.
- Produces: `GoogleGmailLabelMutationClient`.
- Produces: `PostgresGoogleConnectionRepository.createGmailLabelMutationClient()`.

```ts
export type GoogleGmailLabelMutationClient = {
  listLabels(): Promise<GoogleLabelSummary[]>;
  createLabel(name: string): Promise<GoogleLabelSummary>;
  renameLabel(input: { labelId: string; name: string }): Promise<GoogleLabelSummary>;
  modifyThreadLabels(input: {
    threadId: string;
    addLabelIds: string[];
    removeLabelIds: string[];
  }): Promise<void>;
  modifyMessageLabels(input: {
    messageId: string;
    addLabelIds: string[];
    removeLabelIds: string[];
  }): Promise<void>;
};
```

- [ ] **Step 1: Write failing OAuth and REST adapter tests**

Assert that the workspace authorization URL requests `gmail.modify` and does not request `gmail.readonly`. Assert the callback accepts exactly the requested workspace scopes and rejects a result missing `gmail.modify`.

Using a fake fetcher, assert:

```ts
expect(requests).toContainEqual(expect.objectContaining({
  url: "https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-1/modify",
  method: "POST",
  body: JSON.stringify({
    addLabelIds: ["Label_10"],
    removeLabelIds: ["Label_11", "INBOX"],
  }),
}));
```

Also cover `POST /labels`, `PATCH /labels/:id`, `POST /messages/:id/modify`, one 401 token refresh retry, 404 source-missing classification, 409 label conflict, 429 retryable rate limit, and 5xx retryable provider failure.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server test -- google-api-client.test.ts google-gmail-label-client.test.ts google-connection-repository.test.ts google-workspace-oauth-callback.test.ts google-workspace-account-change.test.ts
```

Expected: FAIL because `gmail.modify` and label mutation methods are absent.

- [ ] **Step 3: Replace the workspace Gmail scope**

Use:

```ts
export const GOOGLE_WORKSPACE_GMAIL_MODIFY_SCOPE =
  "https://www.googleapis.com/auth/gmail.modify";

export const GOOGLE_WORKSPACE_REQUIRED_SCOPES = [
  "openid",
  "email",
  GOOGLE_WORKSPACE_GMAIL_MODIFY_SCOPE,
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
] as const;
```

Keep legacy compose helpers working by treating `gmail.modify` as satisfying compose capability. Do not require both `gmail.compose` and `gmail.modify` from newly authorized accounts.

- [ ] **Step 4: Implement the Gmail mutation methods**

Add an internal authorized JSON request helper that accepts method/body, retries one 401 after refreshing the access token, and throws stable errors:

```text
GOOGLE_WORKSPACE_GMAIL_LABEL_NOT_FOUND
GOOGLE_WORKSPACE_GMAIL_LABEL_CONFLICT
GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED
GOOGLE_WORKSPACE_GMAIL_RETRYABLE_FAILURE
GOOGLE_WORKSPACE_GMAIL_MUTATION_FAILED
```

Validate Gmail IDs as nonblank strings, deduplicate add/remove arrays, reject any label ID present in both arrays, and send only JSON bodies. Return the provider-created label's `id`, `name`, and `type`.

- [ ] **Step 5: Gate the production mutation client by granted scope**

`createGmailLabelMutationClient()` returns `null` when no workspace connection exists. It throws `GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED` when status is reauthorization-required or granted scopes lack `gmail.modify`. It exposes only the five methods in `GoogleGmailLabelMutationClient`.

- [ ] **Step 6: Run the adapter and authorization tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 7: Commit the Gmail capability slice**

```bash
git add artifacts/api-server/src/features/google-workspace/google-api-types.ts artifacts/api-server/src/features/google-workspace/google-api-client.ts artifacts/api-server/src/features/google-workspace/google-api-client.test.ts artifacts/api-server/src/features/google-workspace/google-gmail-label-client.test.ts artifacts/api-server/src/features/google-workspace/google-connection-repository.ts artifacts/api-server/src/features/google-workspace/google-connection-repository.test.ts artifacts/api-server/src/routes/google-workspace-oauth-callback.test.ts artifacts/api-server/src/routes/google-workspace-account-change.test.ts
git commit -m "feat: authorize Gmail profile label changes"
```

---

### Task 3: Resolve One Stable Gmail Label per Profile

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-label-config.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-label-config.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-label-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-label-repository.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-label-resolver.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-label-resolver.test.ts`

**Interfaces:**
- Consumes: `GoogleGmailLabelMutationClient` from Task 2.
- Produces: `GoogleProfileLabelRepositoryPort`.
- Produces: `GoogleProfileLabelResolver.resolve`.

```ts
export const GOOGLE_PROFILE_LABEL_ROOT = "Z - AdventureZone/Profiles";

export type GoogleProfileLabelMapping = {
  connectionId: string;
  organizationId: string;
  gmailLabelId: string;
  gmailLabelName: string;
  state: "active" | "conflict" | "unavailable";
  lastErrorCode: string | null;
};

export type GoogleProfileLabelRepositoryPort = {
  getOrganization(input: { connectionId: string; organizationId: string }):
    Promise<{ id: string; name: string; consolidatedIntoId: string | null } | null>;
  findByOrganization(input: { connectionId: string; organizationId: string }):
    Promise<GoogleProfileLabelMapping | null>;
  findByLabelId(input: { connectionId: string; gmailLabelId: string }):
    Promise<GoogleProfileLabelMapping | null>;
  adopt(input: {
    connectionId: string;
    organizationId: string;
    gmailLabelId: string;
    gmailLabelName: string;
  }): Promise<GoogleProfileLabelMapping>;
  markConflict(input: {
    connectionId: string;
    organizationId: string;
    errorCode: string;
  }): Promise<void>;
  listManagedLabelIds(connectionId: string): Promise<string[]>;
};

export type GoogleProfileLabelResolution =
  | { status: "resolved"; mapping: GoogleProfileLabelMapping }
  | { status: "conflict"; code: "GOOGLE_WORKSPACE_PROFILE_LABEL_CONFLICT"; labels: GoogleLabelSummary[] };
```

- [ ] **Step 1: Write failing configuration and resolver tests**

Cover:

- only the literal `true` enables `GOOGLE_WORKSPACE_GMAIL_PROFILE_LABEL_SYNC_ENABLED`;
- `canonicalProfileLabelName("  Elko  County Fair ")` returns `Z - AdventureZone/Profiles/Elko County Fair`;
- blank names and names containing a slash, CR, LF, or NUL are rejected;
- an existing mapped label ID is reused even after the profile name changes;
- one exact canonical path is adopted;
- one normalized-compatible path is adopted;
- two normalized-compatible paths return conflict and never call `createLabel`;
- no compatible path creates one canonical label;
- a concurrent uniqueness violation reloads and returns the winning mapping;
- a label already mapped to another profile returns conflict;
- a consolidated/deleted organization returns `GOOGLE_WORKSPACE_REVIEW_TARGET_NOT_FOUND`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server test -- google-profile-label-config.test.ts google-profile-label-repository.test.ts google-profile-label-resolver.test.ts
```

Expected: FAIL because the config, repository, and resolver do not exist.

- [ ] **Step 3: Implement canonicalization and conflict normalization**

Use Unicode NFC for the saved display path. Collapse internal whitespace and trim every segment. For conflict detection only, use:

```ts
export function normalizedProfileLabelPath(value: string): string {
  return value
    .normalize("NFKC")
    .split("/")
    .map((part) => part.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US"))
    .join("/");
}
```

Never fuzzy-match, remove punctuation, or compare only leaf names outside the exact root.

- [ ] **Step 4: Implement repository uniqueness and adoption**

Use one transaction for `adopt`. Lock any existing organization mapping with `FOR UPDATE`, reject label ownership by another profile, and use the two database unique constraints as the concurrency backstop. Translate `23505` into a reload/reconcile path; do not issue another Gmail create request.

- [ ] **Step 5: Implement resolver order**

The exact order is saved mapping → current Gmail label ID verification → exact canonical match → single normalized-compatible match → conflict on multiple/owned match → create once → adopt returned ID. A missing previously mapped label marks the mapping unavailable and returns `GOOGLE_WORKSPACE_GMAIL_LABEL_NOT_FOUND`; it must not create a replacement automatically.

Do not rename labels in this task. Add a separate `reconcileDisplayName` method that performs collision checks and calls `renameLabel` only when explicitly invoked by a later profile-rename workflow.

- [ ] **Step 6: Run resolver tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 7: Commit the resolver slice**

```bash
git add artifacts/api-server/src/features/google-workspace/google-profile-label-config.ts artifacts/api-server/src/features/google-workspace/google-profile-label-config.test.ts artifacts/api-server/src/features/google-workspace/google-profile-label-repository.ts artifacts/api-server/src/features/google-workspace/google-profile-label-repository.test.ts artifacts/api-server/src/features/google-workspace/google-profile-label-resolver.ts artifacts/api-server/src/features/google-workspace/google-profile-label-resolver.test.ts
git commit -m "feat: reuse stable Gmail labels for profiles"
```

---

### Task 4: Make Gmail Mutations Idempotent and Retryable

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/google-gmail-mutation-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-gmail-mutation-repository.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-label-sync-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-label-sync-service.test.ts`

**Interfaces:**
- Consumes: label resolver and Gmail mutation client from Tasks 2–3.
- Produces: `GoogleProfileLabelSyncService.assignThread`, `labelInboundMessage`, and `retry`.

```ts
export type GoogleProfileLabelSyncResult = {
  state: "completed" | "retryable_error" | "permanent_error" | "conflict";
  gmailLabelId: string | null;
  gmailLabelName: string | null;
  errorCode: string | null;
};

export type GoogleProfileLabelSyncServicePort = {
  assignThread(input: {
    connectionId: string;
    messageId: string;
    threadId: string;
    organizationId: string;
    actorId: string;
    decisionRevision: string;
  }): Promise<GoogleProfileLabelSyncResult>;
  labelInboundMessage(input: {
    connectionId: string;
    messageId: string;
    threadId: string;
    organizationId: string;
  }): Promise<GoogleProfileLabelSyncResult>;
  retry(mutationId: string): Promise<GoogleProfileLabelSyncResult>;
};
```

- [ ] **Step 1: Write failing assignment and future-reply tests**

For `assignThread`, assert one call:

```ts
expect(gmail.modifyThreadLabels).toHaveBeenCalledWith({
  threadId: "thread-1",
  addLabelIds: ["Label_target"],
  removeLabelIds: ["Label_old", "INBOX"],
});
```

Assert `UNREAD` is never in `removeLabelIds`. Assert unmanaged Gmail labels are untouched.

For `labelInboundMessage`, assert:

```ts
expect(gmail.modifyMessageLabels).toHaveBeenCalledWith({
  messageId: "new-message",
  addLabelIds: ["Label_target"],
  removeLabelIds: [],
});
```

Cover Gmail-success/database-completion-failure retry, duplicate request replay, 429/5xx retry state, source missing permanent state, label conflict state, missing modify scope, and feature-disabled behavior.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server test -- google-gmail-mutation-repository.test.ts google-profile-label-sync-service.test.ts
```

Expected: FAIL because the mutation repository and service do not exist.

- [ ] **Step 3: Implement mutation claim and completion methods**

Provide:

```ts
createOrLoad(input: GoogleGmailMutationIntent): Promise<GoogleGmailMutationRecord>;
claim(id: string, now: Date): Promise<GoogleGmailMutationRecord | null>;
complete(input: { id: string; targetLabelId: string; removeLabelIds: string[]; now: Date }): Promise<void>;
fail(input: {
  id: string;
  state: "retryable_error" | "permanent_error" | "conflict";
  errorCode: string;
  nextAttemptAt: Date | null;
  now: Date;
}): Promise<void>;
```

Claim with `FOR UPDATE SKIP LOCKED` and a 60-second processing lease. Use an immutable idempotency key:

```text
assign-thread:<connectionId>:<threadId>:<organizationId>:<decisionRevision>
label-inbound:<connectionId>:<messageId>:<organizationId>
```

- [ ] **Step 4: Implement assignment behavior**

Resolve the target label, load every managed label ID from the mapping repository, remove managed IDs other than the target plus `INBOX`, and call `modifyThreadLabels`. Sort/deduplicate label arrays so retries send the same body.

Classify retry delay with:

```ts
export function gmailMutationRetryDelayMs(attempt: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}
```

If the Gmail call succeeded and database completion failed, a retry replays the same idempotent add/remove operation and then completes. Never compensate by removing the newly applied Gmail label.

- [ ] **Step 5: Implement future inbound behavior**

Resolve the existing organization mapping and call `modifyMessageLabels` with only the target label in `addLabelIds`; `removeLabelIds` is always empty. Do not call thread modification. This guarantees no automatic removal of `INBOX` or `UNREAD`.

- [ ] **Step 6: Run service tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 7: Commit the mutation slice**

```bash
git add artifacts/api-server/src/features/google-workspace/google-gmail-mutation-repository.ts artifacts/api-server/src/features/google-workspace/google-gmail-mutation-repository.test.ts artifacts/api-server/src/features/google-workspace/google-profile-label-sync-service.ts artifacts/api-server/src/features/google-workspace/google-profile-label-sync-service.test.ts
git commit -m "feat: sync profile labels to Gmail safely"
```

---

### Task 5: Route Every Manual Assignment Through the Shared Sync Service

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/google-validation-repository.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-validation-review.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-matched-email-correction-service.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-matched-email-correction-service.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-review-profile-assignment-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-review-profile-assignment-service.test.ts`
- Modify: `artifacts/api-server/src/routes/google-workspace-validation.ts`
- Modify: `artifacts/api-server/src/routes/google-workspace-validation.test.ts`
- Modify: `artifacts/api-server/src/routes/google-workspace-matched-corrections.ts`
- Modify: `artifacts/api-server/src/routes/google-workspace-matched-corrections.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-review-new-profile-service.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-review-new-profile-service.test.ts`

**Interfaces:**
- Consumes: `GoogleProfileLabelSyncServicePort`.
- Produces: one `GoogleReviewProfileAssignmentService.assign` entry point for existing-profile, corrected-profile, and create-profile review paths.

```ts
export type GoogleReviewAssignmentView = {
  organizationId: string;
  threadId: string;
  gmailSync: GoogleProfileLabelSyncResult;
};

assign(input: {
  source: "review" | "matched_correction" | "new_profile";
  messageId: string;
  organizationId: string;
  actorId: string;
  now: Date;
}): Promise<GoogleReviewAssignmentView>;
```

- [ ] **Step 1: Write failing orchestration and route tests**

Assert the order:

1. persist/return CRM decision context;
2. invoke `assignThread` with returned connection/thread IDs and decision revision;
3. persist review `gmail_sync_state`;
4. return the sync result.

Test that Ignore invokes neither the assignment service nor any Gmail client. Test all three assignment entry paths. Test owner authorization remains required. Test these route mappings:

```text
GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED -> 409
GOOGLE_WORKSPACE_PROFILE_LABEL_CONFLICT -> 409
GOOGLE_WORKSPACE_GMAIL_LABEL_NOT_FOUND -> 409
retryable Gmail failure -> 502 with retryable=true
invalid/deleted/consolidated target -> 404
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server test -- google-validation-review.test.ts google-matched-email-correction-service.test.ts google-review-profile-assignment-service.test.ts google-workspace-validation.test.ts google-workspace-matched-corrections.test.ts google-review-new-profile-service.test.ts
```

Expected: FAIL because manual assignment does not invoke Gmail sync or return sync state.

- [ ] **Step 3: Return durable decision context from repositories**

Change the persistence methods to return:

```ts
type PersistedGoogleReviewDecision = {
  connectionId: string;
  messageId: string;
  threadId: string;
  organizationId: string;
  decisionRevision: string;
};
```

Use the review row's updated timestamp plus message ID as the revision. Preserve existing validation mapping and audit semantics. Set `gmail_sync_state='pending'` only for assignment; Ignore sets `not_requested` and makes no Gmail call.

- [ ] **Step 4: Implement the shared assignment service**

Inject the correct persistence adapter for the source, call `assignThread`, and update the review row's Gmail sync fields. If Gmail is retryable/conflicted, preserve the CRM profile assignment and durable mutation job so Retry does not ask the owner to choose the profile again.

For a newly created profile, commit profile/contact creation before invoking Gmail. A Gmail failure must not roll back or duplicate the new profile.

- [ ] **Step 5: Wire both routers and new-profile creation**

Default route dependencies construct the shared service from the connection repository, label repository/resolver, mutation repository, and sync service. Tests inject fakes; no route test reaches Google.

Return:

```json
{
  "ok": true,
  "organizationId": "org-1",
  "gmailSync": {
    "state": "completed",
    "gmailLabelId": "Label_10",
    "gmailLabelName": "Z - AdventureZone/Profiles/Elko County Fair",
    "errorCode": null
  }
}
```

- [ ] **Step 6: Run assignment tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 7: Commit the assignment slice**

```bash
git add artifacts/api-server/src/features/google-workspace/google-validation-repository.ts artifacts/api-server/src/features/google-workspace/google-validation-review.test.ts artifacts/api-server/src/features/google-workspace/google-matched-email-correction-service.ts artifacts/api-server/src/features/google-workspace/google-matched-email-correction-service.test.ts artifacts/api-server/src/features/google-workspace/google-review-profile-assignment-service.ts artifacts/api-server/src/features/google-workspace/google-review-profile-assignment-service.test.ts artifacts/api-server/src/routes/google-workspace-validation.ts artifacts/api-server/src/routes/google-workspace-validation.test.ts artifacts/api-server/src/routes/google-workspace-matched-corrections.ts artifacts/api-server/src/routes/google-workspace-matched-corrections.test.ts artifacts/api-server/src/features/google-workspace/google-review-new-profile-service.ts artifacts/api-server/src/features/google-workspace/google-review-new-profile-service.test.ts
git commit -m "feat: label and archive assigned Gmail threads"
```

---

### Task 6: Label Later Replies Without Hiding Them

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/google-recent-validation-service.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-recent-validation-service.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-validation-learning-repository.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-validation-learning-repository.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-inbound-profile-labeler.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-inbound-profile-labeler.test.ts`

**Interfaces:**
- Consumes: `GoogleProfileLabelSyncServicePort.labelInboundMessage`.
- Produces: `GoogleInboundProfileLabeler.labelNewThreadMatches`.

```ts
labelNewThreadMatches(input: {
  connectionId: string;
  messages: Array<{
    messageId: string;
    threadId: string;
    organizationId: string;
    labelIds: string[];
    direction: "incoming" | "outgoing" | "unknown";
    evidenceCodes: string[];
  }>;
}): Promise<void>;
```

- [ ] **Step 1: Write failing thread-inheritance tests**

Seed an old manually assigned message in `thread-1`, then process a new inbound Gmail message with `labelIds: ["INBOX", "UNREAD"]`. Assert it maps to the same organization before sender inference and calls:

```ts
expect(labelInboundMessage).toHaveBeenCalledWith({
  connectionId: "conn-1",
  messageId: "new-message",
  threadId: "thread-1",
  organizationId: "org-1",
});
```

Assert the original metadata remains `["INBOX", "UNREAD"]`, the message appears in the normal matched result/unread projection, and no call is made for an outgoing message, a pending ambiguous message, or an older historical-backfill-only row.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server test -- google-inbound-profile-labeler.test.ts google-recent-validation-service.test.ts google-validation-learning-repository.test.ts
```

Expected: FAIL because later replies are not sent through message-level labeling.

- [ ] **Step 3: Make thread association the first deterministic lookup**

Expose a learning-repository method:

```ts
findThreadOrganization(input: {
  connectionId: string;
  threadId: string;
}): Promise<{ organizationId: string } | null>;
```

Return a target only when all active mappings for the thread agree on one unconsolidated organization. Multiple active organizations return `null` and force the existing manual-review path.

- [ ] **Step 4: Implement the inbound labeler**

Accept only incoming messages whose classification contains `existing_thread_association` and whose original Gmail labels contain `INBOX` or `UNREAD`. Call `labelInboundMessage` after the CRM mapping is durably upserted. Catch retryable Gmail failures after the mutation job is saved so Gmail trouble does not discard the CRM match or hide the email.

Never call `modifyThreadLabels`, never remove labels, and never change read state.

- [ ] **Step 5: Wire the recent/incremental validation path**

After `upsertRows` succeeds, pass newly discovered thread-inherited incoming matches to the inbound labeler. Do not invoke it from the historical backfill service. Preserve automatic ingestion and unread counting even when label sync is disabled or retrying.

- [ ] **Step 6: Run future-reply tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 7: Commit the future-reply slice**

```bash
git add artifacts/api-server/src/features/google-workspace/google-recent-validation-service.ts artifacts/api-server/src/features/google-workspace/google-recent-validation-service.test.ts artifacts/api-server/src/features/google-workspace/google-validation-learning-repository.ts artifacts/api-server/src/features/google-workspace/google-validation-learning-repository.test.ts artifacts/api-server/src/features/google-workspace/google-inbound-profile-labeler.ts artifacts/api-server/src/features/google-workspace/google-inbound-profile-labeler.test.ts
git commit -m "feat: label new Gmail replies without archiving"
```

---

### Task 7: Show Gmail Sync Status and Provide Safe Retry

**Files:**
- Modify: `artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts`
- Modify: `artifacts/adventure-zone/src/components/google-workspace/google-validation-review.tsx`
- Modify: `artifacts/adventure-zone/src/components/google-workspace/google-validation-review.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/google-workspace/google-matched-email-actions.tsx`
- Modify: `artifacts/adventure-zone/src/components/google-workspace/google-matched-email-actions.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.test.tsx`
- Create: `artifacts/api-server/src/routes/google-workspace-gmail-mutations.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-gmail-mutations.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Interfaces:**
- Consumes: mutation repository and sync service.
- Produces: retry endpoint and UI state.

```text
POST /google-workspace/gmail-mutations/:mutationId/retry
GET  /google-workspace/gmail-mutations/problems
```

- [ ] **Step 1: Write failing route and component tests**

Cover owner-only access, unknown mutation 404, completed mutation idempotent success, retryable retry, and conflict response.

Component assertions:

```ts
expect(screen.getByText("Assigned and archived in Gmail")).toBeVisible();
expect(screen.getByText("Ignored — left unchanged in Gmail")).toBeVisible();
expect(screen.getByRole("button", { name: "Retry Gmail sync" })).toBeEnabled();
expect(screen.getByText(/Reconnect Google Workspace/)).toBeVisible();
expect(screen.getByText(/Conflicting Gmail labels/)).toBeVisible();
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server test -- google-workspace-gmail-mutations.test.ts
pnpm --filter @workspace/adventure-zone test -- google-validation-review.test.tsx google-matched-email-actions.test.tsx SettingsGoogleWorkspacePage.test.tsx
```

Expected: FAIL because retry APIs and Gmail-sync presentation are absent.

- [ ] **Step 3: Add owner-only retry/problem routes**

Return only safe identifiers, profile name, label path, state, attempt count, and stable error code. Do not return OAuth/provider bodies. Retry only `retryable_error`; return current state idempotently for `completed`; return 409 for `conflict` or `permanent_error`.

- [ ] **Step 4: Extend frontend response types and review feedback**

Keep the selected assignment visible when Gmail sync is pending or failed. Show:

- success: **Assigned and archived in Gmail**;
- ignore: **Ignored — left unchanged in Gmail**;
- reauthorization: **Reconnect Google Workspace to finish labeling this thread**;
- retryable error: **Profile assigned; Gmail update needs retry** plus Retry;
- conflict: the exact conflicting label paths and **No new label was created**.

Do not optimistically show success before the API reports `completed`.

- [ ] **Step 5: Add settings permission/conflict state**

Replace read-only Gmail copy with precise permission copy: Gmail content remains business-scoped; the Command Center can add/rename profile labels and archive only threads explicitly assigned in Email Review. Show reconnect-required state when `gmail.modify` is missing. The problems list is informational plus retry; it contains no delete/merge-label action.

- [ ] **Step 6: Run route and UI tests**

Run the Step 2 commands.

Expected: PASS.

- [ ] **Step 7: Commit the UI/retry slice**

```bash
git add artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts artifacts/adventure-zone/src/components/google-workspace/google-validation-review.tsx artifacts/adventure-zone/src/components/google-workspace/google-validation-review.test.tsx artifacts/adventure-zone/src/components/google-workspace/google-matched-email-actions.tsx artifacts/adventure-zone/src/components/google-workspace/google-matched-email-actions.test.tsx artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.tsx artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.test.tsx artifacts/api-server/src/routes/google-workspace-gmail-mutations.ts artifacts/api-server/src/routes/google-workspace-gmail-mutations.test.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat: show Gmail label sync results"
```

---

### Task 8: Rollout Documentation and Full Verification

**Files:**
- Modify: `docs/operations/google-workspace-readonly-setup.md`
- Create: `docs/operations/gmail-profile-label-sync-rollout.md`
- Modify: `.env.example`
- Modify: `.github/workflows/google-workspace-sync-ci.yml`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: safe production reauthorization, dry conflict check, and controlled enablement procedure.

- [ ] **Step 1: Write the operations contract before editing docs**

The rollout document must contain these literal checkpoints:

```text
GOOGLE_WORKSPACE_GMAIL_PROFILE_LABEL_SYNC_ENABLED=false
Z - AdventureZone/Profiles
gmail.modify
Ignore makes no Gmail change
Future replies keep INBOX and UNREAD
Never delete duplicate labels automatically
```

Add a schema/source test in `google-workspace-schema-contract.test.ts` that reads both operations documents and asserts those safety strings are present.

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server test -- google-workspace-schema-contract.test.ts
```

Expected: FAIL until the documentation and environment example are updated.

- [ ] **Step 3: Update connection and rollout instructions**

Rename the setup heading from read-only to scoped Google Workspace setup while preserving historical context. Document that an administrator must reconnect once, verify the account address, approve `gmail.modify`, and confirm Calendar/Drive remain read-only.

The rollout runbook must require:

1. deploy with the feature disabled;
2. read/reconcile existing label inventory without creating labels;
3. report normalized conflicts under the established root;
4. manually resolve pre-existing duplicates;
5. reconnect and verify granted scopes;
6. enable one controlled assignment;
7. verify target profile label applied, other managed profile label removed, and `INBOX` removed;
8. receive a test reply;
9. verify the reply is in Inbox, remains unread, maps to the profile, and has the profile label;
10. enable normal use.

- [ ] **Step 4: Expand CI coverage**

Include the new migration, OAuth, resolver, mutation, assignment, future-reply, route, and React tests in `.github/workflows/google-workspace-sync-ci.yml`. Do not exclude the new Gmail mutation tests.

- [ ] **Step 5: Run focused suites**

Run:

```bash
pnpm --filter @workspace/api-server test --   google-workspace-profile-label-migration.pglite.test.ts   google-api-client.test.ts   google-gmail-label-client.test.ts   google-profile-label-config.test.ts   google-profile-label-repository.test.ts   google-profile-label-resolver.test.ts   google-gmail-mutation-repository.test.ts   google-profile-label-sync-service.test.ts   google-review-profile-assignment-service.test.ts   google-inbound-profile-labeler.test.ts   google-workspace-validation.test.ts   google-workspace-matched-corrections.test.ts   google-workspace-gmail-mutations.test.ts

pnpm --filter @workspace/adventure-zone test --   google-validation-review.test.tsx   google-matched-email-actions.test.tsx   SettingsGoogleWorkspacePage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run release checks**

Run:

```bash
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/adventure-zone run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/adventure-zone run build
```

Expected: PASS. If pre-existing unrelated typecheck failures remain, record exact failures and prove no changed file introduces a new failure; do not weaken the checks.

- [ ] **Step 7: Perform a code-only safety scan**

Run:

```bash
rg -n "gmail\.readonly|gmail\.modify|modifyThreadLabels|modifyMessageLabels|removeLabelIds|GOOGLE_WORKSPACE_GMAIL_PROFILE_LABEL_SYNC_ENABLED" artifacts/api-server artifacts/adventure-zone docs .env.example
```

Verify:

- no assignment path bypasses the shared assignment service;
- Ignore paths contain no Gmail mutation dependency;
- only explicit assignment adds `INBOX` to a removal list;
- future-message labeling always passes an empty removal list;
- no code calls Gmail label delete;
- no second profile-label root string exists.

- [ ] **Step 8: Commit the rollout slice**

```bash
git add docs/operations/google-workspace-readonly-setup.md docs/operations/gmail-profile-label-sync-rollout.md .env.example .github/workflows/google-workspace-sync-ci.yml artifacts/api-server/src/features/google-workspace/google-workspace-schema-contract.test.ts
git commit -m "docs: add Gmail profile label rollout checks"
```

- [ ] **Step 9: Request code review before merge**

Use the repository's normal review workflow and include this manual acceptance checklist in the PR description:

```text
[ ] Existing Gmail profile label reused by ID
[ ] Assignment labels and archives the current thread
[ ] Ignore leaves Gmail unchanged
[ ] Future reply remains in Inbox and unread
[ ] Conflicting labels create no new label
[ ] Reauthorization message is clear
[ ] Feature remains off until controlled rollout
```
