# Booking Assistant History and Cost Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent, reopenable Booking Assistant history for chats, audits, and Lead Scout research while routing AI work through the cheapest adequate execution path without adding model cost for save/reopen/history operations.

**Architecture:** Reuse `assistant_conversations`, `assistant_jobs`, and Lead Scout run storage as authoritative records and add a server-side History aggregator rather than duplicating result data. General-mode chats gain persistence using the existing conversation/message tables with a reserved general context key. A centralized cost-policy module maps capability/work class to deterministic execution, a configured low-cost model, a stronger configured model, or web research, while bounded-context helpers prevent old chats from growing every request indefinitely.

**Tech Stack:** TypeScript, Express, React, PostgreSQL, Vitest, existing OpenAI Responses adapters, existing Assistant/Lead Scout repositories and drawer UI.

**Spec:** `docs/superpowers/specs/2026-08-21-assistant-history-cost-routing-design.md`

## Global Constraints

- Saving, listing, reopening, filtering, and viewing History must make zero AI/model calls.
- Reopening an audit or Lead Scout item loads persisted state and must not rerun research merely to render it.
- Closing the Booking Assistant drawer never cancels a background job.
- Reopened chats continue the same persisted conversation ID.
- The full transcript remains visible to the user, but model input is bounded to recent/relevant context.
- Deterministic/database execution always takes precedence when it can answer correctly.
- Simple AI work uses a centrally configured low-cost model; stronger models are escalation-only.
- Web search is separately metered and may only run for capabilities explicitly permitted to escalate to research.
- Provider/model IDs are configuration values, not scattered business-logic constants.
- History is actor-scoped and must not expose another user's conversations/jobs/runs.
- No History or cost-routing feature may weaken the existing explicit-approval requirement for CRM mutations.
- Phase 1 does not add a second AI provider account or dependency; it only preserves a provider interface boundary.

---

### Task 1: Persist General Command Center conversations

**Files:**
- Modify: `artifacts/api-server/src/features/assistant/assistant-types.ts`
- Modify: `artifacts/api-server/src/features/assistant/assistant-conversation-repository.ts`
- Create: `artifacts/api-server/src/features/assistant/general-conversation-service.ts`
- Create: `artifacts/api-server/src/features/assistant/general-conversation-service.test.ts`
- Modify: `artifacts/api-server/src/routes/assistant.ts`

**Interfaces:**
- Consumes: `AssistantConversationRepository.ensureConversation`, `appendExchange`, `getConversation`.
- Produces:

```ts
export const GENERAL_ASSISTANT_CONTEXT_KIND = "organization" as const;
export const GENERAL_ASSISTANT_CONTEXT_RECORD_ID = "00000000-0000-0000-0000-000000000000";

export type GeneralConversationAskResult = {
  conversationId: string;
  response: GeneralAssistantResponse;
};

export class GeneralConversationService {
  ask(input: {
    actorId: string;
    conversationId?: string;
    question: string;
  }): Promise<GeneralConversationAskResult>;
  get(input: { actorId: string; conversationId: string }): Promise<AssistantConversationView | null>;
}
```

Use the reserved nil UUID only as the persisted general-context key. It must never be resolved as an actual CRM organization.

- [ ] **Step 1: Write failing persistence tests**

Create `general-conversation-service.test.ts` with cases proving:

```ts
it("creates and continues one general conversation without losing earlier messages", async () => {
  const first = await service.ask({ actorId: "owner-1", question: "Find profiles in Minnesota" });
  const second = await service.ask({
    actorId: "owner-1",
    conversationId: first.conversationId,
    question: "Only show county fairs",
  });
  expect(second.conversationId).toBe(first.conversationId);
  expect((await service.get({ actorId: "owner-1", conversationId: first.conversationId }))?.messages)
    .toHaveLength(4);
});

it("does not allow another actor to continue the conversation", async () => {
  const first = await service.ask({ actorId: "owner-1", question: "Find a profile" });
  await expect(service.ask({
    actorId: "owner-2",
    conversationId: first.conversationId,
    question: "continue",
  })).rejects.toThrow("ASSISTANT_CONVERSATION_NOT_FOUND");
});
```

Use injected deterministic `answerGeneral` and repository doubles so this test proves persistence behavior without a model call.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/general-conversation-service.test.ts
```

Expected: FAIL because `GeneralConversationService` does not exist.

- [ ] **Step 3: Extend conversation persistence for general responses**

Add a repository method that can append a general exchange even when the result is not an `AssistantAnswer`:

```ts
async appendPlainExchange(input: {
  conversationId: string;
  actorId: string;
  question: string;
  answerText: string;
}): Promise<void>
```

Persist the assistant response with `answer_mode='deterministic'`, `confidence='high'`, and no sources. Keep the existing `appendExchange` untouched for context-aware Assistant answers.

- [ ] **Step 4: Implement `GeneralConversationService`**

The service must:

```ts
const conversationId = await conversations.ensureConversation({
  conversationId: input.conversationId,
  actorId: input.actorId,
  contextKind: GENERAL_ASSISTANT_CONTEXT_KIND,
  contextRecordId: GENERAL_ASSISTANT_CONTEXT_RECORD_ID,
  firstQuestion: input.question,
});

const response = await answerGeneral(input.question);
await conversations.appendPlainExchange({
  conversationId,
  actorId: input.actorId,
  question: input.question,
  answerText: response.kind === "answer" ? response.answer.text : response.text,
});
return { conversationId, response };
```

Do not route website audits/Lead Scout through this service yet; those remain authoritative job/run objects and are linked in Task 3.

- [ ] **Step 5: Add general conversation routes**

Add:

```text
POST /assistant/general/conversations
GET  /assistant/general/conversations/:conversationId
POST /assistant/general/conversations/:conversationId/ask
```

`POST /assistant/general/conversations` body:

```ts
z.object({ question: z.string().trim().min(1).max(4000) }).strict()
```

Continue route uses the same schema. All reads/writes use `(req as any).userId` actor scoping.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm exec vitest run \
  artifacts/api-server/src/features/assistant/general-conversation-service.test.ts \
  artifacts/api-server/src/features/assistant/general-assistant.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/assistant artifacts/api-server/src/routes/assistant.ts
git commit -m "feat: persist general assistant conversations"
```

---

### Task 2: Build the unified History index

**Files:**
- Create: `artifacts/api-server/src/features/assistant/assistant-history-types.ts`
- Create: `artifacts/api-server/src/features/assistant/assistant-history-repository.ts`
- Create: `artifacts/api-server/src/features/assistant/assistant-history-repository.test.ts`
- Create: `artifacts/api-server/src/routes/assistant-history.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Interfaces:**

```ts
export type AssistantHistoryKind = "chat" | "audit" | "research";
export type AssistantHistoryStatus =
  | "active" | "running" | "stopped" | "complete" | "failed" | "needs_review";

export type AssistantHistoryItem = {
  id: string;
  kind: AssistantHistoryKind;
  title: string;
  subtitle: string | null;
  status: AssistantHistoryStatus;
  createdAt: string;
  updatedAt: string;
  summary: string | null;
  contextKind: string | null;
  contextRecordId: string | null;
  targetId: string;
};

export type AssistantHistoryPage = {
  items: AssistantHistoryItem[];
  nextCursor: string | null;
};

export class AssistantHistoryRepository {
  list(input: {
    actorId: string;
    kind?: AssistantHistoryKind;
    status?: AssistantHistoryStatus;
    cursor?: string;
    limit?: number;
  }): Promise<AssistantHistoryPage>;
}
```

- [ ] **Step 1: Write failing aggregation tests**

Test a fixture with one assistant conversation, one `assistant_jobs` row, and one Lead Scout run. Assert chronological ordering and mapped statuses:

```ts
expect(page.items.map((item) => item.kind)).toEqual(["audit", "research", "chat"]);
expect(page.items.find((item) => item.kind === "audit")?.status).toBe("needs_review");
```

A completed audit is `needs_review` when it has one or more `assistant_change_proposals.status='proposed'`; otherwise `complete`.

- [ ] **Step 2: Run test and verify RED**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/assistant-history-repository.test.ts
```

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement compact SQL projections**

Use `UNION ALL` over three compact projections. Do not fetch full messages/findings/candidates.

Conversation title uses stored `assistant_conversations.title`.

Audit summary format must be deterministic from `progress`, for example:

```ts
`${processed} / ${total} checked · ${broken} broken · ${proposedFixes} fixes`
```

Lead Scout summary uses persisted progress/candidate counts, not a model-generated summary.

- [ ] **Step 4: Implement deterministic title helper**

Add:

```ts
export function assistantHistoryTitle(input: string, fallback: string): string {
  const compact = input.replace(/\s+/g, " ").trim();
  if (!compact) return fallback;
  return compact.length <= 72 ? compact : `${compact.slice(0, 69).trimEnd()}…`;
}
```

Use this helper for job/run cards where a stored title is not already present. Do not call AI for titles.

- [ ] **Step 5: Add History route**

Add:

```text
GET /assistant/history?kind=&status=&cursor=&limit=
```

Zod rules:

```ts
kind: z.enum(["chat","audit","research"]).optional(),
status: z.enum(["active","running","stopped","complete","failed","needs_review"]).optional(),
limit: z.coerce.number().int().min(1).max(50).default(25),
cursor: z.string().max(200).optional(),
```

Mount after owner middleware, never under manager routes.

- [ ] **Step 6: Run tests**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/assistant-history-repository.test.ts
```

Expected: PASS, including actor isolation and filters.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/assistant/assistant-history-* artifacts/api-server/src/routes/assistant-history.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat: add unified assistant history index"
```

---

### Task 3: Link chats to durable audits/research without duplicating results

**Files:**
- Create: `lib/db/migrations/068_assistant_conversation_work_links.sql`
- Create: `artifacts/api-server/src/db/assistant-conversation-work-links-startup-migration.ts`
- Modify: `artifacts/api-server/src/db/act-review-startup.ts`
- Modify: `artifacts/api-server/src/features/assistant/general-conversation-service.ts`
- Modify: `artifacts/api-server/src/features/assistant/assistant-history-repository.ts`
- Create: `artifacts/api-server/src/features/assistant/assistant-conversation-work-links.test.ts`

**Interfaces:**

Migration:

```sql
create table if not exists assistant_conversation_work_links (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references assistant_conversations(id) on delete cascade,
  work_kind text not null check (work_kind in ('audit','research')),
  work_id uuid not null,
  created_at timestamptz not null default now(),
  unique(conversation_id, work_kind, work_id)
);
create index if not exists assistant_conversation_work_links_conversation_idx
  on assistant_conversation_work_links(conversation_id, created_at, id);
```

Repository/service method:

```ts
linkWork(input: {
  actorId: string;
  conversationId: string;
  workKind: "audit" | "research";
  workId: string;
}): Promise<void>;
```

- [ ] **Step 1: Write failing link tests**

Assert an audit launched from a general conversation creates one link and reopening the conversation can resolve the linked job ID without copying job results into messages.

- [ ] **Step 2: Run test and verify RED**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/assistant-conversation-work-links.test.ts
```

- [ ] **Step 3: Add migration/startup wiring**

Follow the existing `066`/`067` startup-migration pattern. Marker must check `to_regclass(current_schema() || '.assistant_conversation_work_links')`.

- [ ] **Step 4: Update general command flow**

When command routing starts an audit or Lead Scout run from a persisted general conversation:

```ts
await conversations.linkWork({
  actorId,
  conversationId,
  workKind: command.capability === "website_verification" ? "audit" : "research",
  workId: jobOrRunId,
});
```

Persist a short assistant message such as `Website audit started.`; do not serialize findings/candidates into the transcript.

- [ ] **Step 5: Expose linked-work IDs in conversation detail**

Extend `AssistantConversationView` with:

```ts
linkedWork: Array<{ kind: "audit" | "research"; id: string }>;
```

Actor ownership must be checked on the conversation before returning links.

- [ ] **Step 6: Run tests**

```bash
pnpm exec vitest run \
  artifacts/api-server/src/features/assistant/assistant-conversation-work-links.test.ts \
  artifacts/api-server/src/features/assistant/general-conversation-service.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add lib/db/migrations/068_assistant_conversation_work_links.sql artifacts/api-server/src/db artifacts/api-server/src/features/assistant
git commit -m "feat: link assistant chats to saved work"
```

---

### Task 4: Add bounded conversation context

**Files:**
- Create: `artifacts/api-server/src/features/assistant/assistant-bounded-context.ts`
- Create: `artifacts/api-server/src/features/assistant/assistant-bounded-context.test.ts`
- Modify: `artifacts/api-server/src/features/assistant/assistant-service.ts`
- Modify: model-backed general/research adapters only where conversation history is currently passed.

**Interfaces:**

```ts
export type BoundedConversationMessage = {
  role: "user" | "assistant";
  body: string;
};

export function buildBoundedConversationContext(input: {
  messages: BoundedConversationMessage[];
  maxMessages?: number;
  maxChars?: number;
}): BoundedConversationMessage[];
```

Defaults:

```ts
const DEFAULT_MAX_MESSAGES = 12;
const DEFAULT_MAX_CHARS = 12_000;
```

Selection algorithm: walk newest-to-oldest; stop when either cap would be exceeded; reverse selected messages back to chronological order. Always include the newest message, truncated to `maxChars` only when a single message exceeds the budget.

- [ ] **Step 1: Write failing bounded-context tests**

Cases:

```ts
expect(buildBoundedConversationContext({ messages: twentyShortMessages })).toHaveLength(12);
expect(totalChars(buildBoundedConversationContext({ messages: longMessages, maxChars: 1000 }))).toBeLessThanOrEqual(1000);
expect(result.at(-1)).toEqual(messages.at(-1));
```

- [ ] **Step 2: Run test and verify RED**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/assistant-bounded-context.test.ts
```

- [ ] **Step 3: Implement helper**

No token-estimation library is needed in phase 1; use a hard character budget so cost cannot grow unbounded.

- [ ] **Step 4: Wire model calls to bounded history**

When a persisted conversation is continued, load the full transcript for UI persistence but pass only `buildBoundedConversationContext(...)` into any cloud-model prompt construction. Deterministic profile search/audits must ignore transcript history unless their capability explicitly needs it.

- [ ] **Step 5: Add regression proving reopening is free**

Add a test where `getConversation()` and History detail are called while a provider mock throws if invoked. Both reads must succeed and provider call count must remain zero.

- [ ] **Step 6: Run tests**

```bash
pnpm exec vitest run \
  artifacts/api-server/src/features/assistant/assistant-bounded-context.test.ts \
  artifacts/api-server/src/features/assistant/assistant-conversation-work-links.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/assistant
git commit -m "feat: bound assistant conversation context"
```

---

### Task 5: Centralize AI cost routing and usage metadata

**Files:**
- Create: `artifacts/api-server/src/features/assistant/ai-execution-policy.ts`
- Create: `artifacts/api-server/src/features/assistant/ai-execution-policy.test.ts`
- Create: `artifacts/api-server/src/features/assistant/ai-usage-repository.ts`
- Create: `lib/db/migrations/069_assistant_ai_usage.sql`
- Create: `artifacts/api-server/src/db/assistant-ai-usage-startup-migration.ts`
- Modify: `artifacts/api-server/src/db/act-review-startup.ts`
- Modify: `artifacts/api-server/src/features/assistant/openai-lead-scout-provider.ts`
- Modify: `artifacts/api-server/src/features/profile-research/openai-profile-research-provider.ts`
- Modify: `artifacts/api-server/src/features/assistant/website-audit-replacement-provider.ts`

**Interfaces:**

```ts
export type AiWorkClass = "deterministic" | "simple_structured" | "reasoning" | "web_research";

export type AiExecutionPlan = {
  workClass: AiWorkClass;
  provider: "openai" | null;
  model: string | null;
  webSearch: boolean;
  reason: string;
};

export function resolveAiExecutionPlan(input: {
  capability: string;
  workClass: AiWorkClass;
}): AiExecutionPlan;
```

Environment variables:

```text
ASSISTANT_OPENAI_SIMPLE_MODEL=gpt-5-nano
ASSISTANT_OPENAI_REASONING_MODEL=gpt-5-mini
ASSISTANT_OPENAI_RESEARCH_MODEL=gpt-5-mini
```

Fallbacks are the values above. No premium model fallback.

Usage table:

```sql
create table if not exists assistant_ai_usage (
  id uuid primary key default gen_random_uuid(),
  actor_id text,
  capability text not null,
  provider text not null,
  model text not null,
  web_search_used boolean not null default false,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);
create index if not exists assistant_ai_usage_created_idx on assistant_ai_usage(created_at desc);
```

No prompt/body columns.

- [ ] **Step 1: Write failing policy tests**

```ts
expect(resolveAiExecutionPlan({ capability: "profile_search", workClass: "deterministic" }))
  .toMatchObject({ provider: null, model: null, webSearch: false });
expect(resolveAiExecutionPlan({ capability: "note_extract", workClass: "simple_structured" }).model)
  .toBe("gpt-5-nano");
expect(resolveAiExecutionPlan({ capability: "lead_scout", workClass: "web_research" }))
  .toMatchObject({ model: "gpt-5-mini", webSearch: true });
```

Use `vi.stubEnv` to prove model IDs are configurable.

- [ ] **Step 2: Run test and verify RED**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/ai-execution-policy.test.ts
```

- [ ] **Step 3: Implement explicit capability allowlists**

`web_research` must reject unknown capabilities instead of silently enabling search:

```ts
const WEB_RESEARCH_CAPABILITIES = new Set([
  "lead_scout",
  "profile_research",
  "website_replacement_research",
]);
```

If `workClass === "web_research"` and capability is not in the set, throw `AI_WEB_RESEARCH_NOT_ALLOWED`.

- [ ] **Step 4: Add usage persistence**

```ts
record(input: {
  actorId?: string | null;
  capability: string;
  plan: AiExecutionPlan;
  inputTokens?: number | null;
  outputTokens?: number | null;
}): Promise<void>;
```

Record only when `plan.provider !== null`. When Responses API returns usage fields, persist them; otherwise persist null token counts.

- [ ] **Step 5: Refactor provider adapters**

Replace direct defaults such as:

```ts
process.env.PROFILE_RESEARCH_OPENAI_MODEL || "gpt-5-mini"
```

with a plan passed/resolved for the specific capability. Web-search adapters must use `plan.webSearch === true` before adding the search tool.

- [ ] **Step 6: Prove healthy website audits make no model call**

Add a worker regression where HTTP inspection + deterministic matcher returns `verified_match`; assert replacement provider is never called and no usage record is written.

- [ ] **Step 7: Run tests**

```bash
pnpm exec vitest run \
  artifacts/api-server/src/features/assistant/ai-execution-policy.test.ts \
  artifacts/api-server/src/features/assistant/assistant-job-worker.test.ts \
  artifacts/api-server/src/features/assistant/openai-lead-scout-provider.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/features/assistant artifacts/api-server/src/features/profile-research artifacts/api-server/src/db lib/db/migrations/069_assistant_ai_usage.sql
git commit -m "feat: centralize assistant ai cost routing"
```

---

### Task 6: Build History/New Chat frontend and saved-work reopening

**Files:**
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-types.ts`
- Create: `artifacts/adventure-zone/src/features/assistant/assistant-history-api.ts`
- Create: `artifacts/adventure-zone/src/components/assistant/assistant-history.tsx`
- Create: `artifacts/adventure-zone/src/components/assistant/assistant-history.test.tsx`
- Create: `artifacts/adventure-zone/src/components/assistant/assistant-saved-chat.tsx`
- Modify: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.tsx`
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-api.ts`
- Test: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx`

**Interfaces:**

Client API:

```ts
export function listAssistantHistory(input?: {
  kind?: "chat" | "audit" | "research";
  status?: AssistantHistoryStatus;
  cursor?: string;
}): Promise<AssistantHistoryPage>;

export function getGeneralConversation(id: string): Promise<AssistantConversation>;
export function createGeneralConversation(question: string): Promise<GeneralConversationAskResponse>;
export function continueGeneralConversation(id: string, question: string): Promise<GeneralConversationAskResponse>;
```

Drawer state:

```ts
type GeneralDrawerView =
  | { kind: "new" }
  | { kind: "history" }
  | { kind: "chat"; conversationId: string }
  | { kind: "audit"; jobId: string }
  | { kind: "research"; runId: string };
```

- [ ] **Step 1: Write failing History UI tests**

Cases:

```ts
expect(screen.getByRole("button", { name: "New chat" })).toBeVisible();
expect(screen.getByRole("button", { name: "History" })).toBeVisible();
```

After clicking History, mock cards for chat/audit/research and assert all render. Clicking an audit must call the existing audit-job detail API, not create a new job.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm exec vitest run artifacts/adventure-zone/src/components/assistant/assistant-history.test.tsx
```

- [ ] **Step 3: Implement History list**

Render compact cards with type/status/time/summary. Initial filters exactly:

```text
All · Chats · Audits · Research · Running · Needs review
```

No pin/archive controls in phase 1.

- [ ] **Step 4: Implement New chat behavior**

`New chat` resets only the drawer's selected work/conversation state. It must not DELETE or overwrite any server record.

- [ ] **Step 5: Reopen and continue saved chats**

When a chat card opens, fetch the saved conversation and render all persisted messages. Submitting a new question calls `continueGeneralConversation(conversation.id, question)` and leaves the same `conversationId` selected.

- [ ] **Step 6: Reopen audits/research using existing domain APIs**

Audit card → `getAssistantJob(jobId)` and render `WebsiteAuditResults`.

Research card → `getLeadScoutRun(runId)` and render `LeadDiscoveryResults`.

History navigation must never call start/create endpoints.

- [ ] **Step 7: Restore running state after drawer close/reopen**

If History item is running, reopening enables the existing polling loop for that job/run ID. Closing the drawer clears UI polling intervals only; it does not call stop.

- [ ] **Step 8: Run tests**

```bash
pnpm exec vitest run \
  artifacts/adventure-zone/src/components/assistant/assistant-history.test.tsx \
  artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx
```

- [ ] **Step 9: Commit**

```bash
git add artifacts/adventure-zone/src/features/assistant artifacts/adventure-zone/src/components/assistant
git commit -m "feat: add assistant history and resumable chats"
```

---

### Task 7: Integration, zero-cost reopen regression, and CI

**Files:**
- Create: `artifacts/api-server/src/features/assistant/assistant-history-cost-routing.integration.test.ts`
- Modify: `.github/workflows/assistant-general-mode-ci.yml`
- Modify: `docs/superpowers/specs/2026-08-21-assistant-history-cost-routing-design.md` only if implementation reveals a genuine contradiction; otherwise leave spec unchanged.

**Interfaces:**
- Consumes every public interface from Tasks 1–6.
- Produces no new runtime interface.

- [ ] **Step 1: Add end-to-end persistence/reopen test**

Test sequence:

```text
1. Create a general chat.
2. Start a website audit from that chat.
3. Persist/link the audit job.
4. Close-equivalent: discard in-memory service state.
5. List History with a fresh repository/service instance.
6. Reopen the chat and audit.
7. Assert messages/job progress/findings are present.
8. Assert provider/web-search mocks have zero calls during steps 5–7.
```

- [ ] **Step 2: Add bounded-cost conversation regression**

Persist at least 40 turns, continue the conversation, and capture the provider input. Assert the model-facing transcript contains at most 12 messages and at most 12,000 characters while the database still returns all saved messages.

- [ ] **Step 3: Add cost-policy integration cases**

Assert:

```text
profile lookup -> deterministic -> 0 provider calls
healthy website audit -> direct HTTP + matcher -> 0 provider/web-search calls
simple structured capability -> configured simple model
Lead Scout discovery -> configured research model + web search
unknown web-research capability -> rejected before provider call
```

- [ ] **Step 4: Update Assistant General Mode CI focused suite**

Include:

```text
assistant-history-repository.test.ts
general-conversation-service.test.ts
assistant-conversation-work-links.test.ts
assistant-bounded-context.test.ts
ai-execution-policy.test.ts
assistant-history-cost-routing.integration.test.ts
assistant-history.test.tsx
website-audit-results.test.tsx
```

Keep existing assistant tests in the workflow.

- [ ] **Step 5: Run focused full suite**

```bash
pnpm exec vitest run \
  artifacts/api-server/src/features/assistant/general-conversation-service.test.ts \
  artifacts/api-server/src/features/assistant/assistant-history-repository.test.ts \
  artifacts/api-server/src/features/assistant/assistant-conversation-work-links.test.ts \
  artifacts/api-server/src/features/assistant/assistant-bounded-context.test.ts \
  artifacts/api-server/src/features/assistant/ai-execution-policy.test.ts \
  artifacts/api-server/src/features/assistant/assistant-job-worker.test.ts \
  artifacts/api-server/src/features/assistant/assistant-history-cost-routing.integration.test.ts \
  artifacts/adventure-zone/src/components/assistant/assistant-history.test.tsx \
  artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx
```

Expected: all PASS.

- [ ] **Step 6: Run workspace verification**

```bash
pnpm run typecheck
pnpm run build
```

Expected: both exit 0.

- [ ] **Step 7: Manual requirements checklist**

Verify in code/UI:

```text
[ ] New chat leaves prior chat in History
[ ] History shows chat/audit/research together
[ ] Reopen makes zero AI calls
[ ] Running audit/research resumes UI polling, not backend execution creation
[ ] Same conversation ID continues after reopen
[ ] Full transcript displays, bounded subset reaches model
[ ] Deterministic work has no provider/model
[ ] Simple model is configuration-driven
[ ] Web research is allowlisted/escalation-only
[ ] Usage table stores no prompts/private transcript bodies
[ ] Existing audit Apply fixes still requires explicit approval
[ ] Manager Assistant routes remain separate
```

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/assistant-general-mode-ci.yml artifacts/api-server/src/features/assistant artifacts/adventure-zone/src/components/assistant
git commit -m "test: verify assistant history and cost routing"
```

---

## Final verification before completion

Run the Task 7 focused suite, `pnpm run typecheck`, and `pnpm run build` fresh. Do not claim the feature is complete if GitHub/CI fails without readable logs; report the actual verification state and preserve the branch/PR for inspection.

Confirm the resulting implementation has no `TODO`, `TBD`, premium-model default, AI-generated History title, History-triggered research rerun, or automatic CRM mutation path.
