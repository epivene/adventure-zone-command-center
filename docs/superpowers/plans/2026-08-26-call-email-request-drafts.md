# Call Email Request Draft Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an **Asked me to send an email** call outcome that always preserves the call, creates one email follow-up and one durable profile draft request, and creates or safely holds one Gmail draft without altering the existing spreadsheet-lead draft workflow.

**Architecture:** Keep `leadGmailDraftLinks` and the spreadsheet `/lead-intake` draft flow unchanged. Add a separate profile/call draft-request persistence model keyed to the originating call request, then have the calls route invoke that post-call workflow only after `CallService.complete()` has committed successfully. Reuse the existing Google Gmail draft client/raw-message builder and shared profile/history/calendar data, but never manufacture a spreadsheet row.

**Tech Stack:** TypeScript, Express 5, React/Vite, Drizzle ORM/PostgreSQL, Vitest, Testing Library, Google Workspace Gmail Draft API.

**Spec:** `docs/superpowers/specs/2026-08-26-call-email-request-drafts-design.md`

## Global Constraints

- The two remaining spreadsheet outreach batches must keep using the existing spreadsheet lead Gmail-draft workflow unchanged.
- No call-record code may mutate spreadsheet lead rows or change the existing lead-draft endpoint contract.
- The app may create Gmail drafts only; this flow must not send email.
- Call logging is primary: Gmail failure must never roll back or erase the saved call or email follow-up.
- A repeated call completion/request must not create duplicate follow-ups or duplicate Gmail drafts.
- Missing recipient, blocked communication state, stale/unknown availability, or uncertain Gmail outcome must preserve a visible draft request for review rather than inventing evidence or blindly retrying.
- Standalone contact routes stay available for global contact/caller workflows; routine event-profile work should stay on the profile.

---

### Task 1: Add the call disposition without changing existing call semantics

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/20260826_call_email_request_drafts.sql`
- Modify: `artifacts/adventure-zone/src/features/calls/call-types.ts`
- Modify: `artifacts/adventure-zone/src/features/calls/call-input.ts`
- Modify: `artifacts/adventure-zone/src/features/calls/call-draft.ts`
- Modify: `artifacts/adventure-zone/src/components/calls/call-workspace.tsx`
- Test: `artifacts/api-server/src/features/calls/call-service.test.ts`
- Test: add/focus existing call workspace component test beside `call-workspace.tsx`

**Interfaces:**
- Produces public disposition: `"email_requested"`.
- Produces persisted DB disposition: `"email_requested"`.
- Existing `CompleteCallInput` stays structurally identical; only its disposition union grows.

- [ ] **Step 1: Write failing type/input tests**

Add assertions that `completeCallInputSchema` accepts `disposition: "email_requested"`, the public/persisted maps round-trip it, and a blank note gets the default text `Asked us to send information by email.`.

- [ ] **Step 2: Write failing UI test**

Render `CallWorkspace` and assert the disposition selector contains the visible option `Asked me to send an email` with value `email_requested`.

- [ ] **Step 3: Run focused tests and verify RED**

Run the focused API call tests and frontend call-workspace tests with Vitest. Expected failures must be specifically because `email_requested` is not yet in the enum/options/default note.

- [ ] **Step 4: Implement the minimal disposition change**

Add `email_requested` to `callDispositionValues`, the SQL enum migration, `CallDisposition`, `persistedCallDisposition`, `publicCallDisposition`, the Zod enum, local call-draft validation, and the UI option list. Add this branch to `defaultCallNote`:

```ts
email_requested: "Asked us to send information by email.",
```

Do not map this outcome to a booking status.

- [ ] **Step 5: Re-run focused tests and verify GREEN**

Confirm existing call outcomes still pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/index.ts lib/db/migrations/20260826_call_email_request_drafts.sql artifacts/adventure-zone/src/features/calls artifacts/adventure-zone/src/components/calls artifacts/api-server/src/features/calls/call-service.test.ts
git commit -m "feat: add email requested call outcome"
```

---

### Task 2: Add durable profile draft-request persistence and idempotency

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Modify: `lib/db/migrations/20260826_call_email_request_drafts.sql`
- Create: `artifacts/api-server/src/features/profile-email-drafts/profile-email-draft-types.ts`
- Create: `artifacts/api-server/src/features/profile-email-drafts/profile-email-draft-repository.ts`
- Test: `artifacts/api-server/src/features/profile-email-drafts/profile-email-draft-repository.pglite.test.ts`

**Interfaces:**
- Produces `ProfileEmailDraftRequestState = "pending" | "draft_ready" | "needs_review" | "retryable_error"`.
- Produces `ProfileEmailDraftRequestPurpose = "send_information"`.
- Produces repository methods:

```ts
findByCallRequestKey(requestKey: string): Promise<ProfileEmailDraftRequest | null>
createOrReuse(input: {
  requestKey: string;
  organizationId: string;
  contactId: string | null;
  bookingId: string | null;
  callActivityId: string;
  callSessionId: string;
  followUpId: string;
  purpose: "send_information";
  now: Date;
}): Promise<{ request: ProfileEmailDraftRequest; reused: boolean }>
markDraftReady(id: string, input: { gmailDraftId: string; gmailMessageId: string; recipientEmail: string; subject: string; body: string; now: Date }): Promise<ProfileEmailDraftRequest>
markNeedsReview(id: string, errorCode: string, now: Date): Promise<ProfileEmailDraftRequest>
markRetryableError(id: string, errorCode: string, now: Date): Promise<ProfileEmailDraftRequest>
```

- [ ] **Step 1: Write failing PGlite migration/repository tests**

Test that one request can be inserted with organization/contact/booking/call/follow-up links and that calling `createOrReuse` twice with the same `requestKey` returns one row.

- [ ] **Step 2: Run the repository test and verify RED**

Expected failure: table/repository does not exist.

- [ ] **Step 3: Add the dedicated table and migration**

Add `profile_email_draft_requests` with UUID primary key, non-null `request_key`, organization/call/follow-up references, nullable contact/booking, purpose/state, Gmail IDs, recipient/subject/body snapshots, last error, created/updated/completed timestamps, and a unique index on `request_key`.

Do not add nullable `rowId` or modify `lead_gmail_draft_links`.

- [ ] **Step 4: Implement repository mapping and idempotency**

Use a unique request-key lookup/upsert pattern. `draft_ready` records are reusable; `needs_review`/uncertain states are not silently recreated.

- [ ] **Step 5: Run PGlite test and verify GREEN**

- [ ] **Step 6: Run the existing lead Gmail draft migration/history tests unchanged**

This is the first spreadsheet-regression gate. No existing lead test file should require edits.

- [ ] **Step 7: Commit**

```bash
git add lib/db/src/schema/index.ts lib/db/migrations/20260826_call_email_request_drafts.sql artifacts/api-server/src/features/profile-email-drafts
git commit -m "feat: persist profile email draft requests"
```

---

### Task 3: Make email-requested calls create exactly one follow-up and one draft request

**Files:**
- Modify: `artifacts/api-server/src/features/calls/call-service.ts`
- Modify: `artifacts/api-server/src/features/calls/call-repository.ts`
- Modify: `artifacts/api-server/src/features/calls/call-types.ts`
- Test: `artifacts/api-server/src/features/calls/call-service.test.ts`
- Test: `artifacts/api-server/src/features/calls/assisted-calling.integration.test.ts`

**Interfaces:**
- `CompletedCall` gains enough IDs for post-commit orchestration:

```ts
{
  activityId: string;
  callSessionId: string;
  nextFollowUpId: string | null;
  disposition: CallDisposition;
  resultingBookingStatus: BookingStatus | null;
  organizationId: string | null;
  contactId: string | null;
  bookingId: string | null;
}
```

- For `email_requested`, `nextFollowUpId` is the generated open email follow-up ID even when the user did not manually select another next action.

- [ ] **Step 1: Add a failing service test for automatic email follow-up**

Call `complete()` with `email_requested`, `nextAction: null`, and assert `createFollowUp` receives:

```ts
{
  organizationId,
  contactId,
  bookingId: null,
  kind: "send_information",
  dueAt: completedAt,
}
```

The follow-up is intentionally due immediately because the requested action exists now; it remains open until the user sends/completes it.

- [ ] **Step 2: Add failing idempotency replay test**

A replay using the same call `requestKey` must return the already-linked follow-up ID and must not call `createFollowUp` again.

- [ ] **Step 3: Run tests and verify RED**

- [ ] **Step 4: Implement minimal service logic**

After creating the call activity and before the call session, create the automatic follow-up when `value.disposition === "email_requested"` and no equivalent `nextFollowUpId` already exists. Keep the existing manual `nextAction` behavior for all other dispositions. Return canonical organization/contact/booking IDs in `CompletedCall`.

Do not call Gmail from inside the DB transaction.

- [ ] **Step 5: Run call tests and verify GREEN**

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/calls
 git commit -m "feat: create email follow-up from call outcome"
```

---

### Task 4: Build the profile-based Gmail draft service without touching the lead service

**Files:**
- Create: `artifacts/api-server/src/features/profile-email-drafts/profile-email-draft-evidence.ts`
- Create: `artifacts/api-server/src/features/profile-email-drafts/profile-email-draft-message.ts`
- Create: `artifacts/api-server/src/features/profile-email-drafts/profile-email-draft-service.ts`
- Test: `artifacts/api-server/src/features/profile-email-drafts/profile-email-draft-service.test.ts`
- Reuse without semantic changes: `artifacts/api-server/src/features/google-workspace/google-api-client.ts`
- Reuse without semantic changes: `artifacts/api-server/src/features/google-workspace/google-api-types.ts`
- Regression test unchanged: `artifacts/api-server/src/features/lead-intake/gmail-draft-service.test.ts`

**Interfaces:**
- Service entry point:

```ts
createFromCall(input: {
  requestId: string;
  actorId: string;
}): Promise<{
  request: ProfileEmailDraftRequest;
  reused: boolean;
}>
```

- Evidence result:

```ts
type ProfileEmailDraftEvidence =
  | { ready: true; recipientEmail: string; subject: string; body: string }
  | { ready: false; code: string };
```

- [ ] **Step 1: Write failing service tests for ready, blocked, and uncertain cases**

Cover at least:

1. Valid recipient + safe evidence -> exactly one `createGmailDraft` call and `draft_ready` state.
2. Existing `draft_ready` request -> reuse; zero new Gmail API calls.
3. Missing/invalid recipient -> `needs_review`, no Gmail API call.
4. Communication-blocked contact -> `needs_review`, no Gmail API call.
5. Missing/ambiguous current event/package evidence where the full package pitch would make availability claims -> `needs_review`, no invented body.
6. Google transient rejection -> `retryable_error`.
7. Google outcome-uncertain error -> `needs_review` and no automatic retry.

- [ ] **Step 2: Run service tests and verify RED**

- [ ] **Step 3: Implement evidence gathering**

Load the linked organization/contact/booking, recent profile/ACT activity, mapped live Gmail history where available, approved communication template/package content, and current Calendar/package evidence when the body includes current availability claims. Return a blocker instead of filling gaps from assumptions.

The message builder must follow the approved history-aware rule: use evidence to choose the relationship angle, but do not dump all history into the email.

- [ ] **Step 4: Implement draft creation using existing Gmail primitives**

Acquire the existing Google Workspace Gmail-draft-capable connection and call:

```ts
client.createGmailDraft({
  raw: buildGmailRawMessage({
    to: evidence.recipientEmail,
    subject: evidence.subject,
    body: evidence.body,
  }),
});
```

Persist the Gmail IDs and a profile activity `Gmail draft created` only after a definite create result.

- [ ] **Step 5: Verify GREEN**

- [ ] **Step 6: Run existing spreadsheet Gmail draft service tests unchanged**

Expected: green, with no edits to `gmail-draft-service.ts` required for profile requests.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/profile-email-drafts
git commit -m "feat: create profile email drafts safely"
```

---

### Task 5: Orchestrate post-call draft creation without risking the saved call

**Files:**
- Modify: `artifacts/api-server/src/routes/calls.ts`
- Create: `artifacts/api-server/src/features/profile-email-drafts/call-email-request-handler.ts`
- Test: `artifacts/api-server/src/features/profile-email-drafts/call-email-request-handler.test.ts`
- Test: add route coverage beside existing calls route tests/integration tests

**Interfaces:**

```ts
handleEmailRequestedCall(input: {
  completedCall: CompletedCall;
  requestKey: string;
  actorId: string;
}): Promise<{
  draftState: "draft_ready" | "needs_review" | "retryable_error";
  draftRequestId: string;
  gmailDraftId: string | null;
} | null>
```

- [ ] **Step 1: Write failing handler tests**

Assert that non-email dispositions return `null`; `email_requested` creates/reuses one draft request linked to the generated follow-up; and draft-service failure becomes a result state rather than throwing away the completed call.

- [ ] **Step 2: Write failing calls-route test**

For an email-requested call, `/calls/complete` should still return `ok: true` after `CallService.complete()` succeeds even when the Gmail draft handler returns `needs_review`/`retryable_error`. Response should include a small `emailRequest` status object for the UI.

- [ ] **Step 3: Run and verify RED**

- [ ] **Step 4: Implement the post-commit orchestration**

Sequence in the route/service boundary:

```ts
const callResult = await callService.complete(parsed.data);
// call is committed here
const emailRequest = callResult.value.disposition === "email_requested"
  ? await handler.handleEmailRequestedCall(...)
  : null;
res.json({ ok: true, emailRequest });
```

Catch draft-handler failures, log them, and convert them into a preserved review state. Do not return HTTP 500 for a Gmail-only failure after the call has committed.

- [ ] **Step 5: Verify GREEN**

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/calls.ts artifacts/api-server/src/features/profile-email-drafts
git commit -m "feat: create draft request after email call"
```

---

### Task 6: Show the outcome clearly in the call UI

**Files:**
- Modify: `artifacts/adventure-zone/src/components/calls/call-workspace.tsx`
- Modify: `artifacts/adventure-zone/src/actions/calls.ts`
- Modify: `artifacts/adventure-zone/src/features/calls/call-types.ts`
- Test: add/focus `call-workspace` component tests

**Interfaces:**
- `CompleteCallResult` becomes:

```ts
type CompleteCallResult =
  | {
      ok: true;
      emailRequest?: {
        draftState: "draft_ready" | "needs_review" | "retryable_error";
        draftRequestId: string;
        gmailDraftId: string | null;
      } | null;
    }
  | { ok: false; error: string };
```

- [ ] **Step 1: Write failing component tests**

After save, assert:

- `draft_ready` shows `Email requested · Draft ready`.
- `needs_review` shows `Email requested · Needs review` while the call itself is still displayed as saved.
- `retryable_error` does not tell the user the call failed.

- [ ] **Step 2: Run and verify RED**

- [ ] **Step 3: Implement the saved-state status**

Keep current call-draft clearing behavior only after the call save succeeds. Render the returned email-request state near the saved confirmation. Do not add a Send button.

- [ ] **Step 4: Verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/components/calls artifacts/adventure-zone/src/actions/calls.ts artifacts/adventure-zone/src/features/calls/call-types.ts
git commit -m "feat: show requested email draft status"
```

---

### Task 7: Fix direct profile follow-up creation and the save failure

**Files:**
- Modify: `artifacts/api-server/src/features/follow-ups/follow-up-types.ts`
- Modify: `artifacts/api-server/src/features/follow-ups/follow-up-input.ts`
- Modify: `artifacts/api-server/src/features/follow-ups/follow-up-repository.ts`
- Modify: `artifacts/api-server/src/features/follow-ups/follow-up-service.ts`
- Modify: `artifacts/api-server/src/routes/follow-ups.ts`
- Test: `artifacts/api-server/src/routes/follow-ups.test.ts`
- Create: `artifacts/adventure-zone/src/components/profiles/profile-follow-up-dialog.tsx`
- Create: `artifacts/adventure-zone/src/components/profiles/profile-follow-up-dialog.test.tsx`
- Create/Modify: frontend follow-up action/client module using `apiPost`
- Modify: `artifacts/adventure-zone/src/components/profiles/profile-actions-menu.tsx`
- Modify: `artifacts/adventure-zone/src/components/profiles/simple-full-profile.tsx`

**Interfaces:**

Add creation support separate from edit:

```ts
type CreateFollowUpInput = {
  organizationId: string;
  contactId: string | null;
  bookingId: string | null;
  kind: string;
  dueAt: Date;
};

FollowUpService.create(input: CreateFollowUpInput): Promise<Result<FollowUpRecord, FollowUpError>>
POST /follow-ups
```

- [ ] **Step 1: Write failing API tests for `POST /follow-ups`**

Test success, invalid date/input, and missing parent organization. Confirm the created row is open (`completedAt: null`).

- [ ] **Step 2: Run and verify RED**

The current router supports PATCH/DELETE only, which explains why profile-level creation cannot be a simple reliable save today.

- [ ] **Step 3: Implement repository/service/router creation**

Validate parent IDs and insert one follow-up with the existing model. Return `{ ok: true, followUp }`.

- [ ] **Step 4: Write failing profile dialog tests**

Test mobile-friendly open form, kind/date submission, success close+refresh, and API error staying visible with the form still open.

- [ ] **Step 5: Replace the URL jump with the dialog**

In `ProfileActionsMenu`, replace `?action=follow-up` navigation with `onAddFollowUp`. Let `SimpleFullProfile` own dialog open state and call `onProfileSaved()` after successful creation so the next-follow-up card refreshes immediately.

- [ ] **Step 6: Verify API + frontend tests GREEN**

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/follow-ups artifacts/api-server/src/routes/follow-ups* artifacts/adventure-zone/src/components/profiles artifacts/adventure-zone/src/actions
git commit -m "fix: make profile follow-ups save directly"
```

---

### Task 8: Keep routine contact work on the event profile

**Files:**
- Modify: `artifacts/adventure-zone/src/components/profiles/simple-full-profile.tsx`
- Modify if needed: `artifacts/adventure-zone/src/components/profiles/profile-inline-editor.tsx`
- Test: add/focus profile component test
- Regression only: `artifacts/adventure-zone/src/pages/ContactDetailPage.tsx`
- Regression only: `artifacts/adventure-zone/src/App.tsx`

**Interfaces:**
- No route deletion.
- Contact cards inside an event profile must select/edit the contact in profile context rather than forcing `/contacts/:id` for routine booking work.

- [ ] **Step 1: Write failing profile navigation test**

Open the Contacts section and assert the routine action does not navigate to `/contacts/:id`; it should select the contact/profile editing context.

- [ ] **Step 2: Run and verify RED**

Current `SimpleFullProfile` uses `<Link href={`/contacts/${contact.id}`}>`.

- [ ] **Step 3: Implement profile-local contact selection/edit**

Use the existing profile `contactId` query/editing path or extend `ProfileInlineEditor` minimally so the selected contact can be edited without leaving `/profiles/:profileId`. Preserve standalone contact routes in `App.tsx`.

- [ ] **Step 4: Verify profile test and standalone contact route smoke tests GREEN**

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/components/profiles
git commit -m "refactor: keep event contact work on profile"
```

---

### Task 9: Full regression gate, especially the two sheet batches

**Files:**
- Do not modify spreadsheet lead draft behavior just to satisfy this task.
- Verify existing tests including:
  - `artifacts/api-server/src/features/lead-intake/gmail-draft-service.test.ts`
  - `artifacts/api-server/src/features/lead-intake/gmail-draft-handler.test.ts`
  - `artifacts/api-server/src/features/lead-intake/gmail-draft-history.pglite.test.ts`
  - `artifacts/api-server/src/features/lead-intake/gmail-draft-migration.pglite.test.ts`
  - `artifacts/adventure-zone/src/components/lead-intake/lead-email-preview.gmail-draft.test.tsx`
  - `artifacts/adventure-zone/src/components/lead-intake/lead-gmail-draft-state-list.test.tsx`

- [ ] **Step 1: Run all new focused API tests**

Expected: green.

- [ ] **Step 2: Run all new focused frontend tests**

Expected: green.

- [ ] **Step 3: Run the existing Task 8 spreadsheet Gmail draft suite unchanged**

Expected: green. If any regression appears, fix the new profile/call path rather than loosening or rewriting the lead-specific safeguards.

- [ ] **Step 4: Run focused production typechecks/build checks used by the existing Task 8 workflow**

Do not claim the repository-wide pre-existing typecheck issues are fixed unless they independently pass.

- [ ] **Step 5: Manual acceptance pass**

Verify:

1. Existing spreadsheet lead can still create its draft through the same UI/API as before.
2. Log a profile call with **Asked me to send an email**.
3. Confirm call history is saved.
4. Confirm one open `send_information` follow-up appears on the profile.
5. Confirm one profile email draft request exists.
6. With complete/verified evidence, confirm one Gmail draft exists and nothing was sent.
7. Repeat/replay the same call request key and confirm no duplicate follow-up/draft.
8. Simulate Gmail unavailable and confirm call + follow-up remain while status shows needs review/retryable.
9. Add a normal follow-up from a profile and confirm the next-follow-up card refreshes immediately.
10. Open/edit a routine event contact without being bounced into a separate contact page.

- [ ] **Step 6: Commit any test-only verification wiring if required**

```bash
git commit -m "test: verify call email draft workflow regressions"
```

## Self-review

- Spec coverage: call outcome, follow-up, durable request, Gmail draft/review state, failure isolation, profile follow-up UI, contact navigation, and spreadsheet regression all have explicit tasks.
- Placeholder scan: no TBD/TODO implementation placeholders are intentionally left in this plan.
- Type consistency: `email_requested`, `send_information`, `ProfileEmailDraftRequestState`, and `ProfileEmailDraftRequest` names are used consistently across tasks.
- Scope boundary: the existing `GmailDraftService` for spreadsheet leads remains a regression target rather than the persistence model for profile/call requests.
