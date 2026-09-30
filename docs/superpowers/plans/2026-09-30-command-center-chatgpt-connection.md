# Command Center Direct ChatGPT Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the preserved native execution preference, or superpowers:subagent-driven-development if the owner changes that preference. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read and update authorized Command Center records from ChatGPT without invoking the app's paid AI, then deliver a disabled-by-default draft PR.

**Architecture:** Add a private MCP resource server backed by narrowly scoped domain services and transactional operation receipts. A dedicated OAuth provider handles authorization; existing owner authentication handles the consent interaction. Neither layer imports the assistant model runtime or enqueues work.

**Tech Stack:** Existing Express 5, TypeScript, PostgreSQL/Drizzle, Zod, React and Vitest; maintained MCP TypeScript server/Express/Node packages and `oidc-provider` with a PostgreSQL adapter. Pin the compatible published versions during Task 1 and record them; do not copy frozen MCP SDK authorization-server helpers.

**Spec:** `docs/superpowers/specs/2026-09-30-command-center-chatgpt-connection-design.md`

## Scope and global constraints

- This plan implements the spec's first release only. Shared external task leases, role handoffs and dot scheduling are a second subsystem and require their own implementation plan after real client access is verified.
- “Success means a request here can read relevant history and save authorized results directly, with no second model invocation inside Command Center.”
- “Keep the existing in-app assistant available; disabling it, stopping jobs or changing billing is a separate explicit operational action.”
- “Creating a proposed overwrite does not authorize applying it.”
- “A network timeout must be resolved by reading the operation receipt, not by guessing whether a save succeeded.”
- “Deliver the first release in a draft PR with the connection disabled by default.”
- No paid calls, deployment, activation, billing changes, email sends or production mutations in this implementation run.
- Start from a freshly retrieved main, not the old profile-task branch. Inspected main was `fe7c14562cb0a3e903d32404e5d320200d65edef`; PR #960 is merged. Refresh at execution.
- Keep legacy assistant-import routes and credentials unchanged. No forwarding arbitrary routes or accepting the owner/import bearer token as an MCP token.
- All time values are UTC instants; user-facing follow-up dates use America/Denver. Ask for a missing due date rather than inferring an outreach cadence.
- A read-only connection is the initial consent default. Every requested write scope appears explicitly on the consent screen.

## Review focus

1. Concurrent same-lead creations with different request keys must not duplicate the organization; test in Task 4 with real PostgreSQL.
2. Token refresh racing connection revocation must not restore access; test in Task 2.
3. An approved update targeting a subsequently merged/deleted profile must fail safely; test in Task 5.
4. A huge mixed-year history must not silently omit newer evidence or label general contacts as event organizers; test in Task 3.
5. A saved document with missing/stale extraction must not launch a paid extraction or return another profile's data; test in Tasks 3 and 8.

## File map and shared contracts

Use `B = artifacts/api-server/src`, `F = artifacts/adventure-zone/src`, and `C = B/features/chatgpt-connection` in the paths below. These are literal directory prefixes, not new packages.

New files under C: `contracts.ts`, `operation-store.ts`, `oauth-store.ts`, `oauth-provider.ts`, `authorization.ts`, `read-service.ts`, `lead-note-service.ts`, `profile-update-service.ts`, `draft-followup-service.ts`, `tool-registry.ts`, and `mcp-server.ts`. Each owns only its named concern. Adjacent `*.test.ts` files cover units; `*.pglite.test.ts` files cover SQL; `*.postgres.test.ts` files use two real connections.

New routes: `B/routes/chatgpt-connection.ts` (owner management/consent), `B/routes/chatgpt-mcp.ts` (resource endpoint). Mount in `B/app.ts`; register additive schema in the current required-startup migration path. New UI: `F/pages/SettingsChatGPTConnectionPage.tsx`, `F/pages/ChatGPTConnectionConsentPage.tsx` and adjacent tests; register in `F/App.ts`.

`C/contracts.ts` owns these exact shared types:

- `ConnectionScope = 'crm:read' | 'crm:append' | 'crm:update' | 'drafts:write' | 'followups:write'`.
- `ConnectionPrincipal = { ownerId: string; connectionId: string; clientId: string; scopes: ConnectionScope[] }` (server-derived only).
- `SourceRef = { url: string; retrievedAt: string; eventYear: number | null; claim: string; verification: 'verified' | 'unverified' }`.
- `OperationReceipt<T> = { operationId: string; recordId: string; href: string; revision: string; savedAt: string; value: T }`.
- `Page<T> = { items: T[]; nextCursor: string | null; truncated: boolean }`.
- `MutationKey = { requestKey: string }`; reject empty keys and keys over 200 characters.
- `ConnectionError` carries stable `code`, HTTP status and safe user-facing message. Codes distinguish access denied, stale revision, duplicate candidate, missing extraction, invalid source, conflicting request key and revoked connection.

All service classes receive a database/transaction dependency through constructors. They receive `ConnectionPrincipal` on every operation and do not take model-generated actor IDs.

## Task 1: Durable connection and operation foundations

**Files:** create C`contracts.ts`, C`operation-store.ts`, B`db/chatgpt-connection-schema.ts`, adjacent SQL tests; modify current required schema startup, `lib/db/src` schema exports, API package manifest and `pnpm-lock.yaml`.

**Interfaces:** produce `OperationStore.perform<T>(principal, operation: string, key: MutationKey, input: unknown, work: (tx) => Promise<OperationReceipt<T>>): Promise<OperationReceipt<T>>` and `OperationStore.get(principal, operationId: string): Promise<OperationReceipt<unknown> | null>`.

- [ ] Write `operation-store.pglite.test.ts`: retry the identical request and assert one callback invocation/one receipt; reuse key with different input and assert `CONNECTION_REQUEST_CONFLICT`; rollback a failed mutation and assert no record/receipt; another connection cannot read the receipt.
- [ ] Run `pnpm --filter @workspace/api-server exec vitest run src/features/chatgpt-connection/operation-store.pglite.test.ts`; expect FAIL for the absent store.
- [ ] Implement unique `(connection_id, operation, request_key)`, canonical input hashing, transactional mutation+receipt and serialized retries. Lock/check active connection before work; return the committed receipt on replay. Add connection/grant and provider storage tables, with additive repeatable migration and foreign keys. Use server transaction timestamps for revisions where existing records lack them.
- [ ] Resolve maintained MCP packages and `oidc-provider` compatible with deployed Node/Express/Zod; pin versions in lockfile. Follow current SDK resource-server APIs; keep protocol code out of the operation store. Document any required runtime upgrade before committing dependency changes.
- [ ] Run the SQL tests plus a migration-twice test; expect PASS and existing data retained. Commit `feat: add direct connection operation ledger`.

## Task 2: Scoped OAuth connection and owner consent backend

**Files:** C`oauth-store.ts`, C`oauth-provider.ts`, C`authorization.ts`, B`routes/chatgpt-connection.ts`, B`app.ts`, adjacent tests.

**Interfaces:** produce `createConnectionOAuthProvider(config, store)`, `verifyConnectionAccessToken(token: string): Promise<ConnectionPrincipal>`, and `requireConnectionScope(principal, scope): void`. Owner routes list/revoke connections and approve/deny a specific provider interaction.

- [ ] Write authorization tests: deny wrong audience/scope, expired token, revoked grant, forged owner input, PKCE mismatch, reused code and unregistered redirect. Assert refresh concurrent with revoke cannot reactivate access. Assert owner/import tokens fail as connection tokens.
- [ ] Run `pnpm --filter @workspace/api-server exec vitest run src/features/chatgpt-connection/authorization.test.ts src/features/chatgpt-connection/oauth-store.pglite.test.ts`; expect FAIL for absent implementations.
- [ ] Implement provider-backed authorization-code+S256 PKCE; no password/client-credentials grant. Use a fixed configured issuer/resource origin, exact registered redirect URIs, database-backed provider artifacts and 5-minute access/30-day maximum refresh lifetimes. Rotate refresh credentials; revocation invalidates the entire grant. Protect provider artifacts at rest and redact all token/cookie/auth headers from logs. Publish authorization/resource metadata; no arbitrary URL fetching during registration.
- [ ] Implement owner-approved client registration in Settings (metadata and exact redirect URI); do not accept model-supplied client metadata as trusted. Owner consent requires existing owner login, CSRF protection and the provider's pending interaction binding. Empty/read-only scopes are default; requested writes must be individually shown. Approval cannot exceed requested scopes.
- [ ] Run targeted auth suites and existing owner-auth/assistant-import-auth tests; expect PASS. Commit `feat: authorize scoped ChatGPT connections`.

## Task 3: Bounded profile and saved-document reads

**Files:** C`read-service.ts`, C`read-service.test.ts`, C`read-service.pglite.test.ts`; reuse `B/features/event-profiles/event-profile-repository.ts`, `B/features/business-documents/business-document-repository.ts` and saved extraction storage.

**Interfaces:** produce `ConnectionReadService.search(principal, {query, eventYear, cursor?, limit?}): Promise<Page<ProfileSummary>>`, `context(principal, {profileId, eventYear, section?, cursor?}): Promise<ProfileContext>`, and `documentText(principal, {profileId, documentId, cursor?}): Promise<Page<TextChunk>>`. Define `ProfileSummary`, `ProfileContext` and `TextChunk` in contracts from explicit public allowlists, not entire DB rows.

- [ ] Write tests for 20 default/50 maximum search results, a context result capped at 24,000 serialized characters, section pagination, multiple event years, ambiguous names, deleted/merged targets and document/profile access mismatch. Explicitly test missing/stale extraction returns `CONNECTION_EXTRACTION_UNAVAILABLE` with zero extraction calls.
- [ ] Run `pnpm --filter @workspace/api-server exec vitest run src/features/chatgpt-connection/read-service`; expect FAIL.
- [ ] Implement direct repository reads, stable cursor order using timestamp+ID, source dates/year/status, bounded excerpts and app links. Report omitted sections and a continuation cursor; do not silently call a complete history truncated. Return saved document text only if source version/access association is valid. Never call `DocumentExtractionStore.execute`.
- [ ] Run read tests and existing event-profile/document access regressions; expect PASS. Commit `feat: expose bounded CRM context without AI calls`.

## Task 4: Researched lead creation and notes

**Files:** C`lead-note-service.ts`, its PGlite/PostgreSQL tests; extract reusable creation logic from B`routes/assistant-import.ts` into `B/features/event-profiles/assistant-profile-service.ts` if needed. Preserve legacy route behavior.

**Interfaces:** produce `LeadNoteService.createLead(principal, key, {name, city, region, officialWebsite: string | null, sourceIdentity: string | null, eventYear: number | null, sources: SourceRef[]}): Promise<OperationReceipt<ProfileSummary>>` and `appendNote(principal, key, {profileId, subject, body, sources: SourceRef[]}): Promise<OperationReceipt<{noteId: string}>>`.

- [ ] Write tests: exact stable source identity reuses a profile; similar name returns duplicate candidates without creating; two connections racing the same strong identity create one profile; 2027 research on a 2026 organization preserves one organization; unknown organizer remains unknown. Reject non-HTTP(S) source URLs and invalid dates.
- [ ] Run the PGlite tests; expect FAIL. Add a real two-connection PostgreSQL test gated by `TEST_DATABASE_URL`; a skip must be reported as unverified, not passed.
- [ ] Implement with Task 1's transaction and a unique normalized identity record. Normalize website scheme/host/known default ports; do not conflate unrelated events sharing a municipal domain. Strong website identity includes event identity; absent strong identity requires duplicate review. Notes preserve supplied source provenance and mark unverified claims; the server does not claim to independently research them.
- [ ] Run new tests plus existing assistant-import/profile-note regressions; expect PASS for available tests. Commit `feat: save sourced leads and notes idempotently`.

## Task 5: Concrete profile update approvals

**Files:** C`profile-update-service.ts`, its SQL tests, additive proposal/approval storage in B`db/chatgpt-connection-schema.ts`, owner review endpoints in B`routes/chatgpt-connection.ts`.

**Interfaces:** produce `ProfileUpdateService.propose(principal, key, {profileId, expectedRevision, values, sources}): Promise<OperationReceipt<UpdateProposal>>` and `apply(principal, key, {proposalId, approvalId}): Promise<OperationReceipt<ProfileSummary>>`. `UpdateProposal` includes old/new field values, source refs, profile name, target revision, content hash and owner review URL.

- [ ] Write tests: proposing never mutates; fabricated approval denied; approval valid only for exact connection/target/hash/revision; approval expires after 15 minutes; successful retry returns the receipt; stale, deleted or merged target cannot be updated. Concurrent apply commits once.
- [ ] Run `pnpm --filter @workspace/api-server exec vitest run src/features/chatgpt-connection/profile-update-service`; expect FAIL.
- [ ] Implement allowlisted general fields (phone, email, website, address1, address2, city, region, postalCode). Exclude bookings, prices, contract/payment status and organizer-role assertions. Owner-only review records consent to the exact proposal. Apply under connection/proposal/profile locks using Task 1; verify revision and consume approval atomically. Do not expose an MCP tool that mints approval.
- [ ] Run update tests and existing profile update regressions; expect PASS. Commit `feat: require concrete approval for profile updates`.

## Task 6: App drafts and follow-ups

**Files:** C`draft-followup-service.ts`, adjacent SQL tests; reuse/refactor `B/features/assistant-workspace/draft-store.ts` and `B/features/follow-ups/follow-up-service.ts` without importing workspace runtime.

**Interfaces:** produce `DraftFollowupService.saveDraft(principal, key, {draftId?: string, expectedRevision?: string, content: StoredDraftContent}): Promise<OperationReceipt<{draftId: string}>>`, `listFollowups(principal, {profileId, cursor?}): Promise<Page<FollowupSummary>>`, and `saveFollowup(principal, key, {followupId?: string, expectedRevision?: string, profileId, contactId: string | null, bookingId: string | null, kind, dueAt: string}): Promise<OperationReceipt<FollowupSummary>>`.

- [ ] Write tests for sanitized HTML, wrong-profile contact/booking/attachment rejection, stale draft revision, exact retry, explicit dueAt, and existing single-active-follow-up rules. Assert no Gmail/provider invocation and draft visible in the app with in-app AI disabled.
- [ ] Run `pnpm --filter @workspace/api-server exec vitest run src/features/chatgpt-connection/draft-followup-service`; expect FAIL.
- [ ] Implement shared pure draft validation; create a source-tagged external conversation container only if required by existing draft foreign keys, without creating a run/message job. If the current draft UI is hidden behind the AI feature flag, expose an owner-authenticated external-drafts list/detail view through the connection settings page. Use the follow-up domain service within the operation transaction; creation must not bypass its existing deduplication rules. Saving a draft does not mark it sent or create a sent-email follow-up.
- [ ] Run targeted tests plus draft-store and follow-up service/single-active regressions; expect PASS. Commit `feat: save app drafts and follow-ups through direct connection`.

## Task 7: MCP tools and usable connection screens

**Files:** C`tool-registry.ts`, C`mcp-server.ts`, B`routes/chatgpt-mcp.ts`, B`app.ts`; F`pages/SettingsChatGPTConnectionPage.tsx`, F`pages/ChatGPTConnectionConsentPage.tsx`, F`App.tsx`; adjacent tests. Create `docs/integrations/chatgpt-connection.md`.

**Interfaces:** produce `createConnectionMcpServer(services, principal)` using the maintained SDK and `createChatGPTConnectionRouter(deps)` for owner settings/consent/review. Services are those defined in Tasks 1–6, injected explicitly.

- [ ] Write protocol tests that discover and call `search_profiles`, `read_profile_context`, `read_saved_document`, `create_researched_lead`, `append_research_note`, `propose_profile_update`, `apply_approved_profile_update`, `save_app_draft`, `list_followups`, `save_followup`, and `get_operation_receipt`. A connection lacking scopes neither sees nor invokes writes. No send/delete/code/generic-request tools exist.
- [ ] Write UI tests: owner sees endpoint, registered clients, scopes, last use, revoke, proposed updates and external drafts; consent shows exact requested permissions; deny/revoke work; stale proposal review refreshes. No raw token is rendered.
- [ ] Run backend MCP and frontend connection tests; expect FAIL.
- [ ] Implement stateless Streamable HTTP at `/api/chatgpt/mcp`, metadata and per-request authorization. `CHATGPT_CONNECTION_ENABLED` defaults false; flag off blocks tools but leaves owner revocation available. Bound request bodies, enforce configured host/origin rules and 60 calls/minute/connection. Disable sampling/model callbacks. Register metadata annotations matching read/write behavior. Add Settings routes at `/settings/chatgpt-connection` and provider-bound consent at `/chatgpt-connection/consent`.
- [ ] Document installation using the actual endpoint and registered OAuth client, plus a read-only verification query. Existing import token is not a setup shortcut. Run tests; expect PASS. Commit `feat: connect ChatGPT tools and owner controls`.

## Task 8: Prove cost isolation and prepare release

**Files:** C`connection-flow.integration.test.ts`, C`connection-boundary.test.ts`, F`pages/SettingsChatGPTConnectionPage.integration.test.tsx`, `docs/verification/2026-09-30-chatgpt-connection.md`.

**Interfaces:** consumes all preceding tasks; produces reviewed draft PR, build/test evidence, installation instructions and an explicit list of release gates.

- [ ] Write integration test: authorized read → append sourced note → save draft → create follow-up → replay all writes. Use real local SQL, AI flag false and no model API key. Throw if any model/research/extraction/provider or RunStore enqueue method is invoked. Assert one record per operation and visible app drafts/receipts after reload.
- [ ] Add a dependency-boundary test rejecting imports from runtime/worker/provider modules in the connection service graph. Add disabled-flag, bad-auth, large-context, stale-review and revoked-connection flow coverage. Run tests; expect FAIL before missing integration wiring is fixed.
- [ ] Wire only the missing boundaries and run focused connection/auth/import/draft/follow-up regressions. Expect PASS. Run API/UI production builds and compare type diagnostics against a fresh main baseline; no new diagnostics in changed paths.
- [ ] Run PostgreSQL concurrent creation/replay/revoke tests if a disposable server is available. Inspect UI at 360px/768px with offline/reconnect. Record unavailable database/browser/physical Fold checks as release gates, never as successful checks.
- [ ] Obtain one independent whole-branch review after native implementation, fix Important/Critical findings with reproducing tests, then run the affected full regression selection. Commit `test: verify direct connection isolation and recovery`.
- [ ] Publish a draft PR against refreshed main with flag off, exact test results and release gates. No deployment or live record mutations. Real ChatGPT client installation/Android access remains a post-review account check; no promise of dots/autonomous triggering until verified.

## Self-review and execution handoff

The first-release requirements map to Tasks 1–8: persistence/replay (1), consent/revocation (2), bounded history/documents (3), sources/duplicates (4), overwrites (5), drafts/follow-ups (6), connection/UI (7), and cost isolation/release evidence (8). Every Review Focus item has an owning test. Server-derived principal and one operation receipt shape are used throughout.

The second-release handoff section of the approved design is deliberately excluded from this build. This avoids introducing agent scheduling before real client capability is known. Prepare its plan after a direct read/save works in the user's account.

Preserve native execution with one independent final review, consistent with the earlier selected workflow. The writing-plans workflow requires owner review of this plan before implementation. Ask whether it captures the intended first release; do not ask the owner to choose the execution method again.

## Primary references checked

- https://developers.openai.com/plugins/quickstart
- https://developers.openai.com/plugins/build/auth
- https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/authorization.md
- https://github.com/panva/node-oidc-provider

The current MCP SDK describes the resource server separately from the authorization server; its old server auth helpers are frozen. Use the dedicated provider above, and verify current package compatibility at execution rather than copying old imports.
