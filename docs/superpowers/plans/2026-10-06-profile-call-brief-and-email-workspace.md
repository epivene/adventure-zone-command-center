# Profile Call Brief and Email Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Let Desiree answer profile questions during calls and read, draft, reply, and link business email inside the app.

**Architecture:** Build on existing approved email mappings, account/thread intent, label mutation queues, archived conversation support, and profile presentation. The Call Brief and email workspace share a recorded-facts projection. A new owner mailbox API reads Gmail directly; linking commits app ownership separately from reuse-only label synchronization.

**Tech Stack:** TypeScript, React, Wouter, Tailwind, Express, PostgreSQL/Drizzle, Gmail APIs, pnpm, Vitest, Testing Library, Supertest.

**Spec:** docs/superpowers/specs/2026-10-06-profile-call-brief-and-email-workspace-design.md
**Base inspected:** af0e43d0653fb3117ae01c2f29a602d47ed47030.
**Execution branch:** codex/profile-call-brief-email-workspace-2026-10-06.

## Global Constraints

- Link to profile leaves INBOX unchanged. Archive is a separate explicit action.
- Keep broader owner mailbox access separate from connector/profile-limited access.
- Preserve existing notes and full history.
- Do not silently create, rename, merge, or duplicate labels.
- Do not generate summaries through a paid model on each profile load.
- Assistant preparation never grants permission to send or schedule.
- Unknown, stale, and conflicting information must be visibly distinguishable.
- Preserve recipient, subject, thread identity, and draft content after failures.
- Do not change permissions or consent silently.
- Phone and Fold: one column, readable labels, no horizontal scrolling, and brief actions that remain easy to reach.

## Review Focus

1. A late response from a previously selected profile/account must not replace the current selection; test in Tasks 3 and 6.
2. A thread can contain incoming and sent messages with different labels; folder selection and unread state must follow Gmail message evidence; test in Task 4.
3. Replies can arrive while labeling or reassignment is pending; old work must not restore the previous profile; test in Tasks 1 and 2.
4. HTML messages can include scripts, tracking pixels, or deceptive links; render safely without automatic remote-resource loading; test in Task 5.
5. A send timeout can happen after Gmail accepted delivery; report uncertain status and reconcile without a second send; test in Task 7.

## File structure and shared contracts

New API files live under artifacts/api-server/src/features/email-workspace/:
- email-workspace-types.ts: mailbox/link DTOs.
- email-workspace-service.ts: account-scoped read operations.
- email-profile-link-service.ts: explicit owner linking/reassignment.
- profile-call-brief.ts and profile-call-brief-repository.ts: sourced profile facts.

New frontend files live under artifacts/adventure-zone/src/:
- features/email-workspace/email-workspace-client.ts: authenticated API calls and shared DTOs.
- features/profiles/profile-call-brief-client.ts: Call Brief requests.
- components/profiles/profile-call-brief.tsx: shared compact view.
- components/email-workspace/: reader, profile picker, draft composer.
- pages/EmailsPage.tsx: folder/list/reader orchestration.

MailboxFolder = "inbox" | "sent" | "drafts" | "search".
MailboxPage = { accountEmail: string; rows: MailboxRow[]; nextPageToken: string | null; refreshedAt: string }.
MailboxRow = { threadId: string; messageId: string; draftId: string | null; subject: string; from: string; date: string; snippet: string; unread: boolean; labelIds: string[]; organizationId: string | null }.
ProfileLinkResult = { organizationId: string; threadId: string; linked: true; labelState: "applied" | "pending" | "needs_attention"; mutationId: string | null; errorCode: string | null }.
ProfileCallBrief = { organizationId: string; selectedYear: number; contact: { name: string; role: string | null; phone: string | null; email: string | null } | null; location: string | null; relationshipStatus: string | null; booking: { id: string; dates: string | null; status: string | null; packages: string[]; quote: string | null; contractStatus: string | null; depositStatus: string | null } | null; lastContact: { at: string; direction: string; excerpt: string; sourceUrl: string } | null; nextAction: { text: string; dueAt: string | null } | null; cautions: string[]; evidence: { label: string; value: string | null; state: "recorded" | "unknown" | "stale" | "conflict"; sourceUrl: string | null }[] }.

Task names below define new interfaces; existing interfaces remain compatible.

## Task 1: Persist link behavior through assignment and retries

**Modify:** lib/db/src/google-workspace-schema.ts; artifacts/api-server/src/features/google-workspace/google-profile-assignment-transaction.ts; google-gmail-mutation-repository.ts; google-workspace-startup migration wiring.
**Create:** lib/db/migrations/20261006_email_link_policy.sql.
**Tests:** artifacts/api-server/src/features/google-workspace/google-profile-assignment-transaction.test.ts; artifacts/api-server/src/db/email-link-policy.test.ts.

**Interfaces:** Add persisted assignmentPolicy = "legacy_archive" | "link_only", defaulting existing records to legacy_archive; persist through thread intent, mutation, and mapping projection. Add optional assignmentPolicy to MatchedAssignmentInput and mutation DTO; omitted means legacy_archive. New link-only requests explicitly request link_only.

- [ ] Write tests asserting identical concurrent requests produce one active intent/mutation, repeating link_only causes no extra audit, switching policies updates generation, and reassignment supersedes old work. Assert account IDs isolate identical Gmail thread IDs.
- [ ] Run: pnpm --filter @workspace/api-server test src/features/google-workspace/google-profile-assignment-transaction.test.ts src/db/email-link-policy.test.ts. New cases must fail before changes.
- [ ] Add idempotent columns/checks and round-trip serialization. Keep assignment and intent/mutation enqueue atomic. Existing approved mappings remain canonical; derive conversation ownership from thread intent plus approved mappings, flag inconsistent legacy ownership.
- [ ] Rerun tests; apply migration twice against the repository's test database fixture and assert records are preserved.
- [ ] Commit: feat: persist inbox-preserving email link intent.

## Task 2: Reuse-only labels and durable owner link service

**Modify:** artifacts/api-server/src/features/google-workspace/google-profile-label-resolver.ts; google-profile-label-sync-service.ts; email-thread-attention-runtime.ts; email-thread-attention-sync.ts.
**Create:** artifacts/api-server/src/features/email-workspace/email-profile-link-service.ts; email-workspace-types.ts.
**Tests:** corresponding resolver/sync tests and email-profile-link-service.test.ts.

**Interfaces:** GoogleProfileLabelResolver.resolveExisting({connectionId, organizationId}) returns resolved mapping or explicit missing/unavailable/conflict; never invokes ensureHierarchy/createLabel/renameLabel. EmailProfileLinkService.link({actorId, connectionId, threadId, organizationId, requestKey, expectedOrganizationId, changeProfile}) returns Promise<ProfileLinkResult>. expectedOrganizationId is nullable; a mismatched current owner returns 409 rather than overwriting.

- [ ] Write tests asserting link saves before Gmail failure, missing/conflicting label keeps link with needs_attention, and pending retries use the same label intent. Assert no label creation and no INBOX removal even through the attention hook; preserve unrelated labels.
- [ ] Run the new service test and existing resolver/sync/attention tests; confirm added assertions fail.
- [ ] Implement link service using existing transaction and live account/thread verification. Reuse-only resolver applies to link_only; legacy_archive behavior stays unchanged. Prevent obsolete generation execution and share a per-thread lock across link/reassignment/reconciliation.
- [ ] Rerun tests including new replies arriving during old work; verify new profile ownership wins.
- [ ] Commit: feat: link email profiles with reuse-only Gmail labels.

## Task 3: Shared Call Brief data, profile layout, and quick lookup

**Create:** API profile-call-brief.ts; profile-call-brief-repository.ts; routes/profile-call-brief.ts; frontend profile-call-brief-client.ts; components/profiles/profile-call-brief.tsx.
**Modify:** artifacts/adventure-zone/src/components/profiles/simple-full-profile.tsx; profile-at-a-glance.tsx; pages/BossProfilePage.tsx; pages/BossProfilesPage.tsx; API routes/index.ts and features/organizations/profile-search.ts where existing search coverage is insufficient.
**Tests:** profile-call-brief.test.ts (API); profile-call-brief.test.tsx; BossProfilesPage tests.

**Interfaces:** buildProfileCallBrief(input: ProfileCallBriefSource): ProfileCallBrief; getProfileCallBrief(organizationId: string, year: number, signal?: AbortSignal): Promise<ProfileCallBrief>. Define ProfileCallBriefSource in profile-call-brief.ts from repository outputs; API GET /profiles/:id/call-brief?year=YYYY for owner, with authorized boss adapter limited to boss profile access.

- [ ] Write tests for selected-year booking, unknown quote, proposed versus confirmed dates, missing availability, administrative latest note versus actual customer contact, explicit contact holds, and expandable source history.
- [ ] Run targeted API/UI tests and confirm failure before implementation.
- [ ] Aggregate recorded booking/payment/document facts and actual email/call evidence. Never parse prose into a fabricated confirmed fact. Put the shared card immediately beneath the profile header; move general information below it. Existing tabs/actions/history remain available.
- [ ] Add tests for event/contact/email/normalized-phone/city search, retained return query, and rapid profile changes; a stale request must not overwrite the current card. Keep one-tap Emails/History/Documents/Add Call Note.
- [ ] Run targeted tests and UI typecheck. Commit: feat: show compact sourced profile call briefs.

## Task 4: Owner mailbox read and link endpoints

**Create:** API email-workspace-service.ts; routes/email-workspace.ts; frontend email-workspace-client.ts.
**Modify:** API google-api-types.ts; google-api-client.ts; routes/index.ts.
**Tests:** email-workspace-service.test.ts; routes/email-workspace.test.ts; google-api-client mailbox cases.

**Interfaces:** EmailWorkspaceService.list({actorId, folder, query, pageToken, limit: 25}): Promise<MailboxPage>; readThread({actorId, threadId}): Promise<GoogleThreadDetail>; getAttachment({actorId, threadId, messageId, attachmentId}): Promise<Uint8Array>. GET /email-workspace/messages, /threads/:threadId, /threads/:threadId/attachments/:messageId/:attachmentId; POST /threads/:threadId/profile invokes Task 2.

- [ ] Test unlinked inbox messages appear; owner-only access; connection-derived account identity; missing scope returns an actionable 403; disconnected/rate-limited Gmail returns error rather than empty mail; attachment membership is checked.
- [ ] Run service/route/client tests to establish failure.
- [ ] Add Gmail thread-page support with opaque pagination and metadata-only list loading. Inbox/Sent use Gmail system label filters; Search accepts bounded Gmail query; Drafts extends existing draft listing to carry page token. Read full bodies only when opening a conversation.
- [ ] Test mixed sent/incoming labels, repeated threads across pages, invalid query/token/limit, and stale account changes. Enrich rows from existing saved associations without writes on mailbox listing.
- [ ] Rerun tests. Commit: feat: expose owner Gmail mailbox workspace.

## Task 5: Safe conversation reader and profile picker

**Create:** frontend components/email-workspace/email-thread-reader.tsx; email-profile-picker.tsx; email-message-body.tsx.
**Modify:** existing profile-google-email-panel.tsx only to extract reusable reader helpers without breaking profile-limited endpoints.
**Tests:** matching component tests.

**Interfaces:** EmailThreadReader({thread: GoogleThreadDetail, accountEmail: string, onReply(): void, onArchive(): void}); EmailProfilePicker({threadId: string, organizationId: string | null, onLinked(result: ProfileLinkResult): void}); EmailMessageBody({bodyText: string, bodyHtml?: string}).

- [ ] Write reader/picker tests for complete conversation, collapsed quoted replies, attachments, explicit profile/location selection, already-linked state, change-profile conflict, pending label, and link success despite Gmail failure.
- [ ] Run tests and confirm failure.
- [ ] Render safe readable HTML using the project's existing sanitizer if sufficient; otherwise sandbox an allowlisted HTML representation with scripts/forms/remote resources removed. Show text fallback, real links, source timestamps, saved-copy state, and Open in Gmail.
- [ ] Test script/event-handler/javascript-link injection and remote tracking images; no automatic resource request occurs. Escape attachment names and preserve attachment download authorization.
- [ ] Rerun tests. Commit: feat: read email conversations and link profiles in app.

## Task 6: Integrated Emails page and responsive navigation

**Create:** frontend pages/EmailsPage.tsx; components/email-workspace/email-folder-list.tsx.
**Modify:** src/App.tsx; components/navigation/app-menu.tsx; app-shell.tsx as needed for navigation.
**Tests:** EmailsPage.test.tsx; App routing tests.

**Interfaces:** /emails?folder=inbox|sent|drafts|search&q=...&thread=...; uses Tasks 3–5 and frontend getMailboxPage/getMailboxThread/linkMailboxThread wrappers matching Task 4. Open profile passes a safe returnTo=/emails query; owner profile return-path allowlist must accept it.

- [ ] Test Inbox/Sent/Drafts/Search navigation, unlinked rows, profile sidebar, loading/error/reconnect states, and preserved query/list position when returning.
- [ ] Run targeted page/routing tests to establish failure.
- [ ] Build desktop list/reader/Call Brief layout and single-column phone flow. Persist folder/search/selected-thread in URL and scroll in session state. Abort or generation-check old requests; clear cache on account identity change.
- [ ] Test fast switching between conversations/accounts and retry after rate limits. Add separate Archive and read/unread actions with explicit server endpoints and current-account authorization; Link must never trigger Archive.
- [ ] Rerun tests. Commit: feat: add integrated email workspace navigation.

## Task 7: Compose, reply, drafts, and delivery reconciliation

**Create:** frontend components/email-workspace/email-draft-composer.tsx; API email-workspace-draft-service.ts and tests.
**Modify:** routes/email-workspace.ts; existing google-gmail-delivery-client.ts and office-email-send-coordinator.ts only where a reusable owner adapter is necessary; reuse profile-email-composer and existing reply service rather than parallel delivery logic.

**Interfaces:** saveMailboxDraft({draftId: string | null, threadId: string | null, to: string[], subject: string, bodyText: string, bodyHtml: string | null, expectedRevision: string | null, requestKey: string}): Promise<{draftId: string; revision: string}>.
sendMailboxDraft({draftId: string, expectedRevision: string, requestKey: string}): Promise<{state: "sent" | "unknown"; messageId: string | null; threadId: string | null}>.
Draft account/thread/revision are validated server-side; explicit user Send initiates delivery.

- [ ] Test draft create/edit/reopen, existing Gmail drafts, reply thread headers, HTML template preservation, attachment preservation, stale revision, and failure retaining all entered fields.
- [ ] Run targeted service/composer tests to establish failure.
- [ ] Adapt the existing draft/reply send pipeline with stable request keys and delivery receipts. Display sent/pending/uncertain accurately; do not silently convert an unknown response into retry authorization.
- [ ] Test simultaneous clicks and accepted-send timeout followed by reconciliation; assert Gmail delivery was invoked once. Mark existing draft attachments as preserved unless the user explicitly changes them.
- [ ] Rerun tests. Commit: feat: compose and reply through the email workspace.

## Task 8: Regression checks and reviewable delivery

**Modify:** existing relevant regression tests; add .github/workflows/profile-email-workspace-ci.yml if branch CI does not cover these paths.
**Interfaces:** no new product interface.

- [ ] Run all changed-area API and UI tests, existing Gmail assignment/attention/profile-email/draft delivery tests, and affected navigation tests.
- [ ] Run pnpm --filter @workspace/api-server typecheck; pnpm --filter @workspace/adventure-zone typecheck; builds for both packages. Record pre-existing failures separately; resolve introduced failures.
- [ ] Verify with controlled fixtures at desktop 1440×900, phone 390×844, Fold cover 344×882, and Fold open 768×1024. Save screenshots showing the Call Brief, inbox/thread/profile link, pending-label state, and mobile navigation.
- [ ] Confirm no live customer message, bulk CRM import, permission change, or deployment occurred as a test side effect.
- [ ] Self-review spec coverage and open a draft PR describing behavior, tests, and limitations. Keep merge/deployment pending the owner's normal workflow.
