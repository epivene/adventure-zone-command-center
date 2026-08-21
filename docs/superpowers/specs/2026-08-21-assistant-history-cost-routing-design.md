# Booking Assistant History and Cost Routing Design

## Goal

Make long-running Booking Assistant work easy to leave and return to without adding API cost just for persistence. Unify saved chats, Lead Scout research, and assistant audit jobs into one History experience, while routing AI work through the cheapest adequate execution path.

## Product principles

1. Saving, listing, reopening, filtering, and viewing history must not call an AI model.
2. Long-running audits and research continue in the background after the drawer closes.
3. Reopening a saved item restores its actual conversation/results/state, not just the original prompt.
4. Users can continue the same conversation instead of starting over.
5. Old conversation text remains visible to the user, but every new model call uses bounded context rather than replaying the full transcript.
6. Deterministic/database logic always wins over model calls when it can answer correctly.
7. Simple AI work uses the cheapest approved model that meets quality requirements.
8. Expensive reasoning or web research is an escalation path, not a default.
9. Provider/model choices are server configuration, not hard-coded throughout feature code.
10. No background job or history feature may silently mutate CRM data.

## Unified Assistant History

The Booking Assistant header gains two primary actions:

- `New chat`
- `History`

History is one chronological index over three existing work types:

- `chat` — persisted assistant conversations
- `audit` — assistant background jobs such as website verification
- `research` — Lead Scout runs

Initial filters:

- All
- Chats
- Audits
- Research
- Running
- Needs review

Pin/archive are intentionally deferred.

### History item shape

```ts
export type AssistantHistoryItem = {
  id: string;
  kind: "chat" | "audit" | "research";
  title: string;
  subtitle: string | null;
  status: "active" | "running" | "stopped" | "complete" | "failed" | "needs_review";
  createdAt: string;
  updatedAt: string;
  summary: string | null;
  contextKind: string | null;
  contextRecordId: string | null;
  targetId: string;
};
```

The index should be assembled server-side from existing persisted records rather than copying all result data into a fourth storage system.

## Titles without AI cost

History titles are generated deterministically from the first user message or job instruction:

- trim whitespace
- collapse line breaks
- cap length
- preserve useful words
- use a generic fallback only if the prompt is empty/unusable

Examples:

- `Check all profile websites and make sure they match` → `Check all profile websites`
- `Find September fairs in Montana and Utah` → `Find September fairs in Montana and Utah`

No model call is permitted solely to title history items.

## General-mode conversation persistence

Profile/contact/booking-context conversations already have persistence patterns. General Command Center chats should use the same conversation/message storage model with a general context discriminator rather than creating a separate chat subsystem.

A general conversation remains distinct from audit/research jobs but may reference them through metadata so a user can reopen the chat that started the work and still see the current job/result card.

### Continue same conversation

Reopening a chat restores the full visible transcript from the database. New user messages continue that same conversation ID.

The model request does **not** receive the entire transcript by default.

## Bounded model context

To prevent old chats from becoming progressively more expensive, each model request builds a bounded context package:

1. current CRM/profile/booking context, when applicable
2. current structured job/research result relevant to the chat
3. the newest N conversation turns within a token/character budget
4. selected older facts only when they are referenced or retrieved by deterministic lookup

The UI can display the complete saved conversation while the model sees only the bounded working set.

No automatic AI-generated conversation summaries are required in phase 1 because they would themselves add cost. If summary compression is added later, it must be optional/threshold-based and justified by measured savings.

## Cost-routing architecture

Introduce one server-side AI execution policy instead of allowing features to choose models independently.

```ts
export type AiWorkClass =
  | "deterministic"
  | "simple_structured"
  | "reasoning"
  | "web_research";

export type AiExecutionPlan = {
  workClass: AiWorkClass;
  provider: string | null;
  model: string | null;
  webSearch: boolean;
  reason: string;
};
```

### Routing order

1. **Deterministic/database** — no model call.
2. **Simple structured AI** — cheapest approved small model.
3. **Reasoning** — stronger small/medium model only when simple model quality is insufficient.
4. **Web research** — only when current CRM data, direct HTTP inspection, or deterministic evidence cannot answer the request.

The policy must be explicit and testable. Features request a work class/capability; they do not directly embed model names unless they are acting as the provider adapter itself.

## Initial model policy

The initial OpenAI policy should be configuration-driven:

- simple extraction/classification/summarization → low-cost model (initial target: GPT-5 nano or the cheapest approved equivalent available to the project)
- difficult evidence comparison/research → GPT-5 mini or the cheapest approved model that passes quality tests
- no use of larger premium models for routine CRM work without a specific capability override

Exact model IDs remain environment/configuration values so they can change without editing business logic.

The application should preserve a provider interface so another provider can be introduced later if it becomes materially cheaper without sacrificing reliability. Phase 1 does **not** add a second provider account or dependency; provider flexibility is an interface boundary, not extra operational complexity.

## Web-search cost control

Web search should be treated as a separately metered escalation.

For website verification, the order is:

1. inspect the saved URL directly with the safe HTTP client
2. match page identity deterministically against the profile
3. classify verified/broken/mismatch/uncertain
4. only broken, mismatch, or sufficiently uncertain cases are eligible for official-site research
5. cache/persist the result so reopening History never repeats the search merely to display it

The same principle applies to Lead Scout and profile research: reuse persisted public evidence when it is still suitable rather than repeating identical searches during simple reopen/view actions.

## Cost observability

Store lightweight execution metadata for model-backed operations:

```ts
export type AiUsageRecord = {
  capability: string;
  provider: string;
  model: string;
  webSearchUsed: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
};
```

Phase 1 uses this for internal visibility and future tuning, not billing the user. Do not store prompts or private CRM data redundantly in the usage record.

This lets us answer practical questions later such as which feature causes most model spend and whether moving a capability to a cheaper model is safe.

## Reopening audits and research

History items for audit/research load the existing durable record by ID.

Examples:

- running website audit reopens at current progress
- completed website audit reopens summary/findings/proposals
- a `needs_review` audit retains unapplied proposals
- Lead Scout reopens CRM matches, candidates, enrichment state, and sources
- stopped work can expose Continue where already supported

Closing the drawer never implies cancel.

## New Chat behavior

`New chat` clears the currently selected conversation/work item from the drawer but does not delete it. It appears in History immediately once it has persisted user content.

Starting a new general chat must not erase or overwrite the prior general conversation.

## API shape

Suggested endpoints:

```text
GET  /api/assistant/history?kind=&status=&cursor=
GET  /api/assistant/history/:kind/:id
POST /api/assistant/general/conversations
GET  /api/assistant/general/conversations/:id
POST /api/assistant/general/conversations/:id/ask
```

Existing audit-job and Lead Scout detail/action endpoints remain authoritative for their domain-specific state.

History should return compact cards only; detail is loaded when opened.

## UI behavior

History opens inside the Booking Assistant rather than navigating away from the current CRM page.

A compact item should show:

- title
- type label/icon
- time
- status
- one-line summary/progress

Examples:

- `Audit all profile websites` — `Running · 418 / 1,214 checked`
- `September route prospects` — `Complete · 23 prospects`
- `Colorado Events cleanup` — `Chat · Yesterday`
- `Website audit` — `Needs review · 17 fixes awaiting approval`

Opening an item replaces the drawer body with that saved workspace and provides a clear Back to History action.

## Error handling

- If a saved item is deleted or unavailable, History removes/stales the card after a 404 rather than crashing the drawer.
- A failed background job remains visible with its failure summary and any completed partial results.
- Network loss while viewing history does not delete local UI state.
- Reopening an item never reruns a model/web request merely to render it.
- If configured AI provider/model is unavailable, deterministic features continue working and AI-backed actions return a bounded actionable error.

## Security and privacy

- History is actor-scoped using the existing owner/user identity.
- No arbitrary cross-user conversation/job lookup.
- Existing CRM authorization rules still govern actions opened from history.
- Usage telemetry stores model/cost metadata only, not duplicate sensitive prompt bodies.
- Provider adapters receive only the bounded context required for that capability.

## Testing

### History

- general chats persist and can be reopened
- creating New chat does not destroy prior chat
- audits and research appear in unified chronological history
- filters return correct item types/statuses
- reopening does not invoke AI/web research
- running job progress remains current
- needs-review proposals remain available
- actor isolation

### Bounded context

- full transcript is stored/displayed
- model request includes only bounded recent/relevant context
- very long conversations do not grow request size without bound
- referenced structured result can be included without replaying unrelated history

### Cost routing

- deterministic capability never calls a provider
- simple structured work selects configured low-cost model
- reasoning escalation happens only for registered capabilities
- web search flag is false unless capability explicitly requires/escalates to it
- model names are configuration-driven
- provider failure does not break deterministic CRM functions

### Website audit regression

- healthy/matching saved URL requires no AI or web search
- broken/mismatched candidate may invoke replacement research
- reopening completed results makes zero replacement-research calls

## Release sequence

### Phase 1

1. persist general-mode conversations
2. unified History index over chats, audit jobs, and Lead Scout runs
3. History/New chat drawer UI
4. reopen/continue same conversation
5. bounded context builder
6. centralized AI cost-routing policy
7. move simple eligible AI work to configured low-cost model
8. usage metadata/observability

### Phase 2

- history text search
- pin/archive
- optional conversation compression only if measured token usage justifies it
- additional provider adapter only if a documented cost/quality evaluation shows material benefit

## Success criteria

- A long audit/research run can be left and reopened later with all progress/results intact.
- Old chats are easy to reopen and continue.
- Saving/browsing/reopening history causes no AI API calls.
- Conversation cost does not grow linearly forever with transcript length.
- Deterministic work uses no model.
- Simple AI uses the cheapest approved model configured for the app.
- Web research is an escalation rather than a default.
- Model/provider changes can be made centrally without rewriting feature business logic.
