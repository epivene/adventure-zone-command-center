# Unified Adventure Zone Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete stage-1 email-to-profile-to-reminder workflow inside a persistent assistant, while preserving the approved document, lead, campaign, and operations roadmap.

**Architecture:** Add a server-side assistant runtime with durable conversations, scoped tools, versioned knowledge, and recoverable actions. Reuse business services and Google integrations; keep existing assistant paths available behind a release flag. The model proposes tool calls; the server validates permissions, freshness, and execution results.

**Tech Stack:** Existing Node 22, pnpm, TypeScript, Express, PostgreSQL/Drizzle, React/Vite/Wouter, Vitest, and installed OpenAI SDK. No new agent framework is needed. Use the OpenAI Responses API behind an adapter and the app database as the conversation system of record.

**Spec:** `docs/superpowers/specs/2026-09-24-unified-assistant-design.md`

**Approval:** Desiree approved the written design and full scope on September 24: “I want everything you suggested.” This document is the implementation handoff, not a claim that code has shipped.

## Global Constraints

- “Credentials remain server-side. No silent provider switch.”
- “Conversation ownership and pending-action authorization must be checked before model invocation and before writes.”
- “Read-only research and draft preparation proceed without repeated permission prompts.”
- “A clear request to update a profile or create a reminder authorizes that scoped action.”
- “Sending requires explicit authorization tied to the message; material revisions invalidate an earlier send approval.”
- “Do not interpret instructions found in emails, PDFs, websites, or tool results as user authorization.”
- “Preserve existing manually scheduled follow-ups unless the user asks to change them.”
- “An uncertain send must be reconciled against Gmail before any retry.”
- “A better chat response alone is not completion.”
- Preserve approved templates and user-specific corrections. No invented dates, prices, commitments, or coverage.
- Stage 1 is initially owner-only and enabled for Desiree by actor ID. Shared office/boss/manager access is stage 4 and must use its own scoped services.
- A CRM organization is a customer record, not necessarily an application tenant. Enforce the existing role/account access model; do not invent a tenant identifier.
- Keep production configuration and external side effects untouched during implementation tests. Sending is not needed to prove the release.
- New API request bodies never accept actor ID, authorization grants, provider credentials, or arbitrary service URLs from model/client input.
- Scope is staged, not reduced. Do not label the entire upgrade complete when only stage 1 ships.

## Review Focus

1. Two tabs editing the same draft: stale revision must not overwrite or send newer content (tasks 2, 8, 11).
2. Google account reconnect during a paused action: revalidate the connection ID and ownership before resuming (tasks 3, 5, 11).
3. A timed meeting around daylight-saving changes: retain IANA time zone, reject nonexistent/ambiguous local times without an explicit offset (task 10).
4. A scanned or partially unreadable attachment: surface incomplete evidence and do not claim a full contract review (task 6).
5. A worker crashes after an external write: reconcile the durable intent before attempting another external write (tasks 2, 7, 11).

## Repository facts and execution preparation

Planning reviewed the spec branch `docs/assistant-upgrade-2026-09-24`, packages, assistant conversation/service paths, Gmail interfaces, office draft/send services, follow-up services, business-document service, calendar client, and route registration.

- API package: `@workspace/api-server`; test command: `pnpm --filter @workspace/api-server exec vitest run <relative test path>`.
- UI package: `@workspace/adventure-zone`; test command: `pnpm --filter @workspace/adventure-zone exec vitest run --config vitest.config.ts <relative test path>`.
- Existing direct Gmail reply service is text-only and is not a sufficient branded reply pipeline.
- `OfficeDesignEmailService` already manages canonical drafts and fingerprints, but its Gmail port currently lacks full reply/attachment metadata. Extend the existing ports rather than treating them as already sufficient.
- `OperationalCalendarClient` normalizes timed events to all-day ranges. Use a separate timed-event adapter for meetings; do not silently lose hours.
- `FollowUpService.create` consumes organizationId/contactId/bookingId/kind/dueAt. Validate the target access in the assistant adapter before calling it.
- Existing database startup migration patterns include existence-only checks. New schema checks must verify columns and indexes, including upgrades from partially present tables.
- Git cloning without credentials failed in the planning environment. Before product edits, establish an authenticated checkout via the supported repository connection or environment mechanism. Do not print tokens. If unavailable, report the concrete blocker rather than claiming test execution.

At execution: read applicable AGENTS files; create an isolated checkout using using-git-worktrees; fetch current main; review changes since this spec branch; record the starting SHA. Keep this plan and its spec in the implementation branch.

## File and interface map

All new server modules below live under `artifacts/api-server/src/features/assistant-workspace/`. Each owns one responsibility:
`contracts.ts`, `conversation-store.ts`, `action-store.ts`, `access.ts`, `knowledge.ts`, `model-config.ts`, `openai-model.ts`, `read-tools.ts`, `document-reader.ts`, `tool-registry.ts`, `orchestrator.ts`, `worker.ts`, `draft-tools.ts`, `record-tools.ts`, `calendar-tools.ts`, `send-tools.ts`, `runtime.ts`.
Each gets a colocated test file. UI lives in a new `features/assistant-workspace/` folder and focused components, preserving existing drawer entry points.

### Shared contract, defined in task 1

```ts
export type Actor = { id: string; role: "owner"; connectionId: string | null };
export type Evidence = {
  id: string; kind: "profile" | "email" | "document" | "calendar" | "rule";
  recordId: string; eventYear: number | null; occurredAt: string | null;
  retrievedAt: string; version: string | null; complete: boolean; text: string;
};
export type Selection = {
  organizationIds: string[]; bookingId: string | null;
  threadId: string | null; draftId: string | null; eventYear: number | null;
};
export type ToolResult = {
  status: "ok" | "partial" | "blocked" | "uncertain" | "failed";
  data: unknown; evidence: Evidence[];
  receipts: { kind: string; id: string; href: string; verifiedAt: string }[];
  code: string | null;
};
export type ToolCall = { id: string; name: string; arguments: string };
export type Turn = { role: "user" | "assistant"; text: string };
export type ModelInput = {
  instructions: string; turns: Turn[]; state: Selection; evidence: Evidence[];
  providerItems: unknown[]; toolDefinitions: unknown[]; signal: AbortSignal;
};
export type ModelStep = {
  text: string; calls: ToolCall[]; providerItems: unknown[];
  inputTokens: number; outputTokens: number;
};
export interface ModelPort { next(input: ModelInput): Promise<ModelStep> }
export type Grant = {
  actorId: string; sourceMessageId: string; actionKind: string;
  targetIds: string[]; revision: string | null; connectionId: string | null;
};
export type RunContext = {
  actor: Actor; conversationId: string; runId: string;
  selection: Selection; grants: Grant[]; signal: AbortSignal;
};
export type ActionIntent = {
  id: string; conversationId: string; actorId: string; kind: string;
  targetId: string; expectedRevision: string | null;
  connectionId: string | null; arguments: unknown; sourceMessageId: string;
};
export interface ToolRegistry {
  definitions(context: RunContext): unknown[];
  execute(context: RunContext, call: ToolCall): Promise<ToolResult>;
}
```

Authorization is not a model-generated boolean. Grants are server records grounded in direct user messages or UI commands. Sending always references an exact prepared action and content fingerprint; vague “yes” with multiple pending sends does not select one.

## Task sequence

### Task 1: Typed requests and owned durable conversation storage

**Files:**
- Create: lib/db/migrations/20260924_assistant_workspace.sql
- Create: lib/db/src/assistant-workspace-schema.ts
- Modify: lib/db/src/index.ts
- Create: artifacts/api-server/src/db/assistant-workspace-startup-migration.ts
- Modify: artifacts/api-server/src/index.ts
- Create: artifacts/api-server/src/features/assistant-workspace/contracts.ts
- Create: artifacts/api-server/src/features/assistant-workspace/conversation-store.ts
- Test: artifacts/api-server/src/features/assistant-workspace/conversation-store.test.ts

**Interfaces:** Produces the shared contract above and ConversationStore.create(actorId, title), get(actorId, id), append(actorId, id, requestKey, turn), setSelection(actorId, id, expectedVersion, selection). All methods return owned records; get returns null for an inaccessible conversation. Version increments are transactional.

- [ ] **1. Add the regression test below and its stated integration cases.** These are intended behavior tests, not assertions that a particular internal implementation exists.

```ts
import { describe, it, expect } from "vitest";
import { selectionSchema } from "./contracts";
it("rejects client-supplied authority", () => {
  expect(selectionSchema.safeParse({
    organizationIds: [], bookingId: null, threadId: null,
    draftId: null, eventYear: 2027, actorId: "someone-else"
  }).success).toBe(false);
});
```

- [ ] **2. Run the targeted test to establish the failure.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/conversation-store.test.ts
```

Expected initially: failure because the new behavior is absent. If a test fails for configuration/import setup unrelated to the behavior, repair the test harness first; do not count that as a reproduced behavioral failure.

- [ ] **3. Implement the contract and behavior.**

Create strict Zod schemas for Selection and the API inputs; use the exact fields in the shared contract. Implement actor-owned SQL queries and deterministic message sequence ordering. Start from this ownership/deduplication structure:
```sql
create table if not exists assistant_workspace_conversations (
 id uuid primary key default gen_random_uuid(), actor_id text not null,
 title text not null, selection jsonb not null, summary jsonb not null default '{}',
 version integer not null default 1, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), unique(id, actor_id)
);
create table if not exists assistant_workspace_messages (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null, actor_id text not null,
 sequence bigint generated always as identity,
 request_key text not null, role text not null check(role in ('user','assistant')),
 body text not null, created_at timestamptz not null default now(),
 foreign key(conversation_id, actor_id)
   references assistant_workspace_conversations(id, actor_id),
 unique(conversation_id, request_key, role)
);
```
Return a 409-equivalent domain conflict when a selection version does not match. Add integration cases with PGlite for cross-actor reads/writes, duplicate request keys, and same-timestamp message ordering. Wire the migration into readiness before new workers start. Run twice on empty and partially upgraded database fixtures; verify actual columns and constraints, not only table existence. Keep legacy conversations readable through an explicit import action; do not rewrite their history.

- [ ] **4. Run the targeted test again, then the related module tests.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/conversation-store.test.ts
```

Expected: all targeted cases pass. Include any new colocated tests introduced by this task in the same run. Resolve concrete regressions before moving forward.

- [ ] **5. Commit only this task's implementation and test files.**

Review `git diff --check` and `git diff --stat`, stage the listed paths and their tests, then:

```bash
git commit -m "feat(assistant): persist owned workspace conversations"
```


### Task 2: Action ledger, run leases, and recovery

**Files:**
- Create: artifacts/api-server/src/features/assistant-workspace/action-store.ts
- Modify: lib/db/migrations/20260924_assistant_workspace.sql
- Modify: lib/db/src/assistant-workspace-schema.ts
- Modify: artifacts/api-server/src/db/assistant-workspace-startup-migration.ts
- Test: artifacts/api-server/src/features/assistant-workspace/action-store.test.ts

**Interfaces:** Produces ActionStore.prepare(intent), claim(actorId, actionId, workerId), checkpoint(actorId, actionId, leaseToken, status, result), requestCancel(actorId, runId), and reconcile(actorId, actionId). claim returns null or {intent, leaseToken}; checkpoint rejects stale lease tokens. A succeeded action returns its original receipt on replay.

- [ ] **1. Add the regression test below and its stated integration cases.** These are intended behavior tests, not assertions that a particular internal implementation exists.

```ts
import { it, expect } from "vitest";
import { recoveryMode } from "./action-store";
it("never retries an uncertain external write as a new write", () => {
  expect(recoveryMode("provider_started")).toBe("reconcile");
  expect(recoveryMode("uncertain")).toBe("reconcile");
  expect(recoveryMode("succeeded")).toBe("return_receipt");
});
```

- [ ] **2. Run the targeted test to establish the failure.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/action-store.test.ts
```

Expected initially: failure because the new behavior is absent. If a test fails for configuration/import setup unrelated to the behavior, repair the test harness first; do not count that as a reproduced behavioral failure.

- [ ] **3. Implement the contract and behavior.**

Define recovery as a pure decision:
```ts
export function recoveryMode(status: string) {
  if (status === "succeeded") return "return_receipt";
  if (["provider_started", "uncertain"].includes(status)) return "reconcile";
  return "claim";
}
```
Persist runs with actor/conversation identity, request key, status, worker ID, monotonically increasing lease token, lease expiry, cancellation timestamp, budget counters, and checkpoint. Persist actions with ActionIntent fields, argument fingerprint, execution state, provider receipt, error code, and verification time. Add unique (actor_id, source_message_id, kind, target_id, argument_fingerprint). Use row locking plus conditional writes to fence old workers; never hold a database transaction across a provider call.
Persist provider_started before external mutation. An expired worker in that state enters reconciliation, never queued execution. Add database tests for two simultaneous claims, a stale worker checkpoint, cancellation before mutation, and a crash between provider success and receipt persistence. Internal database writes use the same transaction for mutation plus receipt whenever possible.

- [ ] **4. Run the targeted test again, then the related module tests.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/action-store.test.ts
```

Expected: all targeted cases pass. Include any new colocated tests introduced by this task in the same run. Resolve concrete regressions before moving forward.

- [ ] **5. Commit only this task's implementation and test files.**

Review `git diff --check` and `git diff --stat`, stage the listed paths and their tests, then:

```bash
git commit -m "feat(assistant): add recoverable action execution ledger"
```


### Task 3: Permissions and explicit model configuration

**Files:**
- Create: artifacts/api-server/src/features/assistant-workspace/access.ts
- Create: artifacts/api-server/src/features/assistant-workspace/model-config.ts
- Create: artifacts/api-server/src/features/assistant-workspace/openai-model.ts
- Reference: artifacts/api-server/src/lib/auth.ts
- Reference: artifacts/api-server/src/features/google-workspace/google-connection-repository.ts
- Test: artifacts/api-server/src/features/assistant-workspace/access.test.ts

**Interfaces:** Produces assertActionAccess({actor, ownerId, requiredConnectionId}), readModelConfig(env), and createOpenAiModel(config): ModelPort. Inputs are server-derived. readModelConfig returns enabled, allowedActorIds, model, maxSteps, maxOutputTokens, maxRunTokens, timeoutMs; absent/invalid settings disable the new assistant without changing legacy behavior.

- [ ] **1. Add the regression test below and its stated integration cases.** These are intended behavior tests, not assertions that a particular internal implementation exists.

```ts
import { it, expect } from "vitest";
import { assertActionAccess } from "./access";
it("blocks a switched Google account", () => {
  expect(() => assertActionAccess({
    actor: { id: "desiree", role: "owner", connectionId: "new-account" },
    ownerId: "desiree", requiredConnectionId: "old-account"
  })).toThrow("ASSISTANT_CONNECTION_CHANGED");
});
```

- [ ] **2. Run the targeted test to establish the failure.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/access.test.ts
```

Expected initially: failure because the new behavior is absent. If a test fails for configuration/import setup unrelated to the behavior, repair the test harness first; do not count that as a reproduced behavioral failure.

- [ ] **3. Implement the contract and behavior.**

Use a fail-closed boundary:
```ts
export function assertActionAccess(input: {
 actor: Actor; ownerId: string; requiredConnectionId: string | null
}) {
 if (input.actor.id !== input.ownerId || input.actor.role !== "owner")
   throw new Error("ASSISTANT_ACCESS_DENIED");
 if (input.requiredConnectionId !== null &&
     input.requiredConnectionId !== input.actor.connectionId)
   throw new Error("ASSISTANT_CONNECTION_CHANGED");
}
```
Configuration: ASSISTANT_WORKSPACE_ENABLED defaults false; ASSISTANT_WORKSPACE_ACTOR_IDS is an explicit owner allowlist; ASSISTANT_OPENAI_MODEL must be explicitly configured from account-available tool-capable models. Use OPENAI_API_KEY server-side. Defaults: 12 model steps, 8192 output tokens per response, 100000 cumulative tokens per run, 120 seconds per provider call. Bound and validate numeric overrides.
Use installed SDK types for Responses streaming; accumulate function calls only after complete arguments. Preserve all provider continuation items needed for tool responses. Report timeout/provider rejection with a safe error code, never return a fabricated answer. Test missing key, invalid model, malformed argument JSON, tool-call chunks split across events, abort, and no Anthropic fallback. Record usage and latency only. Confirm the selected model with a small non-customer capability probe during release; do not assume every ChatGPT model name is an API model.

- [ ] **4. Run the targeted test again, then the related module tests.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/access.test.ts
```

Expected: all targeted cases pass. Include any new colocated tests introduced by this task in the same run. Resolve concrete regressions before moving forward.

- [ ] **5. Commit only this task's implementation and test files.**

Review `git diff --check` and `git diff --stat`, stage the listed paths and their tests, then:

```bash
git commit -m "feat(assistant): configure model and enforce scoped access"
```


### Task 4: Versioned business knowledge and provenance

**Files:**
- Create: artifacts/api-server/src/features/assistant-workspace/knowledge.ts
- Create: imports/assistant-knowledge/2026-09-24-approved-rules.json
- Modify: artifacts/api-server/src/features/assistant/business-knowledge-repository.ts
- Modify: lib/db/migrations/20260924_assistant_workspace.sql
- Test: artifacts/api-server/src/features/assistant-workspace/knowledge.test.ts

**Interfaces:** Produces KnowledgeRepository.list({organizationId, eventYear, at}), propose(input), approve(actorId, proposalId, expectedVersion), and shouldApplySeed({currentVersion, incomingVersion, userEdited}). Rule records contain ruleKey, version, body, sourceLabel, effectiveFrom, effectiveTo, scope, status, supersedesId, approvedBy, and reviewedAt.

- [ ] **1. Add the regression test below and its stated integration cases.** These are intended behavior tests, not assertions that a particular internal implementation exists.

```ts
import { it, expect } from "vitest";
import { shouldApplySeed } from "./knowledge";
it("preserves a later user correction when old seeds run", () => {
 expect(shouldApplySeed({
   currentVersion: 3, incomingVersion: 2, userEdited: true
 })).toBe(false);
});
```

- [ ] **2. Run the targeted test to establish the failure.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/knowledge.test.ts
```

Expected initially: failure because the new behavior is absent. If a test fails for configuration/import setup unrelated to the behavior, repair the test harness first; do not count that as a reproduced behavioral failure.

- [ ] **3. Implement the contract and behavior.**

Implement the seed guard:
```ts
export function shouldApplySeed(input: {
 currentVersion: number; incomingVersion: number; userEdited: boolean
}) {
 return !input.userEdited && input.incomingVersion > input.currentVersion;
}
```
Create rule revisions in an append-only history; approving a revision supersedes only its prior revision. Global rules and event-specific exceptions remain distinct. Stop the old upsertInitialSeed path from overwriting reviewed content. A newer conflicting rule is a proposal, not an automatic override.
Seed user-approved sizing: Adventure Zone 10,000–15,000 sq ft; Warrior's Playground 7,000–10,000 sq ft. Pirate's size is not confirmed in available project context: mark for verification rather than guessing. Include the 40/60 prepaid rule separately from any pay-per-play revenue split, WYO Bounce Bash's event-specific exception, 30-day offer timing from send, June renewal COI constraint, Foam Party add-on facts, and writing/template preferences. Pricing, split direction, exact renewal day, current URLs, and customer exceptions require their actual source before being used in a finalized offer.
Tests cover supersession, customer/year applicability, conflicts, and sample COI/historical contract evidence never becoming universal current coverage. Import only Adventure Zone context, not unrelated personal memories.

- [ ] **4. Run the targeted test again, then the related module tests.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/knowledge.test.ts
```

Expected: all targeted cases pass. Include any new colocated tests introduced by this task in the same run. Resolve concrete regressions before moving forward.

- [ ] **5. Commit only this task's implementation and test files.**

Review `git diff --check` and `git diff --stat`, stage the listed paths and their tests, then:

```bash
git commit -m "feat(assistant): maintain sourced business rule revisions"
```


### Task 5: Read tools for CRM and complete Gmail threads

**Files:**
- Create: artifacts/api-server/src/features/assistant-workspace/read-tools.ts
- Reference: artifacts/api-server/src/features/google-workspace/google-api-types.ts
- Reference: artifacts/api-server/src/features/google-workspace/google-profile-email-archive-service.ts
- Reference: artifacts/api-server/src/features/assistant/profile-search-repository.ts
- Reference: artifacts/api-server/src/features/assistant/booking-context-repository.ts
- Test: artifacts/api-server/src/features/assistant-workspace/read-tools.test.ts

**Interfaces:** Produces createReadTools(deps) definitions for search_profiles, read_profile_history, search_email, read_email_thread, list_documents, list_followups, read_calendar, read_availability, and read_templates. Each implementation accepts (RunContext, validatedArguments) and returns ToolResult. search_email returns a cursor; read_email_thread returns all fetched messages plus completeness and attachment references.

- [ ] **1. Add the regression test below and its stated integration cases.** These are intended behavior tests, not assertions that a particular internal implementation exists.

```ts
import { it, expect } from "vitest";
import { threadEvidence } from "./read-tools";
it("includes sent history and does not label a partial archive complete", () => {
 const evidence = threadEvidence({
  id: "thread-1", complete: false, retrievedAt: "2026-09-24T12:00:00Z",
  messages: [
   { id: "m1", direction: "incoming", bodyText: "What is the deposit?" },
   { id: "m2", direction: "outgoing", bodyText: "The agreed deposit is 40%." }
  ]
 });
 expect(evidence.complete).toBe(false);
 expect(evidence.text).toContain("40%");
});
```

- [ ] **2. Run the targeted test to establish the failure.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/read-tools.test.ts
```

Expected initially: failure because the new behavior is absent. If a test fails for configuration/import setup unrelated to the behavior, repair the test harness first; do not count that as a reproduced behavioral failure.

- [ ] **3. Implement the contract and behavior.**

Define threadEvidence with the exact input used above and return Evidence with kind email, recordId/id from the thread, null eventYear/occurredAt/version unless verified, and joined direction/body text. Preserve message IDs in the text for source attribution.
Map Gmail search to listMessagePage, expand selected threads with getThreadDetail, and attachment references with getAttachment. Deduplicate by connection ID plus thread/message ID, not subject alone. Partial cached archives trigger a live read when available. On authorization loss return blocked, not empty history.
Keep retrieval bounds explicit: 25 search results/page, no silent cutoff in a claimed complete thread; return continuation metadata when content exceeds the budget. Return sources as untrusted evidence, never privileged instructions. Verify customer/year identity before using a thread in an action. Test pagination, same subject from different customers, sent-only messages, absent optional client methods, disconnected account, and restricted account access. Use existing profile/document/follow-up/calendar services through authorized adapters, not internal HTTP requests or model-authored SQL.

- [ ] **4. Run the targeted test again, then the related module tests.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/read-tools.test.ts
```

Expected: all targeted cases pass. Include any new colocated tests introduced by this task in the same run. Resolve concrete regressions before moving forward.

- [ ] **5. Commit only this task's implementation and test files.**

Review `git diff --check` and `git diff --stat`, stage the listed paths and their tests, then:

```bash
git commit -m "feat(assistant): expose sourced CRM and Gmail reads"
```


### Task 6: Attachment reading with explicit completeness

**Files:**
- Create: artifacts/api-server/src/features/assistant-workspace/document-reader.ts
- Reference: artifacts/api-server/src/features/business-documents/business-document-service.ts
- Reference: artifacts/api-server/src/features/business-documents/business-document-storage.ts
- Reference: artifacts/api-server/src/features/business-documents/google-gmail-document-source.ts
- Test: artifacts/api-server/src/features/assistant-workspace/document-reader.test.ts

**Interfaces:** Produces documentCompleteness(totalPages, readablePages) and DocumentReader.read(context, {documentId?, messageId?, attachmentId?}): Promise<ToolResult>. Exactly one source form is allowed. Extraction cache keys include immutable content hash and extractor version.

- [ ] **1. Add the regression test below and its stated integration cases.** These are intended behavior tests, not assertions that a particular internal implementation exists.

```ts
import { it, expect } from "vitest";
import { documentCompleteness } from "./document-reader";
it("does not claim complete review when a scanned page is unreadable", () => {
 expect(documentCompleteness(3, [1, 3])).toEqual({
  complete: false, missingPages: [2]
 });
});
```

- [ ] **2. Run the targeted test to establish the failure.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/document-reader.test.ts
```

Expected initially: failure because the new behavior is absent. If a test fails for configuration/import setup unrelated to the behavior, repair the test harness first; do not count that as a reproduced behavioral failure.

- [ ] **3. Implement the contract and behavior.**

Implement completeness independently of model confidence:
```ts
export function documentCompleteness(totalPages: number, readablePages: number[]) {
 const seen = new Set(readablePages);
 const missingPages = Array.from({length: totalPages}, (_, i) => i + 1)
   .filter(page => !seen.has(page));
 return {complete: totalPages > 0 && missingPages.length === 0, missingPages};
}
```
Read bytes only from authorized stored document IDs or Gmail attachment IDs. Detect actual MIME type; limit an extraction job to 25 MB and 100 pages and return partial/blocked with an explanation beyond that limit. Reuse a verified extraction service; use the configured provider's supported PDF/image inputs for scans if no adequate existing extractor exists. Never assume pdf-lib extracts text.
Store page-level text, source hash/version, extraction state, and inaccessible-page details. Do not persist signed storage URLs in evidence. Use authenticated app links for users. Compare signed/unsigned versions by actual document metadata and content; do not infer execution solely from a filename. Test corrupt PDF, encrypted PDF, changed bytes under the same document ID, unavailable attachments, and an injection-bearing document. Use synthetic fixtures; uploaded customer PDFs are not test data to commit.

- [ ] **4. Run the targeted test again, then the related module tests.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/document-reader.test.ts
```

Expected: all targeted cases pass. Include any new colocated tests introduced by this task in the same run. Resolve concrete regressions before moving forward.

- [ ] **5. Commit only this task's implementation and test files.**

Review `git diff --check` and `git diff --stat`, stage the listed paths and their tests, then:

```bash
git commit -m "feat(assistant): read attachments with page-level evidence"
```


### Task 7: Tool registry and resumable conversation runtime

**Files:**
- Create: artifacts/api-server/src/features/assistant-workspace/tool-registry.ts
- Create: artifacts/api-server/src/features/assistant-workspace/orchestrator.ts
- Create: artifacts/api-server/src/features/assistant-workspace/worker.ts
- Create: artifacts/api-server/src/features/assistant-workspace/runtime.ts
- Modify: artifacts/api-server/src/index.ts
- Test: artifacts/api-server/src/features/assistant-workspace/orchestrator.test.ts

**Interfaces:** Produces createToolRegistry(definitions): ToolRegistry and runTurn(context, model, tools, store): Promise<{status: string; text: string; receipts: ToolResult['receipts']}>. store loads turns/state/evidence and checkpoints provider items, tool-call results, budgets, and run state. Worker leases come from task 2.

- [ ] **1. Add the regression test below and its stated integration cases.** These are intended behavior tests, not assertions that a particular internal implementation exists.

```ts
import { it, expect } from "vitest";
import { selectBatchTargets } from "./orchestrator";
it("narrows a batch without changing unrelated customers", () => {
 expect(selectBatchTargets(["shoshone", "cascades"], ["shoshone"]))
  .toEqual(["shoshone"]);
 expect(() => selectBatchTargets(["shoshone"], ["unread-profile"]))
  .toThrow("ASSISTANT_TARGET_NOT_IN_BATCH");
});
```

- [ ] **2. Run the targeted test to establish the failure.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/orchestrator.test.ts
```

Expected initially: failure because the new behavior is absent. If a test fails for configuration/import setup unrelated to the behavior, repair the test harness first; do not count that as a reproduced behavioral failure.

- [ ] **3. Implement the contract and behavior.**

Define the pure scope helper:
```ts
export function selectBatchTargets(current: string[], selected: string[]) {
 const allowed = new Set(current);
 if (selected.some(id => !allowed.has(id)))
   throw new Error("ASSISTANT_TARGET_NOT_IN_BATCH");
 return [...new Set(selected)];
}
```
The turn algorithm is: verify conversation ownership; persist the direct user message once; load prior messages, summary, task selection and authorized rules; request model next(); persist complete provider items; validate and execute each tool call; persist tool result paired to its call ID; then request the next model step. Stop on final response, cancellation, blocked user decision, or budget limit. Never rerun a succeeded tool call when resuming its checkpoint.
Keep recent full messages plus a structured summary of older turns; include corrections, unresolved questions, frozen batch membership, and source IDs. Summaries are context, never authorization. Cap context using provider usage and bounded retrieval; retain originals for on-demand lookup.
Only read tools may run concurrently. Serialize mutations. Before each mutation, recheck cancellation, lease, grants, target revision, and account identity. The tool registry rejects unknown tool names and extra argument fields. A model final response cannot create a completed action badge; only verified receipts can.
Add integration tests using a scripted ModelPort for follow-up pronouns, scoped batch changes, preserved tool-result IDs, no fabricated completion, malicious tool-result instructions, exhausted budgets, and process restart after one tool completes. Send cancellation to the provider but retain uncertain external actions for reconciliation. Do not expose raw chain-of-thought; show tool progress only.

- [ ] **4. Run the targeted test again, then the related module tests.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/orchestrator.test.ts
```

Expected: all targeted cases pass. Include any new colocated tests introduced by this task in the same run. Resolve concrete regressions before moving forward.

- [ ] **5. Commit only this task's implementation and test files.**

Review `git diff --check` and `git diff --stat`, stage the listed paths and their tests, then:

```bash
git commit -m "feat(assistant): orchestrate persistent multi-step work"
```


### Task 8: Branded Gmail drafts with revision-safe editing

**Files:**
- Create: artifacts/api-server/src/features/assistant-workspace/draft-tools.ts
- Modify: artifacts/api-server/src/features/office/office-design-email-service.ts
- Modify: artifacts/api-server/src/features/office/office-gmail-provider.ts
- Modify: artifacts/api-server/src/features/google-workspace/google-api-client.ts
- Modify: artifacts/api-server/src/features/google-workspace/google-gmail-delivery-client.ts
- Reference: artifacts/api-server/src/features/office/design-email-renderer.ts
- Test: artifacts/api-server/src/features/assistant-workspace/draft-tools.test.ts

**Interfaces:** Produces DraftContent {to:string[], cc:string[], subject:string, html:string, threadId:string|null, attachmentHashes:string[]} and draftFingerprint(content): string; prepare_draft/update_draft tools return canonical draft ID, revision, Gmail IDs and readback receipt. Revisions cover every send-affecting field.

- [ ] **1. Add the regression test below and its stated integration cases.** These are intended behavior tests, not assertions that a particular internal implementation exists.

```ts
import { it, expect } from "vitest";
import { draftFingerprint } from "./draft-tools";
it("invalidates prior send approval when an attachment changes", () => {
 const content = {to:["contact@example.test"], cc:[], subject:"Reply",
  html:"<p>Hello</p>", threadId:"t1", attachmentHashes:["old"]};
 expect(draftFingerprint(content)).not.toBe(
  draftFingerprint({...content, attachmentHashes:["new"]})
 );
});
```

- [ ] **2. Run the targeted test to establish the failure.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/draft-tools.test.ts
```

Expected initially: failure because the new behavior is absent. If a test fails for configuration/import setup unrelated to the behavior, repair the test harness first; do not count that as a reproduced behavioral failure.

- [ ] **3. Implement the contract and behavior.**

Fingerprint normalized content deterministically:
```ts
import { createHash } from "node:crypto";
export function draftFingerprint(content: DraftContent) {
 return createHash("sha256").update(JSON.stringify({
  to: content.to, cc: content.cc, subject: content.subject,
  html: content.html, threadId: content.threadId,
  attachmentHashes: content.attachmentHashes
 })).digest("hex");
}
```
Use the current approved template catalog; choose compact reply or outreach layout by the user's task. Preserve editable message content separately from frozen template version. Link current approved package/foam pages through template data; fail a required missing link instead of inventing one.
Extend MIME construction and Gmail ports to carry HTML/plain alternatives, attachments, In-Reply-To, References, and threadId. Preserve recipients and attachments for “make it warmer.” Do not silently create a new thread when a reply thread is missing. Keep app and Gmail draft IDs paired; check the current Gmail version before overwriting manual edits.
Reject CR/LF header injection; sanitize HTML and render preview in a sandboxed frame without scripts or same-origin privilege. Add Gmail readback support so a returned draft ID alone is not content verification. Unknown save outcomes reconcile Drafts before creating another draft. Test two-tab version conflict, manual Gmail edit, reply threading, attachment preservation, missing template asset, and a formatting change leaving financial terms unchanged.

- [ ] **4. Run the targeted test again, then the related module tests.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/draft-tools.test.ts
```

Expected: all targeted cases pass. Include any new colocated tests introduced by this task in the same run. Resolve concrete regressions before moving forward.

- [ ] **5. Commit only this task's implementation and test files.**

Review `git diff --check` and `git diff --stat`, stage the listed paths and their tests, then:

```bash
git commit -m "feat(assistant): prepare and revise branded Gmail drafts"
```


### Task 9: Profile, document-link, label, and follow-up actions

**Files:**
- Create: artifacts/api-server/src/features/assistant-workspace/record-tools.ts
- Reference: artifacts/api-server/src/features/office/office-profile-editor.ts
- Reference: artifacts/api-server/src/features/follow-ups/follow-up-service.ts
- Reference: artifacts/api-server/src/features/business-documents/business-document-service.ts
- Reference: artifacts/api-server/src/features/google-workspace/google-review-profile-assignment-service.ts
- Reference: artifacts/api-server/src/features/google-workspace/google-profile-label-sync-service.ts
- Test: artifacts/api-server/src/features/assistant-workspace/record-tools.test.ts

**Interfaces:** Produces mutationAllowed(grants, actionKind, targetId): boolean, and tools update_profile, add_profile_note, link_document, assign_profile_label, create_followup, update_followup. Each consumes ActionIntent and expected revision; results include before/after values and readback receipts. Grants are task 1 server records.

- [ ] **1. Add the regression test below and its stated integration cases.** These are intended behavior tests, not assertions that a particular internal implementation exists.

```ts
import { it, expect } from "vitest";
import { mutationAllowed } from "./record-tools";
it("does not turn a new reminder request into permission to reschedule old ones", () => {
 const grants = [{actorId:"owner",sourceMessageId:"u1",
  actionKind:"create_followup",targetIds:["profile-a"],
  revision:null,connectionId:null}];
 expect(mutationAllowed(grants, "update_followup", "old-reminder")).toBe(false);
 expect(mutationAllowed(grants, "create_followup", "profile-a")).toBe(true);
});
```

- [ ] **2. Run the targeted test to establish the failure.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/record-tools.test.ts
```

Expected initially: failure because the new behavior is absent. If a test fails for configuration/import setup unrelated to the behavior, repair the test harness first; do not count that as a reproduced behavioral failure.

- [ ] **3. Implement the contract and behavior.**

Implement exact action/target matching:
```ts
export function mutationAllowed(grants: Grant[], kind: string, targetId: string) {
 return grants.some(g => g.actionKind === kind && g.targetIds.includes(targetId));
}
```
Translate clearly requested actions from direct user messages into a validated scoped intent; save the source message ID and resolved target identity. Ambiguous targets produce a question, not a broad grant. Apply allowlisted profile fields through existing validation, preserve history, and never directly set paid/signed/confirmed based only on model inference.
Use BusinessDocumentService.addLink after checking both document and profile access. Use the existing profile-assignment/label-sync workflow to preserve app/Gmail consistency and Inbox handling; ignored messages stay in Inbox. Reuse existing labels and do not resurrect z-adventurezone.
Use FollowUpService.create with verified IDs and an actual Date. Store assistant action IDs in a mapping table for replay without duplicating reminders. Updates require a grant targeting the existing follow-up ID and a version check. Preserve user-scheduled reminders even when other campaign reminders exist.
Tests cover only-selected-profile writes, inferred financial status rejection, duplicate action replay, deleted/merged profile between read and write, duplicate Gmail label prevention, partial label-sync failure, and follow-up preservation. All successful actions read back persisted state before producing completion receipts.

- [ ] **4. Run the targeted test again, then the related module tests.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/record-tools.test.ts
```

Expected: all targeted cases pass. Include any new colocated tests introduced by this task in the same run. Resolve concrete regressions before moving forward.

- [ ] **5. Commit only this task's implementation and test files.**

Review `git diff --check` and `git diff --stat`, stage the listed paths and their tests, then:

```bash
git commit -m "feat(assistant): execute scoped profile and reminder updates"
```


### Task 10: Timed calendar actions and resource checks

**Files:**
- Create: artifacts/api-server/src/features/assistant-workspace/calendar-tools.ts
- Create: artifacts/api-server/src/features/google-workspace/calendar/assistant-timed-calendar-client.ts
- Reference: artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-client.ts
- Reference: artifacts/api-server/src/features/lead-intake/lead-availability-service.ts
- Test: artifacts/api-server/src/features/assistant-workspace/calendar-tools.test.ts

**Interfaces:** Produces TimedEvent {calendarId, summary, startsAt, endsAt, timeZone, organizationId, bookingId}, and validateTimedEvent(event): void. startsAt/endsAt are RFC3339 values with explicit offsets; timeZone is IANA. create_calendar_event and update_calendar_event take the exact target/calendar grant and expected ETag for updates.

- [ ] **1. Add the regression test below and its stated integration cases.** These are intended behavior tests, not assertions that a particular internal implementation exists.

```ts
import { it, expect } from "vitest";
import { validateTimedEvent } from "./calendar-tools";
it("rejects a DST gap rather than shifting the meeting", () => {
 expect(() => validateTimedEvent({
  calendarId:"calendar",summary:"Meeting",
  startsAt:"2027-03-14T02:30:00-07:00",
  endsAt:"2027-03-14T03:30:00-06:00",
  timeZone:"America/Denver",organizationId:"profile-a",bookingId:null
 })).toThrow("CALENDAR_LOCAL_TIME_MISMATCH");
});
```

- [ ] **2. Run the targeted test to establish the failure.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/calendar-tools.test.ts
```

Expected initially: failure because the new behavior is absent. If a test fails for configuration/import setup unrelated to the behavior, repair the test harness first; do not count that as a reproduced behavioral failure.

- [ ] **3. Implement the contract and behavior.**

Validate offset timestamps, end after start, and IANA zone. Round-trip each timestamp through Intl.DateTimeFormat with year/month/day/hour/minute/second in the supplied zone; its local components must match the submitted timestamp. Reject DST gaps and local-only timestamps; ambiguous autumn times need an explicit offset.
```ts
const zoneParts = new Intl.DateTimeFormat("en-CA", {
 timeZone: event.timeZone, year:"numeric", month:"2-digit", day:"2-digit",
 hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23"
}).formatToParts(new Date(event.startsAt));
```
Build timed Google bodies with dateTime/timeZone and all-day bodies with date/exclusive-end separately. Never reuse the all-day parser for meetings. Default attendees to empty and sendUpdates to none; inviting external people needs explicit authorization.
Generate a deterministic Google-compatible event ID from the action UUID; create conflict (409) triggers readback and comparison rather than another event. Use ETag/If-Match for updates and compare account/calendar identity after reconnect. Query availability and shared resources before representing dates as available. Calendar entries alone must not mark bookings confirmed. A Dave handoff creates one event with all packages.
Test all-day exclusive end, a normal Central/Mountain conversion, both DST folds, partial Google outage, create replay, ETag conflict, paintball/foam resource conflicts, and preserving a potential booking status.

- [ ] **4. Run the targeted test again, then the related module tests.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/calendar-tools.test.ts
```

Expected: all targeted cases pass. Include any new colocated tests introduced by this task in the same run. Resolve concrete regressions before moving forward.

- [ ] **5. Commit only this task's implementation and test files.**

Review `git diff --check` and `git diff --stat`, stage the listed paths and their tests, then:

```bash
git commit -m "feat(assistant): preserve meeting times and calendar identity"
```


### Task 11: Explicit sending and post-send synchronization

**Files:**
- Create: artifacts/api-server/src/features/assistant-workspace/send-tools.ts
- Reference: artifacts/api-server/src/features/outreach-planner/outreach-dispatch.ts
- Reference: artifacts/api-server/src/features/outreach-planner/production-outreach-dispatch.ts
- Reference: artifacts/api-server/src/features/office/office-email-send-coordinator.ts
- Reference: artifacts/api-server/src/features/early-bird-promo/early-bird-promo-service.ts
- Modify: artifacts/api-server/src/features/office/office-design-email-service.ts
- Test: artifacts/api-server/src/features/assistant-workspace/send-tools.test.ts

**Interfaces:** Produces assertSendRevision(approved, current), and send_draft(context, {actionId, draftId, revision}): Promise<ToolResult>. Reconciliation has separate delivery and CRM-tracking states. A send grant originates from a direct user send instruction or explicit UI command bound to the prepared action/revision.

- [ ] **1. Add the regression test below and its stated integration cases.** These are intended behavior tests, not assertions that a particular internal implementation exists.

```ts
import { it, expect } from "vitest";
import { assertSendRevision } from "./send-tools";
it("requires the exact approved content revision", () => {
 expect(() => assertSendRevision("revision-1", "revision-2"))
  .toThrow("ASSISTANT_SEND_REVISION_CHANGED");
});
```

- [ ] **2. Run the targeted test to establish the failure.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/send-tools.test.ts
```

Expected initially: failure because the new behavior is absent. If a test fails for configuration/import setup unrelated to the behavior, repair the test harness first; do not count that as a reproduced behavioral failure.

- [ ] **3. Implement the contract and behavior.**

Use the revision check at claim time and immediately before provider invocation:
```ts
export function assertSendRevision(approved: string, current: string) {
 if (!approved || approved !== current)
  throw new Error("ASSISTANT_SEND_REVISION_CHANGED");
}
```
Require the dispatch safety path for assistant sends even if a legacy caller treats it as optional. Check communication blocks, prior outreach, recipient identity, full attachments, payment model, current terms, dates, and source freshness. A material conflict stops finalization and send; an unfinished draft may remain clearly labeled.
Prepare any send-date-dependent promotional text before computing the approved fingerprint. If that changes materially after approval, prepare a new revision; never silently send revised terms under old approval.
Persist a stable Message-ID and the exact MIME payload before dispatch. On uncertain outcome inspect Gmail Sent/Drafts using provider IDs and the stored Message-ID; no result is still uncertain, not proof of non-delivery. Do not claim exactly-once Gmail delivery. Block blind automatic resends.
After confirmed send, record actual send time; invoke the existing promotion service for eligible offers, synchronize profile activity, documents, labels, and appropriate follow-up. Failed tracking remains a repair job attached to the confirmed message and cannot reopen delivery.
Test concurrent send clicks, changed attachments/recipient, Gmail reconnect, send timeout, provider success plus DB failure, tracking retry with exactly one provider invocation, ineligible pay-per-play promotion, and 30-day dates derived from confirmed send rather than draft creation. Preserve old manual follow-ups.

- [ ] **4. Run the targeted test again, then the related module tests.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/send-tools.test.ts
```

Expected: all targeted cases pass. Include any new colocated tests introduced by this task in the same run. Resolve concrete regressions before moving forward.

- [ ] **5. Commit only this task's implementation and test files.**

Review `git diff --check` and `git diff --stat`, stage the listed paths and their tests, then:

```bash
git commit -m "feat(assistant): send approved drafts with safe reconciliation"
```


### Task 12: Owned API endpoints and streaming progress

**Files:**
- Create: artifacts/api-server/src/routes/assistant-workspace.ts
- Modify: artifacts/api-server/src/routes/index.ts
- Create: artifacts/api-server/src/features/assistant-workspace/http-schema.ts
- Test: artifacts/api-server/src/routes/assistant-workspace.test.ts

**Interfaces:** Produces POST /assistant/workspace/conversations; GET /assistant/workspace/conversations and /:id; POST /:id/messages; GET /runs/:id; GET /runs/:id/events?after=sequence; POST /runs/:id/cancel; POST /actions/:id/execute. Every endpoint checks feature flag and server identity before reading data or invoking providers.

- [ ] **1. Add the regression test below and its stated integration cases.** These are intended behavior tests, not assertions that a particular internal implementation exists.

```ts
import { it, expect } from "vitest";
import { messageInput } from "@/features/assistant-workspace/http-schema";
it("rejects actor spoofing at the HTTP boundary", () => {
 expect(messageInput.safeParse({
  requestKey:"message-1", text:"Review this",
  actorId:"another-owner"
 }).success).toBe(false);
});
```

- [ ] **2. Run the targeted test to establish the failure.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/assistant-workspace.test.ts
```

Expected initially: failure because the new behavior is absent. If a test fails for configuration/import setup unrelated to the behavior, repair the test harness first; do not count that as a reproduced behavioral failure.

- [ ] **3. Implement the contract and behavior.**

Use strict schemas, for example:
```ts
export const messageInput = z.object({
 requestKey: z.string().min(1).max(128),
 text: z.string().trim().min(1).max(20000)
}).strict();
```
POST message returns 202 with a durable run ID. Use monotonic persisted event sequence numbers for progress; SSE reconnect replays events after the last seen sequence. Authenticate streaming with existing secure request mechanisms; never put tokens in URLs. Model text streams as draft text; final status comes from the persisted run.
Mount the router with an explicit requireOwnerMiddleware boundary and per-actor allowlist. Do not rely on incidental route ordering. Scope each get/update by actor ID. Rate-limit per actor and allow only one active mutation-bearing run per conversation; concurrent messages queue or return conflict.
POST execute accepts actionId in path, revision and requestKey only, and records the direct UI authorization. Return 404 for inaccessible records, 409 for changed state/connection, 422 for invalid input, 429 for limits, and safe 503 for unavailable provider. Test identity denial before model invocation, SSE reconnect, duplicate request handling, invalid tool data, cancellation, and API disabled behavior.

- [ ] **4. Run the targeted test again, then the related module tests.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/assistant-workspace.test.ts
```

Expected: all targeted cases pass. Include any new colocated tests introduced by this task in the same run. Resolve concrete regressions before moving forward.

- [ ] **5. Commit only this task's implementation and test files.**

Review `git diff --check` and `git diff --stat`, stage the listed paths and their tests, then:

```bash
git commit -m "feat(assistant): expose owned workspace and progress API"
```


### Task 13: Persistent workspace, draft preview, and editable knowledge

**Files:**
- Create: artifacts/adventure-zone/src/pages/AssistantWorkspacePage.tsx
- Create: artifacts/adventure-zone/src/features/assistant-workspace/api.ts
- Create: artifacts/adventure-zone/src/features/assistant-workspace/types.ts
- Create: artifacts/adventure-zone/src/components/assistant-workspace/ConversationPanel.tsx
- Create: artifacts/adventure-zone/src/components/assistant-workspace/DraftPreview.tsx
- Create: artifacts/adventure-zone/src/components/assistant-workspace/ActionResults.tsx
- Create: artifacts/adventure-zone/src/components/assistant-workspace/KnowledgePanel.tsx
- Modify: artifacts/adventure-zone/src/App.tsx
- Modify: artifacts/adventure-zone/src/components/assistant/assistant-drawer.tsx
- Modify: artifacts/api-server/src/routes/assistant-workspace.ts
- Test: artifacts/adventure-zone/src/components/assistant-workspace/ActionResults.test.tsx

**Interfaces:** Produces /assistant/workspace/:conversationId? owner route, shared API client with persisted run tracking, and compact drawer links that carry conversation ID. Knowledge endpoints list/propose/approve revisions using task 4 ownership and version checks. UI actions never directly alter authorization grants.

- [ ] **1. Add the regression test below and its stated integration cases.** These are intended behavior tests, not assertions that a particular internal implementation exists.

```ts
import { it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActionResults } from "./ActionResults";
it("shows partial completion instead of claiming everything is done", () => {
 render(<ActionResults items={[
  {id:"a1",label:"Email",status:"succeeded",href:"/email/1"},
  {id:"a2",label:"Profile update",status:"failed",href:null}
 ]}/>);
 expect(screen.getByText("Profile update")).toBeTruthy();
 expect(screen.getByText("Failed")).toBeTruthy();
 expect(screen.queryByText("Everything completed")).toBeNull();
});
```

- [ ] **2. Run the targeted test to establish the failure.**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run --config vitest.config.ts src/components/assistant-workspace/ActionResults.test.tsx
```

Expected initially: failure because the new behavior is absent. If a test fails for configuration/import setup unrelated to the behavior, repair the test harness first; do not count that as a reproduced behavioral failure.

- [ ] **3. Implement the contract and behavior.**

Use task 12 API as the source of truth. A page navigation updates visible context but does not silently replace the active conversation selection; switching the target is an explicit action. Reopening a conversation restores messages, batch, draft, and pending actions. A disconnected SSE stream reconnects; it never resubmits a mutation.
DraftPreview shows actual recipients, subject, thread, attachments, approved template version, and editable message content; iframe sandbox excludes scripts/same-origin permissions. Editing marks a new revision. ActionResults renders independent persisted outcomes and authenticated links; uncertain sends have “Check delivery” rather than “Send again.”
```tsx
const statusLabel = {
 queued: "Queued", running: "Working", succeeded: "Completed",
 partial: "Partly completed", blocked: "Needs information",
 uncertain: "Checking result", failed: "Failed", cancelled: "Stopped"
};
```
KnowledgePanel shows source, applicability, last review, and superseded versions; owners can propose/approve corrections with conflict checking. Add model selection among server-validated configurations, show setup/connection problems clearly, and provide usage totals without fabricated cost estimates.
Test mobile layout and keyboard controls; drawer-to-workspace continuity; refresh recovery; “make it warmer” draft preservation; knowledge version conflict; partial results; sanitized previews; and no send from Enter in the chat composer. Include accessible Stop control and progress announcements.

- [ ] **4. Run the targeted test again, then the related module tests.**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run --config vitest.config.ts src/components/assistant-workspace/ActionResults.test.tsx
```

Expected: all targeted cases pass. Include any new colocated tests introduced by this task in the same run. Resolve concrete regressions before moving forward.

- [ ] **5. Commit only this task's implementation and test files.**

Review `git diff --check` and `git diff --stat`, stage the listed paths and their tests, then:

```bash
git commit -m "feat(assistant): add persistent conversation workspace"
```


### Task 14: Workflow acceptance, feature-flag rollout, and full-scope ledger

**Files:**
- Create: artifacts/api-server/src/features/assistant-workspace/workflow-acceptance.test.ts
- Create: artifacts/adventure-zone/src/pages/AssistantWorkspacePage.test.tsx
- Create: docs/assistant-workspace-release.md
- Create: docs/superpowers/plans/2026-09-24-assistant-upgrade-delivery-ledger.md
- Test: artifacts/api-server/src/features/assistant-workspace/workflow-acceptance.test.ts

**Interfaces:** Consumes all prior tasks. Produces a release checklist with test evidence, deployed SHA when deployed, configuration/scopes verification, measured model usage, and explicit phase completion states. No synthetic test may claim a real customer record was updated.

- [ ] **1. Add the regression test below and its stated integration cases.** These are intended behavior tests, not assertions that a particular internal implementation exists.

```ts
import { it, expect } from "vitest";
import { summarizeReceipts } from "./orchestrator";
it("reports only verified saved results", () => {
 const summary = summarizeReceipts([
  {status:"ok",data:null,evidence:[],code:null,
   receipts:[{kind:"draft",id:"d1",href:"/drafts/d1",verifiedAt:"2026-09-24T12:00:00Z"}]},
  {status:"failed",data:null,evidence:[],receipts:[],code:"PROFILE_WRITE_FAILED"}
 ]);
 expect(summary.completedIds).toEqual(["d1"]);
 expect(summary.partial).toBe(true);
});
```

- [ ] **2. Run the targeted test to establish the failure.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/workflow-acceptance.test.ts
```

Expected initially: failure because the new behavior is absent. If a test fails for configuration/import setup unrelated to the behavior, repair the test harness first; do not count that as a reproduced behavioral failure.

- [ ] **3. Implement the contract and behavior.**

Add summarizeReceipts(results: ToolResult[]) with this contract:
```ts
export function summarizeReceipts(results: ToolResult[]) {
 return {
  completedIds: results.flatMap(r => r.receipts.map(x => x.id)),
  partial: results.some(r => r.status !== "ok")
 };
}
```
Exercise a scripted model and fake Google providers through the HTTP/UI flow: read email and attachment; detect stale historical terms; revise a compact HTML reply; update selected profile; create COI reminder; reconnect and continue. Include “just Shoshone,” “make it warmer,” unfinished batch resume, wrong event year, no prepaid terms on pay-per-play, unreadable attachment, and source injection.
Run targeted unit/integration tests, API/UI typechecks, and both production builds. Broaden testing only for affected existing Gmail, draft, promotion, calendar, migration, and follow-up contracts. Record actual commands/results. Check routes/auth against the built server, not mocks alone.
Release initially disabled. Verify migration readiness, selected model tool support, feature allowlist, account ownership and OAuth scopes. Conduct a controlled draft-save/readback test in an authorized test profile, plus synthetic reminders/calendar records that are clearly marked test records. No real customer send. Inspect the rendered draft and mobile conversation flow.
Enable for Desiree only after acceptance; keep legacy assistant available. Rollback disables the feature and new claims, leaves action ledger intact, and reconciles any in-flight external writes before switching UI. Confirm deployed SHA and readiness before saying live.
The delivery ledger records all four approved stages with evidence links. Stage 1 passing does not check off document generation, campaign research, or operations.

- [ ] **4. Run the targeted test again, then the related module tests.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace/workflow-acceptance.test.ts
```

Expected: all targeted cases pass. Include any new colocated tests introduced by this task in the same run. Resolve concrete regressions before moving forward.

- [ ] **5. Commit only this task's implementation and test files.**

Review `git diff --check` and `git diff --stat`, stage the listed paths and their tests, then:

```bash
git commit -m "test(assistant): verify end-to-end workflow and rollout"
```

## Stage 1 final verification commands

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/assistant-workspace src/routes/assistant-workspace.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run --config vitest.config.ts src/components/assistant-workspace src/pages/AssistantWorkspacePage.test.tsx
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/adventure-zone run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/adventure-zone run build
```

Run affected legacy tests named by the actual diff. If runtime dependencies prevent a check, record the command and blocker; do not mark it passed. Verify SQL against a real Postgres-compatible test database, especially concurrency/row-lock tests; PGlite-only results are insufficient for worker concurrency.

## Approved full-scope continuation

The following remain committed scope, not optional suggestions. Separate specifications and implementation plans follow the stage-1 interfaces, as required by the approved design.

| Stage | Deliverable | Completion evidence |
| --- | --- | --- |
| 2A | Generate proposals, contracts, and invoices from current approved templates using verified event terms | Document preview, arithmetic/deposit checks, correct event/year linkage, reviewable output |
| 2B | Compare document versions, identify signed replacements, reconcile invoice/payment history | Historical balances excluded from current actionable totals; originals retained; no invented signed/paid status |
| 3A | Resume lead batches, research source-backed dates and contacts, check route/resource fit and duplicate outreach | “Next batch” resumes saved membership; confirmed/expected dates remain distinct; unsuitable leads explained |
| 3B | Prepare personalized campaign drafts, preserve approved HTML/promo/foam links, synchronize actual sends and reminders | Selected-customer-only edits; correct deadlines from confirmed send; no modifications to unrelated reminders |
| 4A | Read route, shared equipment, inspection/photo, and operations context | Sourced answers respect legs/resources and identify missing evidence |
| 4B | Scoped office/Dave/manager handoffs and persistent shared work items | Explicit access tests; simple Dave view; one event containing all packages; no private conversation leakage |

Stage 2 must inspect the actual approved templates and document-generation services before generating contracts. Stage 3 must reuse lead scout/date coverage/communication block services and preserve Last Resort per-leg restrictions; an existing kids zone does not establish that Adventure Zone can join. Stage 4 must inspect role-specific routes before enabling staff tools. Do not automatically grant every role the owner tool registry.

## Spec-to-task coverage

| Spec requirement | Tasks |
| --- | --- |
| Conversations, resumable batches, selection and corrections | 1, 2, 7, 12, 13 |
| Configurable model, streaming and usage bounds | 3, 7, 12, 13 |
| Current rules, exceptions, provenance and editable knowledge | 4, 13 |
| Full Gmail history, attachments, templates and records | 5, 6 |
| Evidence conflicts and no invented commitments | 4–7, 11, 14 |
| HTML drafts, recipients, attachments and manual edits | 8, 13 |
| Authorized profile/document/label/follow-up changes | 2, 3, 9 |
| Calendar times, availability, buffers and resource checks | 5, 10 |
| Explicit sends, idempotency and partial failure repair | 2, 8, 11 |
| Permission isolation and hostile source content | 3, 5–7, 12, 14 |
| Mobile UI, source/result links and honest completion | 12–14 |
| Migration readiness, feature flag, rollback and deployment proof | 1–3, 14 |
| Document generation, advanced lead/campaign and staff operations | Continuation stages 2–4 above; not represented as shipped by stage 1 |

## Planning self-review

Checked: full approved scope retained; stage-1 spec requirements assigned; source-specific exceptions not generalized; UI/API contracts and task numbering reconciled; five review-focus cases assigned; no invented current model, price, live provider setting, or deployment result. Interface snippets are proposed implementation contracts, not existing code claims.

Business inputs needing verification during execution are explicit behavior, not silent defaults: Pirate's space requirement, customer split direction, exact renewal day, latest template URLs, and available API model. A missing fact blocks only the affected finalization; it does not block unrelated implementation.

## Execution handoff

Recommended method: Native execution in this session, following executing-plans, with a fresh whole-branch review before release. This keeps the closely related conversation/tool/action interfaces together. Subagent-driven execution is also supported if the user prefers independent task-by-task implementation and review.

The writing-plans workflow requires the user to review this plan and select Native or Subagent-driven execution before product-code implementation. The design and full feature scope are already approved; do not ask the user to approve those again.
