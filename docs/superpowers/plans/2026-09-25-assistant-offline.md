# Assistant Offline Workspace Implementation Plan

> **For agentic workers:** Use the available collaboration tools for independent implementation and whole-branch review. Steps use checkbox syntax.

**Goal:** Prepare records and drafts on the Fold, reopen them offline, and safely sync deliberate draft edits later.
**Architecture:** A static-only production shell cache supports a dedicated local workspace. Prepared snapshots and pending edits live in IndexedDB, scoped to a verified owner-token digest. The online assistant explicitly prepares data; offline mode has no live business actions.
**Tech Stack:** Vite, service workers, IndexedDB, TypeScript, React, Vitest.
**Spec:** `docs/superpowers/specs/2026-09-25-assistant-costs-offline-design.md`

## Global Constraints

- At most 10 prepared conversations; access expires at token expiry or after 7 days, whichever comes first.
- No private API responses in Cache Storage, no automatic email actions, no broadened online authentication.
- Preserve pending local edits and original draft revisions on refresh or conflict.
- Support configured Vite base paths and phone-sized controls.

## Review Focus

- Restart without internet must load all required scripts and CSS.
- Storage eviction or partial downloads must not report ready.
- Logout or a different token must not expose the previous owner's snapshot.
- Reconnection conflicts must preserve the local draft and the current server draft.
- A network failure after a successful PATCH must not overwrite newer server changes on retry.

### Task 1: Production shell cache

**Files:** `artifacts/adventure-zone/public/sw.js`, `vite.config.ts`, new build helper/test and `src/lib/offline/workspace-shell.ts`, existing `components/connectivity/offline-banner.tsx`.
**Interfaces:** Export `prepareOfflineShell(onProgress?: (completed:number,total:number)=>void): Promise<void>` and `isOfflineShellReady(): Promise<boolean>` from `workspace-shell.ts`.

- [x] Write failing tests for complete preparation, atomic failure, navigation fallback and rejecting asset-to-HTML fallback.
- [x] Generate a production asset manifest and implement explicit worker preparation, verification and progress messaging.
- [x] Verify worker tests and inspect the production build manifest.

### Task 2: Local snapshot/draft workspace

**Files:** New `src/features/assistant-workspace/offline-*.ts`, `src/components/assistant-workspace/OfflinePreparation.tsx`, and `src/pages/AssistantOfflinePage.tsx`, with focused tests.
**Interfaces:** `OfflinePreparation({conversation: Conversation|null, busy?:boolean})`; default `AssistantOfflinePage`; export `clearOfflineWorkspace(): Promise<void>` from `offline-store.ts` for authentication cleanup.

- [x] Test token digest/expiry, storage errors, draft persistence, preparation preserving edits, conflicts and uncertain retry reconciliation.
- [x] Implement explicit preparation of current conversation, selected profile snapshots and rules using existing authenticated read endpoints; bounded storage and clear snapshot age.
- [x] Add local branded draft editing and explicit revision-checked server synchronization, with no Gmail/send actions.
- [x] Run all new local-workspace tests under Node 22.

### Task 3: Routing, isolation and final integration

**Files:** `src/App.tsx`, `src/lib/auth-context.tsx`, `src/lib/auth-token.ts`, `src/pages/AssistantWorkspacePage.tsx`, and focused tests.
**Interfaces:** Dedicated `/assistant/offline` route outside live protected content; root integrates Task 1/2 exports and invokes cleanup on session invalidation.

- [x] Expose offline preparation and a persistent link to the local workspace; provide an offline entry from landing/sign-in.
- [x] Ensure startup connection failures retain saved data, while logout/rejection/token replacement purge it without opening protected routes.
- [x] Run offline/assistant/auth tests and both builds, compare typecheck baseline, obtain whole-branch review, and record unobserved physical-device checks in verification notes.

Verification evidence: `docs/assistant-costs-offline-verification.md`.
