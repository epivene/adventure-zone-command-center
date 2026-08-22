# Google Workspace CRM Sync Implementation Plan

> **For the implementation agent:** Use `superpowers:executing-plans` to execute this plan task by task. Use `superpowers:test-driven-development` for every production change, `superpowers:systematic-debugging` for any unexpected failure, and `superpowers:verification-before-completion` before each PR or completion claim.

**Goal:** Add a read-only Google Workspace integration that backfills and continuously syncs the approved business Gmail labels, four approved Google Calendars, Gmail attachments, and referenced Drive files into the Adventure Zone Command Center, while keeping deterministic rules authoritative and AI limited to categorization, summarization, extraction, and candidate ranking.

**Architecture:** Build a durable local Google archive inside the existing PostgreSQL database. Google APIs feed restart-safe background workers; normalized Gmail threads, Calendar events, files, match evidence, review decisions, and suggestions are persisted locally. Profiles present the data first, while a central Google Sync workspace handles setup, progress, ambiguous matches, unavailable files, and internal Employee/Receipt/Association filing. No page request should depend on a live Google API call.

**Tech stack:** TypeScript, Express, React, Drizzle ORM, PostgreSQL/PGlite, Vitest, Google OAuth 2.0, Gmail API, Google Calendar API, Google Drive API, Google Cloud Storage, and the existing AI completion abstraction.

**Approved specification:** `docs/superpowers/specs/2026-08-22-google-workspace-crm-sync-design.md`

---

## Delivery strategy

Deliver behind `GOOGLE_WORKSPACE_SYNC_ENABLED=false` by default. Use five reviewable PRs rather than one giant branch:

1. **Foundation:** schema, OAuth, read-only clients, access control, scope preview, and durable worker framework.
2. **Gmail + files:** historical Gmail discovery, complete threads, attachments/Drive links, incremental Gmail sync, and progress UI.
3. **Matching + profile experience:** deterministic matching, review rules, limited AI, suggestions, internal filing, and profile Conversations/Files views.
4. **Calendar + reconciliation:** Calendar ingestion, booking/profile matching, Schedule integration, profile Calendar view, and ACT email-history deduplication.
5. **Hardening + rollout:** Drive version tracking, privacy/security tests, end-to-end restart/idempotency tests, CI, deployment documentation, and staged production enablement.

Do not enable full historical backfill in production until the recent-history validation gate passes.

## Non-negotiable behavior

- Gmail and Google Calendar remain unchanged in Release 1.
- Only the approved Gmail label roots and descendants are in scope: `Shows`, `Receipts`, `Off Season Business Opportunities`, `Employees`, and `Associations`.
- Only the four approved Calendar IDs are in scope: Adventure Zone Calendar, Pirates Rebellion Calendar, Warriors Playground Calendar, and the separate calendar identified by `zone.pirate.warrior@gmail.com`.
- Personal content is excluded before full bodies are stored or sent to AI.
- Inbox and Sent messages belonging to the same approved business thread are reconstructed together.
- High-confidence deterministic matches may file automatically; ambiguous items remain visible for review.
- AI never independently establishes ownership or updates CRM fields.
- Accessible files are copied into Command Center storage and retain the original Gmail/Drive link.
- Administrator and Office Coordinator may access the integration; leg managers may access none of its messages, metadata, files, notes, endpoints, or derived information.
- Every source item reaches a visible state; there is no hidden unlinked bucket.
- Every worker operation is restart-safe and idempotent.

---

## Pre-flight: isolated workspace and baseline

**Files to inspect before changing code:**

- `package.json`
- `artifacts/api-server/package.json`
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/lib/auth.ts`
- `artifacts/api-server/src/routes/index.ts`
- `artifacts/api-server/src/routes/calendar.ts`
- `artifacts/api-server/src/features/manager-comms/attachment-filing-service.ts`
- `artifacts/api-server/src/features/paper-notes/paper-note-object-storage.ts`
- `artifacts/api-server/src/features/ai-suggestions/ai-client.ts`
- `lib/db/src/schema/index.ts`
- `lib/db/src/migrations.ts`
- `artifacts/adventure-zone/src/App.tsx`
- `artifacts/adventure-zone/src/components/navigation/app-menu.tsx`
- the current Office Coordinator authorization and shell files

**Steps:**

1. Create an isolated worktree from current `main` on `feature/google-workspace-crm-sync-foundation`.
2. Run `pnpm install --frozen-lockfile`.
3. Run the current targeted baselines:
   - `pnpm --filter @workspace/api-server exec vitest run src/routes/calendar.test.ts src/features/manager-comms`
   - `pnpm --filter @workspace/adventure-zone exec vitest run src/App.admin-navigation.test.ts`
   - `pnpm --filter @workspace/api-server run build`
   - `pnpm --filter @workspace/adventure-zone run build`
4. Record any pre-existing failures before continuing. Do not silently attribute them to this feature.
5. Inspect `lib/db/src/migrations.ts` for the next unused migration number. This plan refers to `068_google_workspace_crm_sync.sql`; renumber that file and every reference if `068` is already occupied.

---

# PR 1 — Foundation

## Task 1: Add the durable Google Workspace schema

**Files:**

- Create: `lib/db/src/google-workspace-schema.ts`
- Create: `lib/db/src/google-workspace-schema.test.ts`
- Create: `lib/db/migrations/068_google_workspace_crm_sync.sql` (or the next unused number found during pre-flight)
- Modify: `lib/db/src/schema/index.ts`
- Modify: `lib/db/src/migrations.ts`

**Step 1: Write failing schema tests**

Cover at minimum:

- one active connection per Google account;
- one-time, expiring OAuth state;
- unique Gmail message ID and thread ID within a connection;
- unique Calendar event identity by connection + calendar ID + event ID + recurrence instance;
- unique logical file and immutable file versions by checksum/source version;
- idempotent sync item identity;
- valid run/item state transitions;
- exactly one source and one CRM/internal destination per association;
- suggestion review states;
- match-rule uniqueness and reversible state;
- ACT-to-Gmail reconciliation uniqueness.

Run:

```bash
pnpm --filter @workspace/db exec vitest run src/google-workspace-schema.test.ts
```

Expected: FAIL because the schema and migration do not exist.

**Step 2: Implement the schema**

Create tables equivalent to:

- `google_workspace_connections`
- `google_workspace_oauth_states`
- `google_workspace_scopes`
- `google_workspace_sync_runs`
- `google_workspace_sync_items`
- `google_gmail_threads`
- `google_gmail_messages`
- `google_gmail_message_labels`
- `google_calendar_events`
- `google_workspace_files`
- `google_workspace_file_versions`
- `google_workspace_file_sources`
- `google_workspace_associations`
- `google_workspace_match_rules`
- `google_workspace_profile_suggestions`
- `google_workspace_ai_analyses`
- `google_workspace_act_email_links`
- `google_workspace_audit_events`

Use Google IDs plus `connection_id` as source identity. Keep normalized columns for common queries and JSON snapshots only for approved business content/audit data. Use foreign keys and partial unique indexes wherever possible rather than enforcing invariants only in TypeScript.

**Step 3: Register the schema and migration**

Export the module from `lib/db/src/schema/index.ts` and add the SQL migration to the existing migration runner.

**Step 4: Verify**

Run:

```bash
pnpm --filter @workspace/db exec vitest run src/google-workspace-schema.test.ts
pnpm --filter @workspace/db run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add lib/db

git commit -m "feat: add Google Workspace sync schema"
```

## Task 2: Add configuration validation and encrypted token storage

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/google-workspace-config.ts`
- Create: `artifacts/api-server/src/features/google-workspace/token-crypto.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-workspace-config.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/token-crypto.test.ts`
- Modify: `artifacts/api-server/package.json`
- Modify the repository’s environment example/deployment documentation file used for Render.

**Step 1: Write failing tests**

Prove:

- disabled mode needs no Google credentials;
- enabled mode requires client ID, client secret, callback URL, encryption key, and storage configuration;
- an encryption round trip succeeds;
- ciphertext uses a random nonce;
- tampering or the wrong key fails closed;
- plaintext refresh tokens never appear in serialized errors.

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/google-workspace-config.test.ts src/features/google-workspace/token-crypto.test.ts
```

Expected: FAIL.

**Step 2: Implement configuration**

Add environment keys:

- `GOOGLE_WORKSPACE_SYNC_ENABLED`
- `GOOGLE_WORKSPACE_CLIENT_ID`
- `GOOGLE_WORKSPACE_CLIENT_SECRET`
- `GOOGLE_WORKSPACE_REDIRECT_URI`
- `GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY`
- `GOOGLE_WORKSPACE_MAX_FILE_BYTES` with a conservative default
- optional batch/rate-limit settings with bounded defaults

Use AES-256-GCM or the repository’s existing authenticated-encryption helper. Store refresh tokens encrypted; do not persist access tokens unless the existing OAuth abstraction requires it.

**Step 3: Add the smallest official Google auth dependency**

Prefer `google-auth-library` plus the existing/fetch-based HTTP stack rather than importing the entire `googleapis` bundle. Keep Gmail, Calendar, and Drive calls in focused clients.

**Step 4: Verify and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/google-workspace-config.test.ts src/features/google-workspace/token-crypto.test.ts
pnpm --filter @workspace/api-server run typecheck

git add artifacts/api-server

git commit -m "feat: secure Google Workspace connection config"
```

## Task 3: Implement read-only OAuth and focused Google API clients

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/google-oauth-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-api-transport.ts`
- Create: `artifacts/api-server/src/features/google-workspace/gmail-client.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar-client.ts`
- Create: `artifacts/api-server/src/features/google-workspace/drive-client.ts`
- Create corresponding `*.test.ts` files
- Create: `artifacts/api-server/src/routes/google-workspace-connection.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-connection.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Step 1: Write failing contract tests**

Test with an injected fake transport, not live Google:

- authorization URL requests only Gmail readonly, Calendar readonly, Drive readonly, and basic identity scopes;
- OAuth state is one-time and expires;
- callback rejects state replay and account mismatch;
- refresh token is encrypted before persistence;
- API transport refreshes expired access and retries once on 401;
- retries honor 429/503 delay headers and remain bounded;
- Gmail, Calendar, and Drive clients expose only the read operations required by the design.

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/google-oauth-service.test.ts src/features/google-workspace/google-api-transport.test.ts src/features/google-workspace/gmail-client.test.ts src/features/google-workspace/calendar-client.test.ts src/features/google-workspace/drive-client.test.ts src/routes/google-workspace-connection.test.ts
```

Expected: FAIL.

**Step 2: Implement OAuth**

Add owner-only endpoints to:

- start connection;
- handle callback;
- show connection identity/scope state;
- disconnect future sync without deleting archived CRM data;
- request reauthorization when refresh fails.

Bind the first approved account identity to the connection and reject a later callback for a different account unless the owner explicitly disconnects first.

**Step 3: Implement focused clients**

Use explicit request/response types and pagination helpers. Do not expose a generic arbitrary-Google-request endpoint.

**Step 4: Verify and commit**

Run the targeted suite and API typecheck, then commit:

```bash
git add artifacts/api-server/src/features/google-workspace artifacts/api-server/src/routes

git commit -m "feat: connect Google Workspace read only"
```

## Task 4: Enforce Administrator/Office Coordinator access and leg-manager denial

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/google-workspace-access.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-workspace-access.test.ts`
- Modify: `artifacts/api-server/src/routes/google-workspace-connection.ts`
- Add route-level tests to `artifacts/api-server/src/routes/google-workspace-connection.test.ts`

**Step 1: Write failing authorization tests**

Prove:

- Administrator can manage the connection and all data;
- Office Coordinator can read business data/review queues but cannot replace OAuth credentials unless the approved role model explicitly allows it;
- leg-manager sessions receive 403 from every Google Workspace endpoint;
- unauthenticated requests receive the repository-standard unauthorized response;
- manually entering an endpoint URL cannot bypass the server check.

**Step 2: Implement one shared server-side guard**

Reuse the repository’s current owner and Office Coordinator actor/session types. Do not duplicate password/session validation.

**Step 3: Verify and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/google-workspace-access.test.ts src/routes/google-workspace-connection.test.ts

git commit -am "feat: protect Google Workspace data by role"
```

## Task 5: Add label/calendar inventory, descendant resolution, and scope preview

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/scope-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/scope-service.test.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-scope.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-scope.test.ts`
- Create: `artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts`
- Create: `artifacts/adventure-zone/src/pages/GoogleWorkspaceSetupPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/GoogleWorkspaceSetupPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-menu.tsx`

**Step 1: Write failing service tests**

Prove:

- scope is stored by Google label/calendar ID, not display name;
- all descendants of the five approved Gmail roots are included;
- labels outside those roots are excluded by default;
- system labels do not accidentally become personal user-label exclusions;
- a renamed label retains scope through its ID;
- all four calendars remain independent;
- preview fetches metadata/count estimates only and does not persist full message bodies.

**Step 2: Implement scope service and APIs**

Add endpoints to list labels/calendars, preview selected scope, save approved IDs, and report missing/renamed sources.

**Step 3: Build the setup page**

Show:

- connected account;
- included Gmail root tree and descendant counts;
- excluded user labels;
- four selected calendars;
- estimated message/thread/event/file counts;
- explicit confirmation before any backfill run is created.

Gmail remains untouched; make that visible in the UI.

**Step 4: Verify frontend and backend**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/scope-service.test.ts src/routes/google-workspace-scope.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/GoogleWorkspaceSetupPage.test.tsx
```

**Step 5: Commit**

```bash
git add artifacts/api-server artifacts/adventure-zone

git commit -m "feat: preview Google business sync scope"
```

## Task 6: Add restart-safe sync runs, item leases, pause/resume, and worker startup

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/sync-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/sync-repository.pglite.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/sync-worker.ts`
- Create: `artifacts/api-server/src/features/google-workspace/sync-worker.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/sync-worker-loop.ts`
- Create: `artifacts/api-server/src/features/google-workspace/sync-worker-loop.test.ts`
- Modify: `artifacts/api-server/src/index.ts`

**Step 1: Write failing durability tests**

Prove:

- source items are unique and replay-safe;
- one worker leases an item at a time;
- expired leases are reclaimed;
- terminal items are never reclaimed;
- pausing a run prevents new claims but lets the active claim finish;
- resuming continues from persisted cursors;
- a run cannot complete while pending, leased, or retryable items remain;
- shutdown closes the worker before closing the database pool.

**Step 2: Implement repository and loop**

Model stages explicitly: scope discovery, Gmail discovery, Gmail fetch, file fetch, deterministic match, AI analysis, suggestion creation, Calendar discovery, Calendar fetch, reconciliation, and completion.

**Step 3: Wire startup**

Start the worker only when:

- `GOOGLE_WORKSPACE_SYNC_ENABLED=true`;
- required schema is present;
- an active connection exists.

The server must still start if Google is unavailable. Log a safe error code, not token or message content.

**Step 4: Verify and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/sync-repository.pglite.test.ts src/features/google-workspace/sync-worker.test.ts src/features/google-workspace/sync-worker-loop.test.ts
pnpm --filter @workspace/api-server run build

git commit -am "feat: add durable Google sync worker"
```

**PR 1 verification gate:** run every Task 1–6 targeted test, API/frontend typechecks, and both production builds. Open the Foundation PR with the feature flag disabled.

---

# PR 2 — Gmail, attachments, and Drive-linked files

## Task 7: Resolve business Gmail scope before fetching content

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/gmail-scope-evaluator.ts`
- Create: `artifacts/api-server/src/features/google-workspace/gmail-scope-evaluator.test.ts`

**Failing tests must prove:**

- a message under an approved descendant label qualifies;
- a message with no approved business evidence does not qualify;
- a personal/excluded user label wins over text resemblance;
- a Sent message is included when it belongs to an already-qualified business thread;
- a standalone Sent message qualifies only through an approved label, exact known CRM contact, or approved domain rule;
- full body retrieval is never called for a rejected metadata record.

Implement a pure evaluator that returns `included`, `excluded`, or `needs_metadata_review` plus machine-readable reasons. Persist the reason with every item.

Verify and commit:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/gmail-scope-evaluator.test.ts

git commit -am "feat: enforce Gmail business scope"
```

## Task 8: Discover historical Gmail items newest-first

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/gmail-discovery-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/gmail-discovery-service.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/sync-worker.ts`

**Tests:**

- pagination creates one durable discovery item per Google message/thread identity;
- overlapping descendant labels do not create duplicates;
- newest items receive the highest processing priority;
- cursors advance only after item persistence;
- restart resumes at the saved page token;
- recent-validation mode limits the date window without changing the eventual full-backfill cursor.

Implement two historical modes:

1. `recent_validation` with an explicit bounded date window chosen in the setup UI;
2. `full_backfill` that continues through the entire approved history only after user approval.

Commit after targeted tests pass.

## Task 9: Reconstruct and persist complete Gmail threads

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/gmail-message-parser.ts`
- Create: `artifacts/api-server/src/features/google-workspace/gmail-message-parser.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/gmail-ingestion-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/gmail-ingestion-service.pglite.test.ts`

**Tests:**

- MIME multipart/alternative chooses safe plain text and preserves sanitized HTML separately;
- nested multipart attachments are discovered;
- encoded headers and participant addresses normalize correctly;
- Inbox and Sent messages share one local thread;
- message direction is correct for the connected account;
- the same message replay performs zero duplicate inserts;
- thread latest date/category summary fields update without rewriting immutable source identity;
- message bodies are persisted only after scope approval.

Do not store raw OAuth/API responses containing unnecessary personal fields. Retain only the approved business snapshot required for audit/reprocessing.

## Task 10: Copy Gmail attachments and referenced Drive files into durable storage

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/google-file-storage.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-file-storage.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/drive-link-parser.ts`
- Create: `artifacts/api-server/src/features/google-workspace/drive-link-parser.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/file-ingestion-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/file-ingestion-service.pglite.test.ts`

**Tests:**

- identical bytes forwarded repeatedly produce one logical file/version and multiple source links;
- inaccessible/dead links create `file_unavailable`, not a fake file;
- files over the configured limit fail visibly without blocking the thread;
- Google-native Drive documents use an allowed export format and preserve original type/link;
- a changed Drive file creates a new immutable version;
- storage keys are deterministic and do not expose sender addresses or subjects;
- interrupted uploads can retry safely.

Reuse the existing Google Cloud Storage configuration and proven object-storage patterns. Stream bytes while hashing; do not buffer arbitrarily large Drive files in memory.

## Task 11: Add Gmail incremental history sync

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/gmail-incremental-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/gmail-incremental-service.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/sync-worker.ts`

**Tests:**

- history events create/update only affected messages/threads;
- removed labels can move a not-yet-approved item out of scope without deleting archived approved business content;
- a stale/expired Gmail history cursor triggers a bounded reconciliation scan rather than losing changes;
- cursor advances only after all history page items are durably queued;
- repeated pages are idempotent.

## Task 12: Add sync status, recent-validation controls, pause/resume, and error visibility

**Files:**

- Create: `artifacts/api-server/src/routes/google-workspace-sync.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-sync.test.ts`
- Create: `artifacts/adventure-zone/src/pages/GoogleWorkspaceSyncPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/GoogleWorkspaceSyncPage.test.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/GoogleSyncProgress.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/GoogleSyncProgress.test.tsx`
- Modify: `artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts`

Show discovered/processed thread counts, automatic/review counts, copied/unavailable files, current stage, last successful cursor, safe errors, Pause, Resume, and the explicit Continue Full Backfill approval after recent validation.

Test 304/cache behavior so a running status request cannot appear frozen because of stale browser caching. Status endpoints should use appropriate no-store semantics or revision/ETag behavior.

**PR 2 verification gate:** run the Gmail/file suites twice against the same seeded PGlite archive, then API build and frontend build. Verify the second run creates zero duplicate messages, threads, or files.

---

# PR 3 — Matching, limited AI, review, and profile presentation

## Task 13: Implement deterministic profile/contact/booking matching

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/deterministic-matcher.ts`
- Create: `artifacts/api-server/src/features/google-workspace/deterministic-matcher.pglite.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/match-evidence.ts`
- Create: `artifacts/api-server/src/features/google-workspace/match-evidence.test.ts`

**Tests:**

- exact saved contact email produces a high-confidence match when organization context is unique;
- an approved thread rule wins on future replies;
- an approved non-public domain plus agreeing company details may auto-file;
- public domains such as Gmail never establish company ownership by themselves;
- conflicting exact evidence blocks automatic filing;
- booking date/venue/name evidence can narrow an organization match to one booking;
- multiple plausible profiles return review candidates, not a guessed owner;
- AI score cannot elevate an otherwise-unproven candidate into automatic ownership.

Return structured evidence and a documented threshold decision. Avoid a single opaque numeric score with no explanation.

## Task 14: Add durable review decisions and reusable exact rules

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/match-review-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/match-review-service.pglite.test.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-review.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-review.test.ts`
- Create: `artifacts/adventure-zone/src/pages/GoogleWorkspaceReviewPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/GoogleWorkspaceReviewPage.test.tsx`

Review actions:

- connect to organization/contact/booking;
- connect to an internal area;
- create an exact address/domain/thread/calendar-pattern rule;
- reject/supersede a rule;
- retry source processing;
- explicitly ignore out-of-scope material.

Tests must prove a decision is auditable, reversible, idempotent, and scoped so one company’s rule cannot affect another connection.

## Task 15: Add the limited AI categorization/extraction layer

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/google-ai-schema.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-ai-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-ai-service.test.ts`
- Create prompt fixtures under `artifacts/api-server/src/features/google-workspace/fixtures/`
- Modify: `artifacts/api-server/src/features/google-workspace/sync-worker.ts`

Reuse the existing AI completion client. Require strict structured output containing:

- one allowed conversation category;
- concise thread summary;
- extracted fact candidates with exact evidence snippets;
- optional ranked candidate IDs supplied by deterministic matching;
- confidence and rationale.

**Tests:**

- AI receives only already-approved business content;
- IDs/candidates are supplied by the app; the model cannot invent a target ID;
- invalid JSON/schema output becomes a retryable analysis failure;
- AI failure does not block deterministic storage or matching;
- AI output never directly writes associations or CRM fields;
- prompt fixtures cover promo mail, direct reply, RFQ, contract, invoice, vendor application, logistics, employee, receipt, and association examples.

## Task 16: Add source-backed profile-update suggestions

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/profile-suggestion-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/profile-suggestion-service.pglite.test.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-suggestions.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-suggestions.test.ts`
- Create: `artifacts/adventure-zone/src/components/google-workspace/ProfileSuggestionsPanel.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/ProfileSuggestionsPanel.test.tsx`

Suggestions may target contact, organization, or booking fields. Accept/reject is explicit even for blank fields. On acceptance, verify the current CRM value still matches the reviewed snapshot; otherwise return a conflict and require a fresh review. Preserve source message/file/event and evidence excerpt.

## Task 17: Add Employee, Business Receipts, and Associations filing areas

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/internal-filing-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/internal-filing-service.test.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-internal.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-internal.test.ts`
- Create: `artifacts/adventure-zone/src/pages/GoogleWorkspaceInternalPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/GoogleWorkspaceInternalPage.test.tsx`

An item may live in an internal area and also link to a proven event/booking. Do not force Employee or Receipt material onto ordinary event profiles. Enforce Administrator/Office Coordinator access server-side.

## Task 18: Add profile-first Conversations, Files, and Suggested Updates views

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/profile-google-workspace-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/profile-google-workspace-service.pglite.test.ts`
- Create: `artifacts/api-server/src/routes/profile-google-workspace.ts`
- Create: `artifacts/api-server/src/routes/profile-google-workspace.test.ts`
- Create: `artifacts/adventure-zone/src/components/google-workspace/ProfileEmailsAndFilesPanel.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/ProfileEmailsAndFilesPanel.test.tsx`
- Create focused thread/file components in the same folder
- Modify the current event/company profile page that owns the profile tabs

Show complete threads, participants, direction, category/tags, important files, contact/booking/location associations, match evidence, and original Gmail/Drive links. Paginate server-side; do not ship an entire mailbox to the browser.

**PR 3 verification gate:** seed deterministic, ambiguous, AI-failure, suggestion-conflict, and internal-filing fixtures. Verify leg-manager denial for every new route. Run targeted tests, typechecks, and builds.

---

# PR 4 — Google Calendar, Schedule integration, and ACT reconciliation

## Task 19: Ingest the four calendars with recurring/cancelled event support

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/calendar-discovery-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar-discovery-service.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar-ingestion-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar-ingestion-service.pglite.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar-incremental-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar-incremental-service.test.ts`

**Tests:**

- only configured Calendar IDs are read;
- the four source calendars remain distinct;
- all-day and timed events preserve correct timezone/date semantics;
- recurring series and instances have stable identities;
- cancellations remain auditable;
- sync tokens advance only after durable item creation;
- an invalid/expired Calendar sync token triggers a safe calendar-specific rescan;
- replay creates zero duplicates.

## Task 20: Match Calendar events to profiles and bookings without guessing

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/calendar-matcher.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar-matcher.pglite.test.ts`
- Extend: `artifacts/api-server/src/features/google-workspace/match-review-service.ts`

Use exact attendee/organizer contact matches first, then agreeing event family/name, venue, city/address, and dates. Source calendar is supporting brand/package evidence only. Conflicting dates/venue must produce review suggestions rather than overwrite a booking.

## Task 21: Add locally synced Google events to Schedule without duplicate booking cards

**Files:**

- Modify: `artifacts/api-server/src/routes/calendar.ts`
- Add/update: `artifacts/api-server/src/routes/calendar.test.ts`
- Modify the Calendar/Schedule DTO client used by `artifacts/adventure-zone/src/pages/SchedulePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/SchedulePage.tsx`
- Add/update: `artifacts/adventure-zone/src/pages/SchedulePage.test.tsx`

Rules:

- Schedule reads local synced tables only;
- an unlinked Google event appears with a Google/source-calendar badge;
- a Google event linked to an existing booking enriches the booking card rather than creating a second card;
- a conflict badge opens review;
- ACT activities and Google events remain distinguishable but deduplicated where proven.

## Task 22: Add the profile Calendar view

**Files:**

- Create: `artifacts/adventure-zone/src/components/google-workspace/ProfileGoogleCalendarPanel.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/ProfileGoogleCalendarPanel.test.tsx`
- Extend profile Google Workspace API/service from Task 18

Show source calendar, organizer/attendees, location, dates, recurrence, cancellation/update state, booking association, original Google link, and conflicts.

## Task 23: Reconcile real Gmail conversations with imported ACT email-history entries

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/act-email-reconciliation.ts`
- Create: `artifacts/api-server/src/features/google-workspace/act-email-reconciliation.pglite.test.ts`
- Modify the profile timeline/conversation presentation service and component

Use only deterministic, explainable evidence such as:

- same resolved profile/contact;
- normalized sender/recipient/subject;
- compatible timestamp within a narrow documented window;
- exact filename/message identifier when present;
- one unique candidate.

When proven, preserve the ACT activity, create one durable reconciliation link, show Gmail as the richer primary conversation, and mark “also recorded in ACT.” Never delete either source. Ambiguous candidates remain separate.

**PR 4 verification gate:** run Calendar sync twice on the same fixtures, Schedule dedup tests, profile Calendar tests, and ACT/Gmail reconciliation tests. Verify timezone behavior around DST and all-day events.

---

# PR 5 — Hardening, end-to-end validation, and rollout

## Task 24: Track changes to referenced Drive files and create immutable versions

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/drive-incremental-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/drive-incremental-service.test.ts`
- Extend file ingestion/storage tests

Track only Drive file IDs already referenced by approved business sources; do not crawl the user’s entire Drive. Use a durable changes token. A content change creates a new version; permission loss marks source unavailable while retaining prior durable versions.

## Task 25: Add privacy, log-redaction, audit, and endpoint-security hardening

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/google-workspace-security.test.ts`
- Extend every Google Workspace route test
- Modify logging/error mapping files only as required
- Add frontend route-visibility tests for Administrator, Office Coordinator, and leg manager

Prove:

- refresh/access tokens never appear in logs or API responses;
- personal/excluded content never reaches persisted business tables or AI fixtures;
- signed Google URLs and private attachment data are not logged;
- leg managers receive 403 even with guessed IDs and direct endpoint URLs;
- Office Coordinator access is limited to approved business functions;
- audit events exist for automatic filing, reviewed filing, rule changes, suggestion decisions, file copies, retries, and disconnects;
- disconnect stops future sync but preserves archived business records.

## Task 26: Add full end-to-end restart/idempotency and recent-validation fixtures

**Files:**

- Create: `artifacts/api-server/src/features/google-workspace/google-workspace.e2e.pglite.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/fixtures/google-workspace-business-account.ts`
- Create: `artifacts/adventure-zone/src/pages/GoogleWorkspaceFlow.test.tsx`

The E2E fixture must include:

- approved and personal label trees;
- Inbox + Sent business thread;
- standalone business Sent message;
- personal message resembling an event;
- RFQ with PDF;
- duplicate forwarded PDF;
- Drive document with a later version;
- exact contact match;
- ambiguous generic-address match;
- Employee, Receipt, and Association items;
- events on all four calendars;
- recurring and cancelled event;
- booking date conflict;
- matching ACT email-history row;
- AI success, invalid output, and outage cases.

Run the worker, simulate process shutdown with active/expired leases, restart, finish, then run the entire backfill again. Assert exact reconciled totals and zero duplicate source rows/files/associations.

## Task 27: Add CI, deployment documentation, and staged production rollout controls

**Files:**

- Create: `.github/workflows/google-workspace-sync-ci.yml`
- Create or update: `docs/operations/google-workspace-sync.md`
- Update Render/environment documentation
- Update the setup/status UI with release-stage messaging

**CI commands:**

```bash
pnpm install --frozen-lockfile
pnpm --filter @workspace/db exec vitest run src/google-workspace-schema.test.ts
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace src/routes/google-workspace-connection.test.ts src/routes/google-workspace-scope.test.ts src/routes/google-workspace-sync.test.ts src/routes/google-workspace-review.test.ts src/routes/google-workspace-suggestions.test.ts src/routes/google-workspace-internal.test.ts src/routes/profile-google-workspace.test.ts src/routes/calendar.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/features/google-workspace src/components/google-workspace src/pages/GoogleWorkspaceSetupPage.test.tsx src/pages/GoogleWorkspaceSyncPage.test.tsx src/pages/GoogleWorkspaceReviewPage.test.tsx src/pages/GoogleWorkspaceInternalPage.test.tsx src/pages/SchedulePage.test.tsx src/App.admin-navigation.test.ts
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/adventure-zone run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/adventure-zone run build
```

**Production rollout sequence:**

1. Deploy schema/code with `GOOGLE_WORKSPACE_SYNC_ENABLED=false`.
2. Configure OAuth/encryption secrets in Render.
3. Enable the feature and connect the company account.
4. Confirm exact label/calendar IDs in scope preview.
5. Run recent-validation mode only.
6. Review automatic matches, ambiguity rate, unavailable files, storage growth, and any personal-scope violations. Personal-scope violations are a hard stop.
7. Approve full historical backfill.
8. Monitor restart safety and reconciliation totals until complete.
9. Enable incremental sync.
10. Keep Google write scopes absent throughout Release 1.

**Final verification before merge:**

- all targeted tests pass fresh;
- both production builds exit 0;
- migration succeeds against a clean database and an existing-schema fixture;
- E2E backfill passes twice with exact totals;
- Administrator/Office Coordinator/leg-manager authorization matrix passes;
- Gmail labels/messages and Calendar fixtures are unchanged after the complete suite;
- no raw token, personal message body, or private signed URL appears in captured logs;
- recent-validation UI requires explicit approval before full backfill.

Commit:

```bash
git add .github docs artifacts lib

git commit -m "chore: gate Google Workspace sync release"
```

---

## Final acceptance checklist

- [ ] One read-only company Google connection covers Gmail, Calendar, and referenced Drive files.
- [ ] Scope is based on approved Google IDs and descendant labels, with personal exclusions applied before storage/AI.
- [ ] Inbox and Sent messages form complete threads.
- [ ] Historical backfill runs newest-first, pauses/resumes, survives Render restarts, and can be replayed without duplicates.
- [ ] Incremental Gmail, Calendar, and tracked-Drive changes use durable cursors/tokens.
- [ ] Accessible files have durable copies, original links, immutable versions, and checksum deduplication.
- [ ] Deterministic evidence is the only authority for automatic ownership.
- [ ] AI is limited to categorization, summarization, extraction, and candidate ranking.
- [ ] Profile changes require explicit review and protect against stale/conflicting local values.
- [ ] Employees, Business Receipts, and Associations have separate private filing areas.
- [ ] Profiles expose Conversations, Files, Calendar, and Suggested Updates.
- [ ] Schedule uses local synced Calendar data and does not duplicate linked bookings.
- [ ] Real Gmail conversations reconcile with matching ACT history without deleting provenance.
- [ ] Administrator and Office Coordinator access works; leg managers have zero access.
- [ ] Gmail and Google Calendar remain unchanged.
- [ ] Every source item reaches a visible, auditable state.
- [ ] Recent-history validation is approved before full production backfill.
