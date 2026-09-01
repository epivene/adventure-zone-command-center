# Profile Email Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an Office user compose email only from a profile, send it now or automatically at a scheduled business-local time through `theadventurezone12@gmail.com`, and see independent unread-email and upcoming-follow-up indicators on that profile.

**Architecture:** Extend the existing `office_email_drafts` workflow instead of creating a third email model. Reuse the existing Google Workspace connection, Gmail raw-message builder, row-lease/idempotency patterns from `features/opportunity-email`, and live profile-thread mapping. Store scheduled-delivery and app-level read state in PostgreSQL, run delivery in a separately supervised worker, and expose profile-scoped Office endpoints consumed by focused React components.

**Tech Stack:** TypeScript 5.9, Node.js, Express 5, PostgreSQL, Drizzle ORM 0.45, React 19, Vite 7, Wouter, Vitest 4, Testing Library, Gmail API through the existing Google Workspace client.

**Spec:** `docs/superpowers/specs/2026-09-01-profile-email-command-center-design.md`

## Global Constraints

- Email composition begins from an individual profile only; `/office/emails` must not expose a recipient-independent compose action.
- Scheduled messages send automatically without a second approval.
- The only permitted sender is the connected `theadventurezone12@gmail.com` Workspace account.
- Opening a message never clears unread state; only an explicit **Mark read** action does.
- The unread-email badge and follow-up `!` badge render independently and simultaneously.
- Follow-up attention includes incomplete overdue follow-ups and incomplete follow-ups due at or before `now + 7 days`.
- User-entered schedule times use the configured business timezone, include the timezone abbreviation in confirmation copy, and are stored as UTC timestamps.
- Automatic tests use fake Gmail clients and never contact or send through the real mailbox.
- Message bodies, OAuth tokens, and complete recipient lists must not be written to logs.
- Production delivery remains disabled unless `PROFILE_EMAIL_SEND_ENABLED=true`; draft saving and read/follow-up indicators remain available while delivery is disabled.

---

### Task 1: Persist Office Outbox and Profile Read State

**Files:**
- Modify: `lib/db/src/office-coordinator-schema.ts`
- Modify: `lib/db/src/google-workspace-schema.ts`
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/20260901_profile_email_scheduling_and_attention.sql`
- Modify: `artifacts/api-server/src/db/office-coordinator-startup-migration.ts`
- Modify: `artifacts/api-server/src/features/office/office-schema-contract.test.ts`
- Create: `artifacts/api-server/src/features/office/office-email-migrations.test.ts`

**Interfaces:**
- Produces: `OfficeEmailState = "draft" | "scheduled" | "sending" | "sent" | "failed" | "cancelled"`.
- Produces: `officeEmailDrafts` fields `ccRecipients`, `bccRecipients`, `scheduledFor`, `businessTimeZone`, `gmailDraftId`, `gmailMessageId`, `gmailThreadId`, `sendRequestKey`, `scheduleRequestKey`, `dispatchLeaseOwner`, `dispatchLeaseExpiresAt`, `dispatchAttemptCount`, `lastAttemptAt`, `nextAttemptAt`, `lastSendError`, `cancelledAt`, and `sentAt`.
- Produces: `googleWorkspaceProfileEmailReads` keyed by `(connectionId, organizationId, messageId)` with `readByOfficeAccountId` and `readAt`.

- [ ] **Step 1: Write failing schema contract tests**

Add assertions that the Office state list and read-state identity are exact:

```ts
expect(officeEmailStateValues).toEqual([
  "draft", "scheduled", "sending", "sent", "failed", "cancelled",
]);
expect(source).toContain("google_workspace_profile_email_reads_connection_org_message_unique");
expect(source).toContain("office_email_drafts_dispatch_idx");
expect(source).toContain("office_email_drafts_send_request_unique");
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `pnpm --filter @workspace/api-server test -- office-schema-contract.test.ts office-email-migrations.test.ts`

Expected: FAIL because the new states, columns, migration, and read-state table do not exist.

- [ ] **Step 3: Extend the Drizzle schemas**

Use these state values and add the matching typed columns and indexes:

```ts
export const officeEmailStateValues = [
  "draft", "scheduled", "sending", "sent", "failed", "cancelled",
] as const;

export const googleWorkspaceProfileEmailReads = pgTable(
  "google_workspace_profile_email_reads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id").notNull()
      .references(() => googleWorkspaceConnections.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    threadId: text("thread_id").notNull(),
    readByOfficeAccountId: uuid("read_by_office_account_id").notNull()
      .references(() => officeAccounts.id, { onDelete: "restrict" }),
    readAt: timestamp("read_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("google_workspace_profile_email_reads_connection_org_message_unique")
      .on(table.connectionId, table.organizationId, table.messageId),
    index("google_workspace_profile_email_reads_org_read_idx")
      .on(table.organizationId, table.readAt),
  ],
);
```

Keep `recipientEmail` for the primary To recipient. Store Cc/Bcc as `jsonb` typed `string[]` with an empty-array default. Add partial unique indexes for non-null send and schedule request keys, and an index over `(state, scheduled_for, next_attempt_at, dispatch_lease_expires_at)`.

- [ ] **Step 4: Write the forward-only SQL migration and startup compatibility SQL**

The migration must transform legacy Office states without dropping data:

```sql
ALTER TABLE office_email_drafts DROP CONSTRAINT IF EXISTS office_email_drafts_state_valid;
ALTER TABLE office_email_drafts
  ADD COLUMN IF NOT EXISTS cc_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS bcc_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS business_time_zone text,
  ADD COLUMN IF NOT EXISTS gmail_draft_id text,
  ADD COLUMN IF NOT EXISTS gmail_message_id text,
  ADD COLUMN IF NOT EXISTS gmail_thread_id text,
  ADD COLUMN IF NOT EXISTS send_request_key text,
  ADD COLUMN IF NOT EXISTS schedule_request_key text,
  ADD COLUMN IF NOT EXISTS dispatch_lease_owner text,
  ADD COLUMN IF NOT EXISTS dispatch_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
UPDATE office_email_drafts SET state = 'draft' WHERE state IN ('submitted', 'needs_changes');
ALTER TABLE office_email_drafts ADD CONSTRAINT office_email_drafts_state_valid
  CHECK (state IN ('draft','scheduled','sending','sent','failed','cancelled'));
```

Create the read-state table and all named indexes in the same migration. Mirror idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements in `office-coordinator-startup-migration.ts`, following the repository's startup-schema pattern.

- [ ] **Step 5: Run schema tests and typecheck**

Run: `pnpm --filter @workspace/api-server test -- office-schema-contract.test.ts office-email-migrations.test.ts`

Expected: PASS.

Run: `pnpm run typecheck:libs`

Expected: PASS.

- [ ] **Step 6: Commit the schema slice**

```bash
git add lib/db/src/office-coordinator-schema.ts lib/db/src/google-workspace-schema.ts lib/db/src/schema/index.ts lib/db/migrations/20260901_profile_email_scheduling_and_attention.sql artifacts/api-server/src/db/office-coordinator-startup-migration.ts artifacts/api-server/src/features/office/office-schema-contract.test.ts artifacts/api-server/src/features/office/office-email-migrations.test.ts
git commit -m "feat: persist profile email scheduling and read state"
```

---

### Task 2: Add a Gmail Provider Restricted to the Adventure Zone Mailbox

**Files:**
- Create: `artifacts/api-server/src/features/office/office-gmail-provider.ts`
- Create: `artifacts/api-server/src/features/office/office-gmail-provider.test.ts`
- Create: `artifacts/api-server/src/features/office/office-email-config.ts`
- Create: `artifacts/api-server/src/features/office/office-email-config.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-connection-repository.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-gmail-delivery-connection.test.ts`

**Interfaces:**
- Consumes: `buildGmailRawMessage`, `PostgresGoogleConnectionRepository.createGmailDraftClient()`, `createGmailDeliveryClient()`, and `createReadClient()`.
- Produces: `OfficeGmailProvider.createOrUpdateDraft`, `sendDraft`, and `reconcileSend`.

```ts
export type OfficeGmailProviderPort = {
  createOrUpdateDraft(input: {
    gmailDraftId: string | null;
    to: string;
    cc: string[];
    bcc: string[];
    subject: string;
    body: string;
  }): Promise<{ draftId: string; messageId: string; threadId: string | null }>;
  sendDraft(input: { draftId: string }): Promise<{
    messageId: string;
    threadId: string;
    sentAt: Date;
  }>;
  reconcileSend(input: { messageId: string }): Promise<{
    messageId: string;
    threadId: string;
    sentAt: Date;
  } | null>;
};
```

- [ ] **Step 1: Write mailbox and MIME tests**

Test that a connected account other than `theadventurezone12@gmail.com` throws `OFFICE_GMAIL_SENDER_MISMATCH`, that missing authorization throws `GOOGLE_WORKSPACE_NOT_CONNECTED`, and that Cc/Bcc headers reject CR/LF injection.

```ts
await expect(provider.createOrUpdateDraft(validInput)).rejects.toMatchObject({
  code: "OFFICE_GMAIL_SENDER_MISMATCH",
});
expect(raw).toContain("Cc: sales@example.com");
expect(raw).toContain("Bcc: archive@example.com");
```

Also test that `readOfficeEmailConfig()` enables delivery only for the literal value `true`, requires a valid IANA `BUSINESS_TIME_ZONE` when delivery is enabled, and returns the fixed mailbox address rather than accepting an arbitrary From address.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `pnpm --filter @workspace/api-server test -- office-email-config.test.ts office-gmail-provider.test.ts google-api-client.test.ts google-gmail-delivery-connection.test.ts`

Expected: FAIL because the provider and Cc/Bcc raw-message support are absent.

- [ ] **Step 3: Extend the raw-message builder**

Change the builder input to accept optional arrays while preserving current callers:

```ts
export type GmailRawMessageInput = {
  to: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
};
```

Validate every address header against CR/LF, omit empty Cc/Bcc headers, and continue emitting a UTF-8 plain-text MIME body. Plain text satisfies the specification's constrained/safe rendering requirement.

- [ ] **Step 4: Implement the Office Gmail provider**

Before every create, update, or send operation, require `PROFILE_EMAIL_SEND_ENABLED=true` and verify the active Workspace connection's normalized account email equals `theadventurezone12@gmail.com`. Create a Gmail draft when `gmailDraftId` is null; otherwise update it. Reconcile uncertain sends by fetching message metadata and accepting only messages labeled `SENT`.

Do not log the raw message or recipients. Return stable error codes only.

- [ ] **Step 5: Run provider tests**

Run: `pnpm --filter @workspace/api-server test -- office-email-config.test.ts office-gmail-provider.test.ts google-api-client.test.ts google-gmail-delivery-connection.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the provider slice**

```bash
git add artifacts/api-server/src/features/office/office-gmail-provider.ts artifacts/api-server/src/features/office/office-gmail-provider.test.ts artifacts/api-server/src/features/office/office-email-config.ts artifacts/api-server/src/features/office/office-email-config.test.ts artifacts/api-server/src/features/google-workspace/google-api-client.ts artifacts/api-server/src/features/google-workspace/google-api-client.test.ts artifacts/api-server/src/features/google-workspace/google-connection-repository.ts artifacts/api-server/src/features/google-workspace/google-gmail-delivery-connection.test.ts
git commit -m "feat: send office profile mail through connected Gmail"
```

---

### Task 3: Implement Draft, Send, Schedule, Cancel, and Retry State Transitions

**Files:**
- Modify: `artifacts/api-server/src/features/office/office-email-types.ts`
- Modify: `artifacts/api-server/src/features/office/office-email-service.ts`
- Modify: `artifacts/api-server/src/features/office/office-email-service.test.ts`
- Modify: `artifacts/api-server/src/features/office/office-email-repository.ts`
- Create: `artifacts/api-server/src/features/office/office-email-repository.test.ts`
- Create: `artifacts/api-server/src/features/office/office-email-delivery-service.ts`
- Create: `artifacts/api-server/src/features/office/office-email-delivery-service.test.ts`

**Interfaces:**
- Consumes: `OfficeGmailProviderPort` from Task 2 and expanded schema from Task 1.
- Produces: `OfficeEmailDeliveryService.saveDraft`, `sendNow`, `schedule`, `cancel`, and `retry`.
- Produces repository lease methods used by Task 4.
- Produces: `ProfileEmailLinkSink.recordSentLink`, implemented with `PostgresGoogleValidationRepository.upsertRows`, so replies inherit the profile from the Gmail thread immediately.

```ts
export type OfficeEmailDraftView = {
  id: string;
  organizationId: string;
  contactId: string;
  recipientEmail: string;
  ccRecipients: string[];
  bccRecipients: string[];
  subject: string;
  body: string;
  state: OfficeEmailState;
  scheduledFor: string | null;
  businessTimeZone: string | null;
  sentAt: string | null;
  cancelledAt: string | null;
  lastSendError: string | null;
  updatedAt: string;
};

export type OfficeEmailDraftRecord = Omit<
  OfficeEmailDraftView,
  "scheduledFor" | "sentAt" | "cancelledAt" | "updatedAt"
> & {
  gmailDraftId: string | null;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  sendRequestKey: string | null;
  scheduleRequestKey: string | null;
  dispatchAttemptCount: number;
  scheduledFor: Date | null;
  sentAt: Date | null;
  cancelledAt: Date | null;
  updatedAt: Date;
};

export type ProfileEmailLinkSink = {
  recordSentLink(input: {
    messageId: string;
    threadId: string;
    organizationId: string;
    contactId: string | null;
    evidenceCodes: ["office_profile_email"];
  }): Promise<void>;
};

export type OfficeEmailDeliveryPort = {
  sendClaimed(input: {
    draftId: string;
    requestKey: string;
  }): Promise<OfficeEmailDraftView>;
};
```

- [ ] **Step 1: Write state-machine tests**

Cover these exact transitions:

```ts
expect(canOfficeEditDraft("draft")).toBe(true);
expect(canOfficeEditDraft("scheduled")).toBe(true);
expect(canOfficeEditDraft("sending")).toBe(false);
expect(canOfficeCancelDraft("scheduled")).toBe(true);
expect(canOfficeCancelDraft("sent")).toBe(false);
```

Test send request-key replay, schedule request-key replay, editing a scheduled draft back to `draft`, cancellation before claim, cancellation losing to an existing `sending` claim, uncertain-send reconciliation, and sanitized permanent failures.

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @workspace/api-server test -- office-email-service.test.ts office-email-repository.test.ts office-email-delivery-service.test.ts`

Expected: FAIL on the new states and methods.

- [ ] **Step 3: Implement repository transitions and atomic leases**

Add these exact methods:

```ts
getByIdForOffice(id: string, accountId: string): Promise<OfficeEmailDraftRecord | null>;
findBySendRequestKey(key: string): Promise<OfficeEmailDraftRecord | null>;
findByScheduleRequestKey(key: string): Promise<OfficeEmailDraftRecord | null>;
claimOneDue(input: { workerId: string; now: Date }): Promise<OfficeEmailDraftRecord | null>;
releaseLease(input: { draftId: string; workerId: string; now: Date }): Promise<void>;
cancelForOffice(input: { draftId: string; accountId: string; now: Date }): Promise<OfficeEmailDraftView>;
```

`claimOneDue` must use a transaction, `FOR UPDATE SKIP LOCKED`, a 60-second lease, and a predicate that accepts `scheduled` rows with `scheduledFor <= now`, `nextAttemptAt IS NULL OR <= now`, and an absent/expired lease. The claim updates state to `sending`, increments attempts, and records `lastAttemptAt`.

- [ ] **Step 4: Implement the delivery service**

`saveDraft` validates profile/contact membership, normalizes addresses, creates or updates the Gmail draft, then persists Gmail IDs. `sendNow` uses an immutable request key, transitions atomically to `sending`, sends the Gmail draft, and records `sent` plus Gmail IDs. `schedule` requires a future finite timestamp and an IANA timezone. `cancel` is allowed only from `scheduled`. `retry` reschedules a retryable failure or sends immediately when no schedule remains.

Classify `429`, rate limit, timeout, and 5xx errors as retryable. Use bounded exponential backoff:

```ts
export function officeEmailRetryDelayMs(attempt: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}
```

Authorization and sender mismatch failures transition to `failed` without automatic retry. Store only a safe code/message of at most 1,000 characters.

After Gmail confirms delivery, call the link sink with the sent message ID, thread ID, organization ID, contact ID, and evidence code `office_profile_email`. Persisting this deterministic link before returning success makes future replies on the thread profile-owned without waiting for the sent-message sweep.

- [ ] **Step 5: Run service and repository tests**

Run: `pnpm --filter @workspace/api-server test -- office-email-service.test.ts office-email-repository.test.ts office-email-delivery-service.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the delivery domain slice**

```bash
git add artifacts/api-server/src/features/office/office-email-types.ts artifacts/api-server/src/features/office/office-email-service.ts artifacts/api-server/src/features/office/office-email-service.test.ts artifacts/api-server/src/features/office/office-email-repository.ts artifacts/api-server/src/features/office/office-email-repository.test.ts artifacts/api-server/src/features/office/office-email-delivery-service.ts artifacts/api-server/src/features/office/office-email-delivery-service.test.ts
git commit -m "feat: add profile email outbox transitions"
```

---

### Task 4: Run Scheduled Delivery in a Supervised Worker

**Files:**
- Create: `artifacts/api-server/src/features/office/office-email-dispatcher.ts`
- Create: `artifacts/api-server/src/features/office/office-email-dispatcher.test.ts`
- Create: `artifacts/api-server/src/features/office/office-email-dispatcher-loop.ts`
- Create: `artifacts/api-server/src/features/office/office-email-dispatcher-loop.test.ts`
- Create: `artifacts/api-server/src/office-email-worker.ts`
- Modify: `artifacts/api-server/package.json`
- Modify: `artifacts/api-server/build.mjs`
- Modify: `render.yaml`
- Modify: `.replit`

**Interfaces:**
- Consumes: `claimOneDue`, `releaseLease`, and `OfficeEmailDeliveryService.sendClaimed` from Task 3.
- Produces: independently startable `dist/office-email-worker.mjs` and `ScheduledOfficeEmailDispatcherLoop`.

- [ ] **Step 1: Write dispatcher and loop tests**

Use the existing `scheduled-email-dispatcher*.test.ts` pattern to prove idle polling, one-at-a-time claims, deterministic request keys, lease release, graceful shutdown, and error backoff.

```ts
expect(sendClaimed).toHaveBeenCalledWith({
  draftId: "draft-1",
  requestKey: "office-scheduled:scheduled-key-1",
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @workspace/api-server test -- office-email-dispatcher.test.ts office-email-dispatcher-loop.test.ts`

Expected: FAIL because the dispatcher does not exist.

- [ ] **Step 3: Implement dispatcher and loop**

Use 15 seconds while idle, 1 second after progress, and 60 seconds after an unexpected outer-loop error. The dispatcher calls `sendClaimed`, which owns durable failure handling, and releases the lease in `finally`. The deterministic worker request key is `office-scheduled:${scheduleRequestKey}`; reject a claimed row that lacks a schedule request key.

- [ ] **Step 4: Add a standalone worker entry point and build target**

`office-email-worker.ts` must validate configuration, construct the production repository/provider/service, start the loop, and close the loop plus DB pool on `SIGTERM`/`SIGINT`. Add scripts:

```json
{
  "build": "node ./build.mjs",
  "start": "node --enable-source-maps ./dist/index.mjs",
  "start:office-email-worker": "node --enable-source-maps ./dist/office-email-worker.mjs"
}
```

- [ ] **Step 5: Add deployment process definitions**

In `render.yaml`, add a private background worker using the same build and environment group as the API, with start command `pnpm --filter @workspace/api-server run start:office-email-worker`. Do not also start this Office worker inside `index.ts`; one supervised process prevents web autoscaling from multiplying schedules. Add a local Replit workflow task for the worker so development can exercise automatic dispatch.

- [ ] **Step 6: Run worker tests and build**

Run: `pnpm --filter @workspace/api-server test -- office-email-dispatcher.test.ts office-email-dispatcher-loop.test.ts`

Expected: PASS.

Run: `pnpm --filter @workspace/api-server run build`

Expected: both `dist/index.mjs` and `dist/office-email-worker.mjs` are produced.

- [ ] **Step 7: Commit the worker slice**

```bash
git add artifacts/api-server/src/features/office/office-email-dispatcher.ts artifacts/api-server/src/features/office/office-email-dispatcher.test.ts artifacts/api-server/src/features/office/office-email-dispatcher-loop.ts artifacts/api-server/src/features/office/office-email-dispatcher-loop.test.ts artifacts/api-server/src/office-email-worker.ts artifacts/api-server/package.json artifacts/api-server/build.mjs render.yaml .replit
git commit -m "feat: dispatch scheduled profile emails automatically"
```

---

### Task 5: Expose Profile-Scoped Office Email Commands

**Files:**
- Modify: `artifacts/api-server/src/routes/office-email-drafts.ts`
- Modify: `artifacts/api-server/src/routes/office-email-drafts.test.ts`
- Modify: `artifacts/api-server/src/routes/office-security-regression.test.ts`
- Modify: `artifacts/api-server/src/routes/office-admin-email-drafts.ts`
- Modify: `artifacts/api-server/src/routes/office-admin-email-drafts.test.ts`

**Interfaces:**
- Consumes: `OfficeEmailDeliveryService` from Task 3.
- Produces: authenticated Office routes for save, send-now, schedule, reschedule, cancel, and retry.

```text
POST   /office/profiles/:profileId/email-drafts
PATCH  /office/profiles/:profileId/email-drafts/:draftId
POST   /office/profiles/:profileId/email-drafts/:draftId/send
POST   /office/profiles/:profileId/email-drafts/:draftId/schedule
POST   /office/profiles/:profileId/email-drafts/:draftId/cancel
POST   /office/profiles/:profileId/email-drafts/:draftId/retry
GET    /office/profiles/:profileId/email-drafts
```

- [ ] **Step 1: Write route contract and authorization tests**

Assert that every command requires Office authentication, the URL profile owns the draft, the contact belongs to the profile, and a draft owned by another Office account cannot be modified. Validate request keys as UUIDs and scheduling payloads as:

```ts
const scheduleSchema = z.object({
  requestKey: z.string().uuid(),
  scheduledFor: z.string().datetime({ offset: true }),
  businessTimeZone: z.string().min(1).max(100),
}).strict();
```

- [ ] **Step 2: Run route tests and verify they fail**

Run: `pnpm --filter @workspace/api-server test -- office-email-drafts.test.ts office-admin-email-drafts.test.ts office-security-regression.test.ts`

Expected: FAIL on missing profile-scoped commands.

- [ ] **Step 3: Implement profile-scoped routes**

Return `409` for state conflicts, `404` for non-owned profile/draft pairs, `400` for invalid local/UTC schedule input, `503` for disconnected or wrong Gmail account, and `502` for provider failures. Never include OAuth/provider payloads in responses.

Retain owner-admin list visibility for operational support, but remove SMTP sending from `office-admin-email-drafts.ts`; all delivery must go through the connected Gmail service. Legacy `/office/email-drafts` list calls may remain as compatibility aliases for one release, but creation must require `:profileId`.

- [ ] **Step 4: Run route tests**

Run: `pnpm --filter @workspace/api-server test -- office-email-drafts.test.ts office-admin-email-drafts.test.ts office-security-regression.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the API command slice**

```bash
git add artifacts/api-server/src/routes/office-email-drafts.ts artifacts/api-server/src/routes/office-email-drafts.test.ts artifacts/api-server/src/routes/office-security-regression.test.ts artifacts/api-server/src/routes/office-admin-email-drafts.ts artifacts/api-server/src/routes/office-admin-email-drafts.test.ts
git commit -m "feat: expose profile email send and schedule commands"
```

---

### Task 6: Compute Unread Replies and Follow-Up Attention

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-email-attention-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-email-attention-repository.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-email-attention-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-email-attention-service.test.ts`
- Modify: `artifacts/api-server/src/routes/google-workspace-profile-email.ts`
- Modify: `artifacts/api-server/src/routes/google-workspace-profile-email.test.ts`
- Modify: `artifacts/api-server/src/routes/office-profiles.ts`
- Modify: `artifacts/api-server/src/routes/office-profiles.test.ts`

**Interfaces:**
- Consumes: approved Google validation mappings, Gmail thread detail, Office account identity, and `followUps`.
- Produces: `ProfileEmailAttentionView` and explicit `markRead`.

```ts
export type ProfileEmailAttentionView = {
  unreadCount: number;
  messages: Array<{
    messageId: string;
    threadId: string;
    subject: string;
    from: string;
    receivedAt: string;
    readAt: string | null;
  }>;
  followUp: null | {
    id: string;
    dueAt: string;
    overdue: boolean;
  };
};
```

- [ ] **Step 1: Write attention and read-state tests**

Cover thread association before address matching, inbound-only counting, explicit read persistence, opening-without-marking, separate Office actors marking the shared profile message read, ambiguous messages remaining unassigned, and exact follow-up boundaries.

```ts
expect(result.unreadCount).toBe(2);
expect(result.followUp?.overdue).toBe(false);
expect(await service.getAttention(profileId, nowPlusSevenDays)).toMatchObject({
  followUp: { id: "due-at-boundary" },
});
```

Treat a Gmail thread message as inbound when `direction === "incoming"` and its normalized From address is not `theadventurezone12@gmail.com`. Deduplicate by Gmail message ID across mappings.

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @workspace/api-server test -- google-profile-email-attention-repository.test.ts google-profile-email-attention-service.test.ts google-workspace-profile-email.test.ts office-profiles.test.ts`

Expected: FAIL because read receipts and attention projection are absent.

- [ ] **Step 3: Implement the repository and service**

The repository provides:

```ts
listReadMessageIds(input: { connectionId: string; organizationId: string; messageIds: string[] }): Promise<Set<string>>;
markRead(input: { connectionId: string; organizationId: string; messageId: string; threadId: string; officeAccountId: string; now: Date }): Promise<void>;
getNearestFollowUp(input: { organizationId: string; now: Date; through: Date }): Promise<{ id: string; dueAt: Date } | null>;
```

`markRead` first proves the organization owns the approved thread/message, then upserts the receipt. Follow-up SQL includes `completed_at IS NULL`, accepts overdue rows, and includes due timestamps exactly equal to `now + 7 days`.

Do not auto-assign ambiguous messages. Preserve the existing Google validation review queue as the manual assignment surface; once an administrator resolves a review item, its validation mapping makes the message eligible for this profile attention service.

- [ ] **Step 4: Add Office endpoints**

Add:

```text
GET  /office/profiles/:profileId/email-attention
POST /office/profiles/:profileId/emails/:messageId/read
GET  /office/profiles/:profileId/emails/:threadId
```

The attention endpoint fetches live mapped Gmail threads, applies app read receipts, and returns the nearest follow-up. The thread detail endpoint is read-only and must not call `markRead`. The read endpoint accepts `{ threadId }`, verifies ownership, writes the receipt, and returns a refreshed unread count.

- [ ] **Step 5: Run attention tests**

Run: `pnpm --filter @workspace/api-server test -- google-profile-email-attention-repository.test.ts google-profile-email-attention-service.test.ts google-workspace-profile-email.test.ts office-profiles.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the attention API slice**

```bash
git add artifacts/api-server/src/features/google-workspace/google-profile-email-attention-repository.ts artifacts/api-server/src/features/google-workspace/google-profile-email-attention-repository.test.ts artifacts/api-server/src/features/google-workspace/google-profile-email-attention-service.ts artifacts/api-server/src/features/google-workspace/google-profile-email-attention-service.test.ts artifacts/api-server/src/routes/google-workspace-profile-email.ts artifacts/api-server/src/routes/google-workspace-profile-email.test.ts artifacts/api-server/src/routes/office-profiles.ts artifacts/api-server/src/routes/office-profiles.test.ts
git commit -m "feat: expose profile unread mail and follow-up attention"
```

---

### Task 7: Add Send-Now and Schedule Controls to the Profile Composer

**Files:**
- Modify: `artifacts/adventure-zone/src/components/office/office-email-editor.tsx`
- Create: `artifacts/adventure-zone/src/components/office/office-email-editor.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/OfficeEmailDraftsPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/OfficeCommunications.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/OfficeWorkspace.test.tsx`
- Create: `artifacts/adventure-zone/src/lib/business-time-zone.ts`
- Create: `artifacts/adventure-zone/src/lib/business-time-zone.test.ts`

**Interfaces:**
- Consumes: Task 5 profile-scoped routes.
- Produces: profile-only composer supporting save, send now, schedule, reschedule, cancel, and retry.

- [ ] **Step 1: Write composer interaction tests**

Test primary-contact prefilling, editing recipients, Cc/Bcc expansion, save draft, send confirmation, schedule confirmation including timezone abbreviation, scheduled edit/cancel, failed retry, and no standalone compose button when `profileId` is absent.

```tsx
expect(screen.queryByRole("button", { name: /new email/i })).not.toBeInTheDocument();
expect(screen.getByText(/Sep 8, 2026 at 10:30 AM MDT/)).toBeInTheDocument();
```

- [ ] **Step 2: Run frontend tests and verify they fail**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/components/office/office-email-editor.test.tsx src/pages/OfficeCommunications.test.tsx src/pages/OfficeWorkspace.test.tsx src/lib/business-time-zone.test.ts`

Expected: FAIL because the controls and timezone conversion do not exist.

- [ ] **Step 3: Implement timezone conversion**

Export:

```ts
export function businessLocalInputToUtc(input: {
  localDateTime: string;
  timeZone: string;
}): string;

export function formatBusinessSchedule(input: {
  utcDateTime: string;
  timeZone: string;
}): string;
```

Use `Intl.DateTimeFormat` parts to resolve the business-local input, reject nonexistent daylight-saving times, and reject ambiguous fallback times with a message asking the user to choose an unambiguous time. Do not silently use the browser timezone.

- [ ] **Step 4: Update the editor and page**

Replace **Submit Email** with **Send now** and **Schedule**. Generate one `crypto.randomUUID()` per user command and reuse it if that same request is retried. Add status cards for `scheduled`, `sending`, `sent`, `cancelled`, and `failed`. Permit editing only `draft` and `scheduled`; saving a scheduled draft returns it to `draft` and requires scheduling again.

Keep the existing profile query-string entry path. If `/office/emails` is opened without `profileId`, show existing drafts and the instruction to open a profile; do not show recipient-independent compose.

- [ ] **Step 5: Run frontend tests**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/components/office/office-email-editor.test.tsx src/pages/OfficeCommunications.test.tsx src/pages/OfficeWorkspace.test.tsx src/lib/business-time-zone.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the composer slice**

```bash
git add artifacts/adventure-zone/src/components/office/office-email-editor.tsx artifacts/adventure-zone/src/components/office/office-email-editor.test.tsx artifacts/adventure-zone/src/pages/OfficeEmailDraftsPage.tsx artifacts/adventure-zone/src/pages/OfficeCommunications.test.tsx artifacts/adventure-zone/src/pages/OfficeWorkspace.test.tsx artifacts/adventure-zone/src/lib/business-time-zone.ts artifacts/adventure-zone/src/lib/business-time-zone.test.ts
git commit -m "feat: add profile email send and schedule controls"
```

---

### Task 8: Render Both Profile Attention Indicators and Message Actions

**Files:**
- Create: `artifacts/adventure-zone/src/components/office/office-profile-attention.tsx`
- Create: `artifacts/adventure-zone/src/components/office/office-profile-attention.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/OfficeProfilePage.tsx`
- Create: `artifacts/adventure-zone/src/pages/OfficeProfilePage.attention.test.tsx`

**Interfaces:**
- Consumes: `GET /office/profiles/:profileId/email-attention`, thread-detail, and explicit mark-read endpoints from Task 6.
- Produces: independent `N email(s)` and `!` controls in the top-right profile header.

- [ ] **Step 1: Write badge and message-list tests**

Cover zero/one/many unread labels, simultaneous badge rendering, polling cleanup, opening a message without changing the count, explicit mark read, and follow-up navigation.

```tsx
expect(screen.getByRole("button", { name: "2 unread emails" })).toBeVisible();
expect(screen.getByRole("button", { name: "Follow-up due within 7 days" })).toBeVisible();
await user.click(screen.getByRole("button", { name: /open email/i }));
expect(screen.getByRole("button", { name: "2 unread emails" })).toBeVisible();
await user.click(screen.getByRole("button", { name: "Mark read" }));
expect(screen.getByRole("button", { name: "1 unread email" })).toBeVisible();
```

- [ ] **Step 2: Run profile UI tests and verify they fail**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/components/office/office-profile-attention.test.tsx src/pages/OfficeProfilePage.attention.test.tsx`

Expected: FAIL because the profile attention UI does not exist.

- [ ] **Step 3: Implement the focused attention component**

Poll only while the page is visible, every 15 seconds, and refresh immediately after marking read. Render both controls in a `flex` container without mutual exclusion. Use these labels:

```ts
const emailLabel = unreadCount === 1 ? "1 email" : `${unreadCount} emails`;
```

The email control opens the profile message panel. Fetching or opening detail performs no write. **Mark read** calls the explicit endpoint, then refreshes attention. The `!` control scrolls to or expands the nearest follow-up using a stable `#follow-up-{id}` target; if the existing page lacks that target, render a compact due-date card in the attention panel.

- [ ] **Step 4: Place indicators in the profile header**

Keep **Email** and **Edit Profile** actions. Place `<OfficeProfileAttention profileId={profile.id} />` in the top-right header action group so both indicators remain visible on narrow screens with wrapping.

- [ ] **Step 5: Run profile UI tests**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/components/office/office-profile-attention.test.tsx src/pages/OfficeProfilePage.attention.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the profile UI slice**

```bash
git add artifacts/adventure-zone/src/components/office/office-profile-attention.tsx artifacts/adventure-zone/src/components/office/office-profile-attention.test.tsx artifacts/adventure-zone/src/pages/OfficeProfilePage.tsx artifacts/adventure-zone/src/pages/OfficeProfilePage.attention.test.tsx
git commit -m "feat: show profile email and follow-up badges"
```

---

### Task 9: Surface Connection and Worker Health

**Files:**
- Create: `artifacts/api-server/src/features/office/office-email-health.ts`
- Create: `artifacts/api-server/src/features/office/office-email-health.test.ts`
- Modify: `artifacts/api-server/src/routes/google-workspace-settings.ts`
- Modify: `artifacts/api-server/src/routes/google-workspace-settings.test.ts`
- Modify: `artifacts/adventure-zone/src/features/google-workspace/api.ts`
- Modify: `artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.test.tsx`
- Modify: `DEPLOY.md`

**Interfaces:**
- Consumes: Google connection state and Office outbox timestamps.
- Produces: settings response `emailDeliveryHealth` with mailbox, authorization, oldest due message, last sent time, and worker lag status.

```ts
export type OfficeEmailHealthView = {
  mailbox: string | null;
  senderReady: boolean;
  reconnectRequired: boolean;
  dueCount: number;
  oldestDueAt: string | null;
  lastSentAt: string | null;
  lastInboundSyncAt: string | null;
  workerStatus: "healthy" | "lagging" | "paused";
};
```

- [ ] **Step 1: Write health projection and settings tests**

Test healthy, delivery feature disabled, wrong mailbox, reauthorization required, queued but not overdue, last inbound mapping/sync timestamp, and lagging when the oldest due row is more than 90 seconds old.

- [ ] **Step 2: Run health tests and verify they fail**

Run: `pnpm --filter @workspace/api-server test -- office-email-health.test.ts google-workspace-settings.test.ts`

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/pages/SettingsGoogleWorkspacePage.test.tsx`

Expected: FAIL because health is not returned or rendered.

- [ ] **Step 3: Implement health projection and settings UI**

Return no message bodies or recipient data. Show `theadventurezone12@gmail.com`, feature-flag state, connection readiness, due queue count, last sent time, latest inbound sync/mapping time, and a reconnect or worker-lag warning. Replace the existing “draft-only Gmail compose” copy with wording that accurately states that the app can send immediately and at scheduled times.

- [ ] **Step 4: Document deployment operations**

In `DEPLOY.md`, document the required Google Gmail scopes already consumed by the provider, the fixed mailbox check, worker start command, graceful shutdown, safe restart behavior, and the health warning threshold. Include the rollback action: pause the background worker before rolling back the migration-dependent application version.

- [ ] **Step 5: Run health tests**

Run the same server and frontend commands from Step 2.

Expected: PASS.

- [ ] **Step 6: Commit the health slice**

```bash
git add artifacts/api-server/src/features/office/office-email-health.ts artifacts/api-server/src/features/office/office-email-health.test.ts artifacts/api-server/src/routes/google-workspace-settings.ts artifacts/api-server/src/routes/google-workspace-settings.test.ts artifacts/adventure-zone/src/features/google-workspace/api.ts artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.tsx artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.test.tsx DEPLOY.md
git commit -m "feat: surface profile email delivery health"
```

---

### Task 10: Verify the Complete Story

**Files:**
- Modify: `artifacts/api-server/src/routes/office-email-drafts.test.ts`
- Modify: `artifacts/api-server/src/routes/office-profiles.test.ts`
- Modify: `artifacts/adventure-zone/src/pages/OfficeCommunications.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/OfficeProfilePage.attention.test.tsx`
- Create: `docs/operations/profile-email-command-center.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: regression evidence and an operator runbook.

- [ ] **Step 1: Add cross-feature regression scenarios**

Create one server scenario that saves a profile draft, schedules it, claims it once at the due boundary, records a fake Gmail send, exposes the inbound reply as unread, marks it read explicitly, and still returns the follow-up badge. Create one frontend scenario that starts at the profile, schedules the message, returns to the profile, and renders both indicators.

- [ ] **Step 2: Run the complete feature test set**

Run:

```bash
pnpm --filter @workspace/api-server test -- office-email google-profile-email google-workspace-profile-email office-profiles google-workspace-settings
pnpm --filter @workspace/adventure-zone exec vitest run src/components/office src/pages/OfficeCommunications.test.tsx src/pages/OfficeWorkspace.test.tsx src/pages/OfficeProfilePage.attention.test.tsx src/pages/SettingsGoogleWorkspacePage.test.tsx src/lib/business-time-zone.test.ts
```

Expected: PASS with fake Gmail clients and zero real network calls.

- [ ] **Step 3: Run repository-wide verification**

Run: `pnpm run typecheck`

Expected: PASS.

Run: `pnpm run build`

Expected: PASS and both API entry bundles are produced.

- [ ] **Step 4: Write the operations runbook**

Document configuration validation, test scheduling, cancellation, retry inspection, worker lag diagnosis, reconnection, and how to confirm a sent message's Gmail message/thread IDs without logging its body.

- [ ] **Step 5: Perform a no-send production smoke checklist**

Verify in a staging or delivery-disabled deployment:

1. Connected account displays exactly `theadventurezone12@gmail.com`.
2. Profile-only composer can save and schedule a draft.
3. Scheduled row appears with a UTC timestamp matching the displayed business-local time.
4. Cancelling the row prevents worker claim.
5. A fixture inbound message remains unread after opening and clears only after **Mark read**.
6. An upcoming follow-up and unread-email badge render together.

Do not enable real Gmail delivery as part of automated verification.

- [ ] **Step 6: Commit verification and runbook**

```bash
git add artifacts/api-server/src/routes/office-email-drafts.test.ts artifacts/api-server/src/routes/office-profiles.test.ts artifacts/adventure-zone/src/pages/OfficeCommunications.test.tsx artifacts/adventure-zone/src/pages/OfficeProfilePage.attention.test.tsx docs/operations/profile-email-command-center.md
git commit -m "test: verify profile email command center"
```

