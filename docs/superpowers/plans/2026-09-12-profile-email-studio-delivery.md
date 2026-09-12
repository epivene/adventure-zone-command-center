# Profile Email Studio Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match the approved profile mockup palette and let an authorized user review profile email activity, open a profile-linked HTML email in Design Studio, and truthfully save it in the app, create a Gmail draft, schedule it, or send it.

**Architecture:** Keep `office_email_drafts` as the canonical delivery record and link it to an immutable `design_project_versions` snapshot. Add a compact profile email summary that reuses the existing Google Workspace profile-email source, then extend the current Design Studio API/editor with profile-aware delivery commands. Real Gmail draft/send operations stay server-side behind the existing connection/readiness and exact-content outreach gates; scheduled delivery runs through a separately supervised worker using the repository's lease/idempotency conventions.

**Tech Stack:** TypeScript 5.9, Node.js 22, Express 5, PostgreSQL, Drizzle ORM, React, Vite, Wouter, Tailwind v4, Vitest 4, Testing Library, Gmail API through the existing Google Workspace client.

**Spec:** `docs/superpowers/specs/2026-09-12-profile-email-studio-delivery-design.md`

## Global Constraints

- Preserve existing profile routes, authentication, actions, search, filters, CSV export, plain-text drafts, ratings data, and full Gmail history.
- Use exactly `#f6f2e9`, `#fffefa`, `#182225`, `#536064`, `#d8d1c4`, `#e85d35`, `#bc3e20`, `#efb33f`, `#157d78`, `#32765a`, and `#a63f35` for the approved profile palette roles.
- Keep review stars visible as secondary gold context.
- Do not invent missing contacts, dates, deadlines, attendance, deal recommendations, campaign purpose, or profitability.
- The server derives the recipient from a linked active contact and never accepts a From account from the client.
- Save in app must have no Gmail side effect; Create Gmail Draft must create a real provider draft; Schedule and Send Now must use the frozen HTML version.
- Schedule and Send Now require exact-content outreach approval when that existing feature is enabled; changing recipient, subject, or HTML invalidates approval.
- Automatic tests use fake Gmail clients and never create drafts or send through a real mailbox.
- Never log HTML bodies, recipient addresses, OAuth credentials, or Gmail payloads containing message content.
- Do not add a second rollout flag; reuse current Gmail readiness and outreach gates.

## File Structure

- `profile-email-summary.tsx`: compact profile recipient, recent conversation, and active-draft presentation.
- `use-profile-google-email.ts`: shared query/state used by both compact and full Gmail views.
- `profile-email-studio.ts`: contact selection, linked project creation, and safe return-route helpers.
- `design-studio-email.ts` in `@workspace/api-zod`: shared constrained email-document schema and deterministic HTML renderer input contract.
- `office-email-types.ts`: canonical app/Gmail/schedule state and command DTOs.
- `office-email-repository.ts`: ownership-safe persistence, idempotency lookups, and atomic schedule claims.
- `office-design-email-service.ts`: freezes Design Studio versions and coordinates app draft, Gmail draft, schedule, cancel, and send commands.
- `office-gmail-provider.ts`: real Gmail draft/update/send boundary with no client-selected sender.
- `office-email-dispatcher*.ts`: due-row claim and supervised worker loop.
- `office-email-worker.ts`: separate production worker entrypoint.

---

### Task 1: Correct the Profile Palette and Action-to-Email Layout

**Files:**
- Modify: `artifacts/adventure-zone/src/components/organizations/organization-list.tsx`
- Modify: `artifacts/adventure-zone/src/components/profiles/profile-at-a-glance.tsx`
- Modify: `artifacts/adventure-zone/src/components/profiles/simple-full-profile.tsx`
- Modify: `artifacts/adventure-zone/src/components/organizations/organization-list-decision.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/profiles/profile-at-a-glance.test.tsx`
- Create: `artifacts/adventure-zone/src/components/profiles/simple-full-profile.palette.test.tsx`

**Interfaces:**
- Consumes: existing organization decision-card DTO, selected-profile state, review rating/count, and `ProfileAtAGlance` props.
- Produces: stable test IDs `profile-list-workspace`, `profile-card-<organizationId>`, `profile-detail-header`, `deal-model-band`, and `profile-action-flow` for focused layout tests.

- [ ] **Step 1: Write failing palette and layout tests**

```tsx
expect(screen.getByTestId("profile-list-workspace")).toHaveStyle({ backgroundColor: "#f6f2e9" });
expect(screen.getByTestId("profile-card-org-1")).toHaveStyle({ backgroundColor: "#fffefa" });
expect(screen.getByLabelText("4 out of 5 stars")).toHaveClass("text-[#efb33f]");
expect(screen.getByTestId("profile-detail-header")).toHaveClass("bg-[#fffefa]", "text-[#182225]");
expect(screen.getByTestId("deal-model-band")).toHaveClass("bg-[#182225]");
expect(screen.getByTestId("profile-action-flow")).not.toHaveClass("sticky");
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/components/organizations/organization-list-decision.test.tsx src/components/profiles/profile-at-a-glance.test.tsx src/components/profiles/simple-full-profile.palette.test.tsx`

Expected: FAIL on current teal/green palette classes and the sticky action treatment.

- [ ] **Step 3: Apply the exact approved palette**

Replace the off-spec hard-coded profile colors with the exact role mapping from Global Constraints. Keep status meaning fixed: contacted `#157d78`, booked `#32765a`, urgent `#e85d35`/`#a63f35`, neutral waiting, and reviews `#efb33f`. Change the detail header to white/paper with dark ink and a solid peach/orange edge; keep the deal-model band dark; add no gradient.

- [ ] **Step 4: Put actions in normal scroll flow**

Render the existing Add Note/Profile Actions group inside `data-testid="profile-action-flow"` without `sticky`, `fixed`, or an overlaying bottom offset. Preserve wrapping on mobile and leave a normal block insertion point immediately below it for Task 3's email summary.

- [ ] **Step 5: Run the focused tests**

Run the command from Step 2.

Expected: PASS, including gold review stars and non-sticky action flow.

- [ ] **Step 6: Commit the visual slice**

```bash
git add artifacts/adventure-zone/src/components/organizations/organization-list.tsx artifacts/adventure-zone/src/components/profiles/profile-at-a-glance.tsx artifacts/adventure-zone/src/components/profiles/simple-full-profile.tsx artifacts/adventure-zone/src/components/organizations/organization-list-decision.test.tsx artifacts/adventure-zone/src/components/profiles/profile-at-a-glance.test.tsx artifacts/adventure-zone/src/components/profiles/simple-full-profile.palette.test.tsx
git commit -m "fix: align profile workspace with approved palette"
```

---

### Task 2: Share the Existing Profile Gmail Query

**Files:**
- Create: `artifacts/adventure-zone/src/components/google-workspace/use-profile-google-email.ts`
- Create: `artifacts/adventure-zone/src/components/google-workspace/use-profile-google-email.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/google-workspace/profile-google-email-panel.tsx`
- Modify: `artifacts/adventure-zone/src/components/google-workspace/profile-google-email-panel.test.tsx`

**Interfaces:**
- Produces: `useProfileGoogleEmail(organizationId: string): ProfileGoogleEmailState`.

```ts
export type ProfileGoogleConversation = {
  threadId: string;
  subject: string;
  correspondent: string;
  occurredAt: string;
  preview: string;
};

export type ProfileGoogleEmailState = {
  conversations: ProfileGoogleConversation[];
  loading: boolean;
  error: string | null;
  openConversation(threadId: string): void;
};
```

- [ ] **Step 1: Write a failing shared-query test**

```tsx
expect(result.current.conversations.map((row) => row.threadId)).toEqual(["newest", "older"]);
expect(fetchMock).toHaveBeenCalledTimes(1);
act(() => result.current.openConversation("newest"));
expect(markReadMock).not.toHaveBeenCalled();
```

Cover most-recent-first ordering, the current matching endpoint, safe viewer opening, loading, and an isolated fetch error.

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/components/google-workspace/use-profile-google-email.test.tsx src/components/google-workspace/profile-google-email-panel.test.tsx`

Expected: FAIL because the panel owns the query privately.

- [ ] **Step 3: Extract the hook and retain full-panel behavior**

Move only query, normalization, sorting, and safe-viewer opening into the hook. Keep the full Emails/Files tabs and all existing content in `ProfileGoogleEmailPanel`; opening detail remains read-only.

- [ ] **Step 4: Run the focused tests**

Run the command from Step 2.

Expected: PASS with one request and unchanged full history behavior.

- [ ] **Step 5: Commit the shared-query slice**

```bash
git add artifacts/adventure-zone/src/components/google-workspace/use-profile-google-email.ts artifacts/adventure-zone/src/components/google-workspace/use-profile-google-email.test.tsx artifacts/adventure-zone/src/components/google-workspace/profile-google-email-panel.tsx artifacts/adventure-zone/src/components/google-workspace/profile-google-email-panel.test.tsx
git commit -m "refactor: share profile Gmail conversation state"
```

---

### Task 3: Add the Compact Profile Email Summary and Linked New Draft

**Files:**
- Create: `artifacts/adventure-zone/src/components/profiles/profile-email-summary.tsx`
- Create: `artifacts/adventure-zone/src/components/profiles/profile-email-summary.test.tsx`
- Create: `artifacts/adventure-zone/src/features/design-studio/profile-email-studio.ts`
- Create: `artifacts/adventure-zone/src/features/design-studio/profile-email-studio.test.ts`
- Modify: `artifacts/adventure-zone/src/components/profiles/simple-full-profile.tsx`
- Modify: `artifacts/adventure-zone/src/components/profiles/simple-full-profile.email-compose.test.tsx`
- Modify: `artifacts/adventure-zone/src/lib/design-studio-api.ts`

**Interfaces:**
- Consumes: `useProfileGoogleEmail`, existing profile contacts, `designStudioApi.create`, and existing profile draft list endpoint.
- Produces: `selectProfileEmailContact` and `createProfileEmailProject`.

```ts
export function selectProfileEmailContact(
  contacts: Array<{ id: string; email: string | null; isPrimary: boolean; isActive?: boolean }>,
): { id: string; email: string } | null;

export async function createProfileEmailProject(input: {
  organizationId: string;
  organizationName: string;
  contactId: string;
  returnTo: string;
}): Promise<{ id: string }>;
```

- [ ] **Step 1: Write failing contact-selection and summary tests**

```ts
expect(selectProfileEmailContact([
  { id: "primary-empty", email: null, isPrimary: true, isActive: true },
  { id: "active-email", email: "gm@example.com", isPrimary: false, isActive: true },
])).toEqual({ id: "active-email", email: "gm@example.com" });
```

```tsx
expect(screen.getByText("gm@example.com")).toBeVisible();
expect(screen.getAllByRole("button", { name: /open conversation/i })).toHaveLength(3);
expect(screen.getByText("Scheduled")).toBeVisible();
expect(screen.getByRole("button", { name: "New Draft" })).toBeEnabled();
```

Also cover no email (`Add a contact email first` and disabled button), fewer than three conversations, Gmail error isolation, and a full-history link.

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/features/design-studio/profile-email-studio.test.ts src/components/profiles/profile-email-summary.test.tsx src/components/profiles/simple-full-profile.email-compose.test.tsx`

Expected: FAIL because the compact summary and linked creation helper do not exist.

- [ ] **Step 3: Implement deterministic contact selection and project creation**

Select an active primary contact with an email first, otherwise the first active contact with an email in the server-provided order. Create an email project with `linkedOrganizationId`, `linkedContactId`, the existing default email document, and a name containing only organization name and current calendar date. Validate `returnTo` as an internal `/profiles` path before including it in `/design-studio/:id?returnTo=...`.

- [ ] **Step 4: Render the summary directly below actions**

Show the selected email, New Draft, at most three conversations, and active organization-linked drafts in states `draft`, `gmail_draft`, `scheduled`, `needs_changes`, or `failed`. Render Gmail and draft errors independently. Remove the old plain-text **Email** action from the primary action row only when it duplicates New Draft; retain the legacy plain-text draft editor under the full Emails section.

- [ ] **Step 5: Run tests and commit**

Run the command from Step 2.

Expected: PASS.

```bash
git add artifacts/adventure-zone/src/components/profiles/profile-email-summary.tsx artifacts/adventure-zone/src/components/profiles/profile-email-summary.test.tsx artifacts/adventure-zone/src/features/design-studio/profile-email-studio.ts artifacts/adventure-zone/src/features/design-studio/profile-email-studio.test.ts artifacts/adventure-zone/src/components/profiles/simple-full-profile.tsx artifacts/adventure-zone/src/components/profiles/simple-full-profile.email-compose.test.tsx artifacts/adventure-zone/src/lib/design-studio-api.ts
git commit -m "feat: start HTML email drafts from profiles"
```

---

### Task 4: Persist Canonical HTML Delivery State

**Files:**
- Modify: `lib/db/src/office-coordinator-schema.ts`
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/20260912_profile_html_email_delivery.sql`
- Modify: `lib/db/src/migrations.ts`
- Modify: `artifacts/api-server/src/db/office-coordinator-startup-migration.ts`
- Modify: `artifacts/api-server/src/features/office/office-schema-contract.test.ts`
- Create: `artifacts/api-server/src/features/office/office-email-delivery-migration.test.ts`
- Modify: `artifacts/api-server/src/features/office/office-email-types.ts`

**Interfaces:**
- Produces: `OfficeEmailBodyFormat` and extended `OfficeEmailState`.

```ts
export type OfficeEmailBodyFormat = "plain_text" | "html";
export type OfficeEmailState =
  | "draft" | "submitted" | "needs_changes" | "gmail_draft"
  | "scheduled" | "sending" | "sent" | "failed" | "cancelled";
```

- Produces these nullable `officeEmailDrafts` fields: `designProjectId`, `designVersionId`, `scheduledFor`, `businessTimeZone`, `gmailDraftId`, `gmailMessageId`, `gmailThreadId`, `sendRequestKey`, `scheduleRequestKey`, `dispatchLeaseOwner`, `dispatchLeaseExpiresAt`, `lastAttemptAt`, `nextAttemptAt`, `lastFailureCode`, `lastFailureMessage`; plus `bodyFormat` default `plain_text` and `dispatchAttemptCount` default `0`.

- [ ] **Step 1: Write failing schema and migration tests**

```ts
expect(officeEmailStateValues).toEqual([
  "draft", "submitted", "needs_changes", "gmail_draft",
  "scheduled", "sending", "sent", "failed", "cancelled",
]);
expect(officeEmailBodyFormatValues).toEqual(["plain_text", "html"]);
expect(migration).toContain("office_email_drafts_dispatch_idx");
expect(migration).not.toContain("UPDATE office_email_drafts SET state");
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @workspace/api-server test -- office-schema-contract.test.ts office-email-delivery-migration.test.ts`

Expected: FAIL because the additive columns, constraints, and marker are absent.

- [ ] **Step 3: Add Drizzle fields and the forward-only migration**

Use `ADD COLUMN IF NOT EXISTS`, foreign keys to `design_projects` and `design_project_versions` with `ON DELETE SET NULL`/`RESTRICT` as appropriate, a partial unique index on non-null `design_project_id`, partial unique indexes for non-null request keys, and an index on `(state, scheduled_for, next_attempt_at, dispatch_lease_expires_at)`. Drop/recreate only the state check constraint; preserve every old state and row. Register a readiness marker that verifies all new columns and the updated state constraint.

- [ ] **Step 4: Mirror startup compatibility changes**

Add the same idempotent columns and constraint repair to the existing Office startup migration so older databases become readable before routes initialize.

- [ ] **Step 5: Run schema verification and commit**

Run: `pnpm --filter @workspace/api-server test -- office-schema-contract.test.ts office-email-delivery-migration.test.ts`

Run: `pnpm run typecheck:libs`

Expected: PASS.

```bash
git add lib/db/src/office-coordinator-schema.ts lib/db/src/schema/index.ts lib/db/migrations/20260912_profile_html_email_delivery.sql lib/db/src/migrations.ts artifacts/api-server/src/db/office-coordinator-startup-migration.ts artifacts/api-server/src/features/office/office-schema-contract.test.ts artifacts/api-server/src/features/office/office-email-delivery-migration.test.ts artifacts/api-server/src/features/office/office-email-types.ts
git commit -m "feat: persist profile HTML email delivery state"
```

---

### Task 5: Freeze and Render the Exact Design Studio HTML

**Files:**
- Create: `lib/api-zod/src/design-studio-email.ts`
- Modify: `lib/api-zod/src/index.ts`
- Modify: `artifacts/adventure-zone/src/lib/design-studio/email-model.ts`
- Create: `artifacts/api-server/src/features/office/design-email-renderer.ts`
- Create: `artifacts/api-server/src/features/office/design-email-renderer.test.ts`
- Modify: `artifacts/api-server/src/routes/office-design-studio.ts`
- Modify: `artifacts/api-server/src/routes/office-design-studio.test.ts`

**Interfaces:**
- Produces: `designEmailDocumentSchema`, `DesignEmailDocument`, `renderDesignEmailHtml`, and `freezeDesignEmailVersion`.

```ts
export function renderDesignEmailHtml(document: DesignEmailDocument): string;

export async function freezeDesignEmailVersion(input: {
  projectId: string;
  accountId: string;
}): Promise<{ versionId: string; html: string; htmlFingerprint: string }>;
```

- [ ] **Step 1: Write failing schema, rendering, and freezing tests**

```ts
expect(html).toContain("<!doctype html>");
expect(html).toContain("max-width:600px");
expect(html).not.toContain("<script");
expect(html).not.toContain("javascript:");
expect(first.htmlFingerprint).toBe(second.htmlFingerprint);
expect(version.content).toEqual(project.content);
```

Cover escaped paragraph/heading text, allowlisted `https:` links and images, mobile-safe tables/styles, footer text, rejected unknown blocks, organization/contact ownership, and immutable version creation.

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @workspace/api-server test -- design-email-renderer.test.ts office-design-studio.test.ts`

Expected: FAIL because the server cannot validate/render the editor document or freeze it for delivery.

- [ ] **Step 3: Share the constrained document schema**

Move the document type/schema—not React preview code—into `@workspace/api-zod`. Keep frontend helper exports compatible by re-exporting the shared type. Reject unknown block types and strip non-HTTPS external URLs; escape all user text before interpolation.

- [ ] **Step 4: Implement deterministic HTML rendering and freezing**

Render a complete UTF-8 HTML email using table layout, inline styles, a 600px content width, and the saved brand colors. Hash normalized recipient-independent HTML with SHA-256. In one transaction, prove the project is an email linked to the organization/contact, insert a `design_project_versions` snapshot, and return its ID, HTML, and HTML fingerprint.

- [ ] **Step 5: Run tests and commit**

Run the command from Step 2, then `pnpm run typecheck:libs`.

Expected: PASS.

```bash
git add lib/api-zod/src/design-studio-email.ts lib/api-zod/src/index.ts artifacts/adventure-zone/src/lib/design-studio/email-model.ts artifacts/api-server/src/features/office/design-email-renderer.ts artifacts/api-server/src/features/office/design-email-renderer.test.ts artifacts/api-server/src/routes/office-design-studio.ts artifacts/api-server/src/routes/office-design-studio.test.ts
git commit -m "feat: freeze and render Design Studio email HTML"
```

---

### Task 6: Implement Canonical Draft Commands and Real Gmail Drafts

**Files:**
- Create: `artifacts/api-server/src/features/office/office-email-repository.ts`
- Create: `artifacts/api-server/src/features/office/office-email-repository.test.ts`
- Create: `artifacts/api-server/src/features/office/office-gmail-provider.ts`
- Create: `artifacts/api-server/src/features/office/office-gmail-provider.test.ts`
- Create: `artifacts/api-server/src/features/office/office-design-email-service.ts`
- Create: `artifacts/api-server/src/features/office/office-design-email-service.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.test.ts`
- Modify: `artifacts/api-server/src/routes/office-design-studio.ts`
- Modify: `artifacts/api-server/src/routes/office-design-studio.test.ts`

**Interfaces:**
- Consumes: Task 4 schema and Task 5 `freezeDesignEmailVersion`.
- Produces: `OfficeDesignEmailService.saveInApp` and `createGmailDraft`.

```ts
export type DesignEmailContentCommand = {
  projectId: string;
  subject: string;
};

export type OfficeGmailProviderPort = {
  createOrUpdateDraft(input: {
    gmailDraftId: string | null;
    to: string;
    subject: string;
    html: string;
  }): Promise<{ draftId: string; messageId: string; threadId: string | null }>;
  sendDraft(input: { draftId: string }): Promise<{ messageId: string; threadId: string; sentAt: Date }>;
};
```

- [ ] **Step 1: Write failing repository, Gmail, and command tests**

```ts
expect(gmail.createOrUpdateDraft).not.toHaveBeenCalled(); // saveInApp
expect(saved).toMatchObject({ bodyFormat: "html", state: "draft", designVersionId: "version-1" });
expect(await service.createGmailDraft(command)).toMatchObject({ state: "gmail_draft", gmailDraftId: "gmail-draft-1" });
await service.createGmailDraft(command);
expect(gmail.createOrUpdateDraft).toHaveBeenLastCalledWith(expect.objectContaining({ gmailDraftId: "gmail-draft-1" }));
```

Also test MIME `Content-Type: text/html; charset=UTF-8`, header injection rejection, owner/office authorization, disconnected Gmail, organization/contact/project mismatch, recipient derived from the linked active contact, and ambiguous provider failure becoming `failed` with `GMAIL_DRAFT_OUTCOME_UNKNOWN`.

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @workspace/api-server test -- office-email-repository.test.ts office-gmail-provider.test.ts office-design-email-service.test.ts google-api-client.test.ts office-design-studio.test.ts`

Expected: FAIL because HTML Gmail draft creation and canonical linkage are absent.

- [ ] **Step 3: Implement the repository and Gmail port**

Add ownership-scoped reads/writes, request-key lookup for schedule/send, a unique non-null `design_project_id` index for one canonical row per project, and state compare-and-set helpers. Extend the existing Gmail raw-message builder with a backwards-compatible `bodyFormat?: "plain_text" | "html"`; encode HTML as MIME content, reject CR/LF in headers, and return only stable identifiers.

- [ ] **Step 4: Implement save and Gmail draft commands**

Both commands freeze the current project version and upsert one `office_email_drafts` row keyed by linked Design Studio project. `saveInApp` performs no provider call. `createGmailDraft` creates when `gmailDraftId` is absent and updates that same provider draft when it is present, so repeated clicks cannot create a second Gmail draft. Store only sanitized provider failure codes and instruct uncertain results to be checked in Gmail before retry.

Expose additive endpoints:

```text
POST /office/design-studio/projects/:id/email/save
POST /office/design-studio/projects/:id/email/gmail-draft
```

with `{ subject }`; return the canonical draft view without changing existing output contracts.

- [ ] **Step 5: Run tests and commit**

Run the command from Step 2.

Expected: PASS.

```bash
git add artifacts/api-server/src/features/office/office-email-repository.ts artifacts/api-server/src/features/office/office-email-repository.test.ts artifacts/api-server/src/features/office/office-gmail-provider.ts artifacts/api-server/src/features/office/office-gmail-provider.test.ts artifacts/api-server/src/features/office/office-design-email-service.ts artifacts/api-server/src/features/office/office-design-email-service.test.ts artifacts/api-server/src/features/google-workspace/google-api-client.ts artifacts/api-server/src/features/google-workspace/google-api-client.test.ts artifacts/api-server/src/routes/office-design-studio.ts artifacts/api-server/src/routes/office-design-studio.test.ts
git commit -m "feat: create canonical app and Gmail HTML drafts"
```

---

### Task 7: Add Exact-Content Send and Scheduling State Transitions

**Files:**
- Modify: `artifacts/api-server/src/features/office/office-email-repository.ts`
- Modify: `artifacts/api-server/src/features/office/office-email-repository.test.ts`
- Modify: `artifacts/api-server/src/features/office/office-design-email-service.ts`
- Modify: `artifacts/api-server/src/features/office/office-design-email-service.test.ts`
- Modify: `artifacts/api-server/src/features/office/office-email-send-coordinator.ts`
- Modify: `artifacts/api-server/src/features/office/office-email-send-coordinator.test.ts`
- Modify: `artifacts/api-server/src/routes/office-design-studio.ts`
- Modify: `artifacts/api-server/src/routes/office-design-studio.test.ts`

**Interfaces:**
- Produces: `schedule`, `reschedule`, `cancel`, `sendNow`, and `sendClaimed`.

```ts
schedule(input: DesignEmailContentCommand & {
  requestKey: string;
  scheduledFor: Date;
  businessTimeZone: string;
  approvedFingerprint: string;
}): Promise<OfficeEmailDraftView>;

sendNow(input: DesignEmailContentCommand & {
  requestKey: string;
  approvedFingerprint: string;
}): Promise<OfficeEmailDraftView>;
```

- [ ] **Step 1: Write failing state and approval tests**

```ts
expect(canOfficeEditDraft("scheduled")).toBe(true);
expect(canOfficeCancelDraft("scheduled")).toBe(true);
await expect(service.sendNow({ ...command, approvedFingerprint: "old" }))
  .rejects.toMatchObject({ code: "OUTREACH_APPROVAL_STALE" });
expect(sent).toMatchObject({ state: "sent", gmailMessageId: "message-1", gmailThreadId: "thread-1" });
```

Cover future-time validation, valid IANA timezone, UTC storage, schedule request replay, reschedule, cancellation before claim, cancellation losing to `sending`, final guard recheck, send request replay, durable Gmail IDs, profile activity, follow-up prompt after confirmed schedule/send, and uncertain-send manual review without blind retry.

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @workspace/api-server test -- office-email-repository.test.ts office-design-email-service.test.ts office-email-send-coordinator.test.ts office-design-studio.test.ts`

Expected: FAIL on the new states and commands.

- [ ] **Step 3: Implement atomic state transitions**

Use conditional updates so only `draft`, `gmail_draft`, `needs_changes`, `failed`, or editable `scheduled` rows can be frozen and scheduled/sent. Saving editor changes creates a new version and returns a scheduled row to `draft`. Cancellation changes only `scheduled` to `cancelled`; sent history is immutable.

- [ ] **Step 4: Enforce exact-content review and delivery truth**

Fingerprint normalized recipient + subject + HTML. Reuse the existing outreach review lookup and dispatch guards at command time and immediately before provider send. Create/update a Gmail draft first, then send that provider draft. Return success only after Gmail identifiers, sent timestamp, profile activity, and thread/profile mapping are durably committed; store a manual-review failure for ambiguous provider outcomes.

Expose:

```text
POST /office/design-studio/projects/:id/email/schedule
POST /office/design-studio/projects/:id/email/reschedule
POST /office/design-studio/projects/:id/email/cancel
POST /office/design-studio/projects/:id/email/send
```

- [ ] **Step 5: Run tests and commit**

Run the command from Step 2.

Expected: PASS.

```bash
git add artifacts/api-server/src/features/office/office-email-repository.ts artifacts/api-server/src/features/office/office-email-repository.test.ts artifacts/api-server/src/features/office/office-design-email-service.ts artifacts/api-server/src/features/office/office-design-email-service.test.ts artifacts/api-server/src/features/office/office-email-send-coordinator.ts artifacts/api-server/src/features/office/office-email-send-coordinator.test.ts artifacts/api-server/src/routes/office-design-studio.ts artifacts/api-server/src/routes/office-design-studio.test.ts
git commit -m "feat: send and schedule approved profile HTML email"
```

---

### Task 8: Run Scheduled Profile Email in a Supervised Worker

**Files:**
- Create: `artifacts/api-server/src/features/office/office-email-dispatcher.ts`
- Create: `artifacts/api-server/src/features/office/office-email-dispatcher.test.ts`
- Create: `artifacts/api-server/src/features/office/office-email-dispatcher-loop.ts`
- Create: `artifacts/api-server/src/features/office/office-email-dispatcher-loop.test.ts`
- Create: `artifacts/api-server/src/features/office/office-email-worker-runtime.ts`
- Create: `artifacts/api-server/src/features/office/office-email-worker-runtime.test.ts`
- Create: `artifacts/api-server/src/office-email-worker.ts`
- Modify: `artifacts/api-server/build.mjs`
- Modify: `artifacts/api-server/package.json`
- Modify: `DEPLOY.md`

**Interfaces:**
- Consumes: `OfficeEmailRepository.claimOneDue/releaseLease` and `OfficeDesignEmailService.sendClaimed`.
- Produces: separate `pnpm --filter @workspace/api-server start:office-email-worker` process.

```ts
claimOneDue(input: { workerId: string; now: Date; leaseMs: 60_000 }): Promise<OfficeEmailDraftRecord | null>;
runOne(input: { workerId: string; now: Date }): Promise<"sent" | "idle" | "failed">;
```

- [ ] **Step 1: Write failing claim, loop, and lifecycle tests**

```ts
expect(await dispatcher.runOne({ workerId: "worker-1", now: DUE_AT })).toBe("sent");
expect(await dispatcher.runOne({ workerId: "worker-2", now: DUE_AT })).toBe("idle");
expect(scheduler.schedule).toHaveBeenCalledWith(expect.any(Function), 1_000);
expect(close).toHaveBeenCalledOnce();
```

Cover `FOR UPDATE SKIP LOCKED`, expired leases, one claimant, deterministic send key `scheduled:<draftId>:<designVersionId>`, retryable 429/5xx/timeouts with bounded backoff, permanent failure, graceful SIGTERM/SIGINT shutdown, and no real Gmail client in tests.

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @workspace/api-server test -- office-email-dispatcher.test.ts office-email-dispatcher-loop.test.ts office-email-worker-runtime.test.ts`

Expected: FAIL because no Office scheduled-delivery worker exists.

- [ ] **Step 3: Implement atomic claims and bounded retry**

Claim one due `scheduled` row whose retry time is due and lease is absent/expired, change it to `sending`, increment attempts, and grant a 60-second lease. Use 30 seconds × `2^(attempt-1)`, capped at one hour, for retryable failures; release/expire the lease after every definite outcome.

- [ ] **Step 4: Add the separate worker entrypoint**

Build `office-email-worker.mjs` separately from the web server, start immediately, poll after one second on progress, 15 seconds when idle, and 60 seconds after unexpected loop errors. Close the loop and database pool on SIGTERM/SIGINT. Document the Render worker command and the requirement to deploy the migration/API before starting it.

- [ ] **Step 5: Run tests and commit**

Run the command from Step 2.

Expected: PASS.

```bash
git add artifacts/api-server/src/features/office/office-email-dispatcher.ts artifacts/api-server/src/features/office/office-email-dispatcher.test.ts artifacts/api-server/src/features/office/office-email-dispatcher-loop.ts artifacts/api-server/src/features/office/office-email-dispatcher-loop.test.ts artifacts/api-server/src/features/office/office-email-worker-runtime.ts artifacts/api-server/src/features/office/office-email-worker-runtime.test.ts artifacts/api-server/src/office-email-worker.ts artifacts/api-server/build.mjs artifacts/api-server/package.json DEPLOY.md
git commit -m "feat: dispatch scheduled profile email in a worker"
```

---

### Task 9: Add the Four Design Studio Delivery Outcomes

**Files:**
- Create: `artifacts/adventure-zone/src/components/design-studio/EmailDeliveryBar.tsx`
- Create: `artifacts/adventure-zone/src/components/design-studio/EmailDeliveryBar.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/design-studio/BrandedEmailEditor.tsx`
- Modify: `artifacts/adventure-zone/src/pages/DesignStudioEditorPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/DesignStudioEditorPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/lib/design-studio-api.ts`
- Create: `artifacts/adventure-zone/src/lib/business-time-zone.ts`
- Create: `artifacts/adventure-zone/src/lib/business-time-zone.test.ts`

**Interfaces:**
- Consumes: Task 6/7 endpoints and Design Studio project linkage.
- Produces: Save in app, Create Gmail Draft, Schedule, Send Now, cancel/reschedule, and safe return-to-profile controls.

- [ ] **Step 1: Write failing delivery-bar interaction tests**

```tsx
expect(screen.getByText("gm@example.com")).toBeVisible();
expect(screen.getByRole("button", { name: "Save in app" })).toBeEnabled();
expect(screen.getByRole("button", { name: "Create Gmail Draft" })).toBeEnabled();
expect(screen.getByRole("button", { name: "Schedule" })).toBeDisabled();
expect(screen.getByRole("button", { name: "Send Now" })).toBeDisabled();
```

Cover auto-save completion before commands, missing recipient, disconnected Gmail, exact-review-required state, approval invalidation after an editor change, future schedule validation, timezone label, one request key per user command, busy/error/success states, Gmail manual-review warning, and internal `returnTo` navigation.

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/components/design-studio/EmailDeliveryBar.test.tsx src/pages/DesignStudioEditorPage.test.tsx src/lib/business-time-zone.test.ts`

Expected: FAIL because the editor offers only Save/Review and the old handoff output.

- [ ] **Step 3: Implement business-local scheduling helpers**

```ts
export function businessLocalInputToUtc(input: { localDateTime: string; timeZone: string }): string;
export function formatBusinessSchedule(input: { utcDateTime: string; timeZone: string }): string;
```

Use `Intl.DateTimeFormat` parts, reject invalid IANA zones and nonexistent/ambiguous daylight-saving times, and never silently substitute the browser timezone.

- [ ] **Step 4: Implement the delivery bar**

Display linked profile and resolved To address. Before any command, await the editor's current save and use the returned persisted project. Save in app remains available without Gmail; the other relevant controls reflect connection/readiness. Create Gmail Draft does not require delivery approval because it does not send. Schedule opens a compact date/time confirmation with the configured timezone. Schedule and Send Now require a current exact-content approval and show the existing follow-up prompt only after confirmed scheduling or sending. Replace the old `gmail_draft` handoff output button so the label is shown only when the real endpoint succeeds.

- [ ] **Step 5: Run tests and commit**

Run the command from Step 2.

Expected: PASS.

```bash
git add artifacts/adventure-zone/src/components/design-studio/EmailDeliveryBar.tsx artifacts/adventure-zone/src/components/design-studio/EmailDeliveryBar.test.tsx artifacts/adventure-zone/src/components/design-studio/BrandedEmailEditor.tsx artifacts/adventure-zone/src/pages/DesignStudioEditorPage.tsx artifacts/adventure-zone/src/pages/DesignStudioEditorPage.test.tsx artifacts/adventure-zone/src/lib/design-studio-api.ts artifacts/adventure-zone/src/lib/business-time-zone.ts artifacts/adventure-zone/src/lib/business-time-zone.test.ts
git commit -m "feat: deliver profile email from Design Studio"
```

---

### Task 10: Verify the Complete Profile-to-Gmail Story

**Files:**
- Modify: `artifacts/api-server/src/routes/office-design-studio.test.ts`
- Modify: `artifacts/api-server/src/routes/office-admin-email-drafts.test.ts`
- Modify: `artifacts/adventure-zone/src/components/profiles/profile-email-summary.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/DesignStudioEditorPage.test.tsx`
- Create: `docs/operations/profile-html-email-delivery.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: cross-feature regression evidence and deployment/rollback instructions.

- [ ] **Step 1: Add a server cross-feature scenario**

Using a fake Gmail provider, create a linked email project, save it without provider calls, create exactly one Gmail draft across repeated commands, change content and prove approval becomes stale, approve the new fingerprint, schedule it, claim it once, send it, and assert stored version/message/thread IDs plus profile activity.

- [ ] **Step 2: Add a frontend cross-feature scenario**

Start in a selected profile, confirm stars and the exact palette, click New Draft, assert linked profile/recipient in Design Studio, exercise Save in app and fake Gmail Draft success, schedule in `America/Denver`, return to the profile, and assert the compact summary shows the scheduled state plus only the three newest conversations.

- [ ] **Step 3: Run all focused feature tests**

```bash
pnpm --filter @workspace/api-server test -- office-email office-design-studio design-email-renderer
pnpm --filter @workspace/adventure-zone exec vitest run src/components/organizations/organization-list-decision.test.tsx src/components/profiles/profile-at-a-glance.test.tsx src/components/profiles/profile-email-summary.test.tsx src/components/google-workspace/profile-google-email-panel.test.tsx src/components/design-studio/EmailDeliveryBar.test.tsx src/pages/DesignStudioEditorPage.test.tsx src/lib/business-time-zone.test.ts
```

Expected: PASS with zero real Gmail/network calls.

- [ ] **Step 4: Run repository verification**

```bash
pnpm exec prettier --check artifacts/adventure-zone/src artifacts/api-server/src lib/api-zod/src lib/db/src docs
pnpm run typecheck
pnpm --filter @workspace/adventure-zone test
pnpm --filter @workspace/api-server test
pnpm run build
git diff --check
```

Expected: formatter, typecheck, both full test suites, production build, and whitespace check PASS.

- [ ] **Step 5: Perform browser verification without real delivery**

At desktop width and a 390px mobile viewport, verify search, every quick-filter chip, profile keyboard selection/focus, empty dates/deadlines/contacts, ratings, CSV export, action flow, compact email loading/empty/error states, New Draft linkage, editor responsiveness, Save in app, and delivery-disabled controls. Use fake/staging Gmail for provider draft/send smoke tests; automated or local tests must not touch production Gmail.

- [ ] **Step 6: Write the runbook and commit**

Document migration order, worker start/stop, Gmail scope/readiness checks, internal test-draft procedure, scheduled test procedure, idempotency inspection, ambiguous-outcome reconciliation, rollback by stopping the worker first, and the exact commands/results from Steps 3–5.

```bash
git add artifacts/api-server/src/routes/office-design-studio.test.ts artifacts/api-server/src/routes/office-admin-email-drafts.test.ts artifacts/adventure-zone/src/components/profiles/profile-email-summary.test.tsx artifacts/adventure-zone/src/pages/DesignStudioEditorPage.test.tsx docs/operations/profile-html-email-delivery.md
git commit -m "test: verify profile HTML email delivery"
```
