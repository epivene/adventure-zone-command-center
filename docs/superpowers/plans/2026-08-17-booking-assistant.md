# Booking Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Use test-driven development and preserve source provenance throughout.

**Goal:** Add a persistent, contextual Booking Assistant that builds reliable Booking Briefs from Command Center data, answers routine questions deterministically, uses the existing cloud AI provider abstraction for harder questions, exposes sources, and remains useful from cached data offline.

**Architecture:** Introduce a focused assistant domain with (1) curated business knowledge, (2) source-linked derived CRM facts, (3) a deterministic context/brief builder, (4) a source-aware answer orchestrator, and (5) a global/contextual frontend drawer. Reuse `artifacts/api-server/src/features/ai-suggestions/ai-client.ts` for cloud inference rather than adding another provider layer. Raw ACT! history stays untouched. Offline support caches server-prepared context/brief bundles; no local LLM is required in this release.

**Tech Stack:** TypeScript, React, Vite, Wouter, TanStack React Query, Express, Drizzle/PostgreSQL, Zod, Vitest/Testing Library, browser IndexedDB, existing `createAiClient()`.

## Dependencies

- Release 1 Package Intelligence is merged.
- Existing ACT! activity/source provenance remains available.
- Existing admin authentication remains canonical.

## Global constraints

- Assistant responses never bypass server-side authorization.
- Structured records outrank derived facts and AI output.
- Every important factual claim in a server answer must be traceable to an `AssistantSourceReference`.
- Raw ACT! activities/source versions are never rewritten.
- Derived facts are separate, reviewable records with confidence/provenance.
- Website/business knowledge is stored deliberately; do not scrape the public site on each request.
- Cloud AI receives only the context required for the current authorized request.
- Cloud failure must not break deterministic briefs/facts.
- Offline mode may answer only from previously cached authorized context and must identify itself as cached/offline.
- Assistant has no generic database mutation tool in this release.
- Drafted email/message text is returned as editable content only.
- Avoid storing hidden chain-of-thought. Persist user/assistant messages, mode, source references, and concise answer metadata only.

## Migration

Use `lib/db/migrations/045_booking_assistant.sql` unless the prefix is occupied on the implementation base; if shifted, update migration registration and this plan path before coding.

## File map

### Shared schema

- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/045_booking_assistant.sql`
- Modify: `lib/db/src/migrations.ts`
- Create: `lib/db/src/booking-assistant-schema.test.ts`

### Server assistant domain

Create directory `artifacts/api-server/src/features/assistant/` with:

- `assistant-types.ts`
- `assistant-input.ts`
- `assistant-sources.ts`
- `business-knowledge-repository.ts`
- `derived-fact-repository.ts`
- `derived-fact-extractor.ts`
- `booking-context-repository.ts`
- `booking-context-builder.ts`
- `booking-brief.ts`
- `deterministic-answers.ts`
- `assistant-prompt.ts`
- `assistant-service.ts`
- colocated tests for each focused unit.

Modify/reuse:

- `artifacts/api-server/src/features/ai-suggestions/ai-client.ts` only if a small generic interface improvement is needed; do not fork it.
- `artifacts/api-server/src/routes/index.ts` or current route registration file.
- Create: `artifacts/api-server/src/routes/assistant.ts`
- Create: `artifacts/api-server/src/routes/assistant.test.ts`

### Frontend assistant domain

Create directory `artifacts/adventure-zone/src/features/assistant/`:

- `assistant-types.ts`
- `assistant-api.ts`
- `assistant-context.tsx`
- `assistant-offline-db.ts`
- `assistant-cache.ts`
- tests for cache/context.

Create components:

- `artifacts/adventure-zone/src/components/assistant/assistant-launcher.tsx`
- `assistant-drawer.tsx`
- `assistant-message.tsx`
- `assistant-sources.tsx`
- `booking-brief-card.tsx`
- tests.

Modify:

- `artifacts/adventure-zone/src/components/navigation/app-shell.tsx`
- `artifacts/adventure-zone/src/App.tsx` only if provider placement requires it.
- `artifacts/adventure-zone/src/pages/BookingDetailPage.tsx`
- `artifacts/adventure-zone/src/pages/EventProfilePage.tsx`
- `artifacts/adventure-zone/src/pages/EventFamilyPage.tsx`
- `artifacts/adventure-zone/src/pages/CallWorkspacePage.tsx`
- calendar/route pages only to register context, not to add duplicate assistant UIs.

## Task 1: Add assistant source, knowledge, fact, and conversation schema

### Tables

Add `business_knowledge_entries`:

```ts
{
  id: uuid,
  scope: text, // global | package | resource | sales | operations
  scopeRecordId: uuid | null,
  title: text,
  body: text,
  sourceUrl: text | null,
  sourceLabel: text | null,
  active: boolean,
  lastReviewedAt: timestamp | null,
  createdBy: text,
  createdAt: timestamp,
  updatedAt: timestamp,
}
```

Add `derived_crm_facts`:

```ts
{
  id: uuid,
  organizationId: uuid | null,
  contactId: uuid | null,
  bookingId: uuid | null,
  factKind: text,
  value: jsonb,
  summary: text,
  confidence: text, // high | medium | low
  sourceActivityId: uuid | null,
  sourceRecordId: uuid | null,
  sourceVersionId: uuid | null,
  extractionFingerprint: text,
  status: text, // proposed | confirmed | dismissed
  createdAt: timestamp,
  updatedAt: timestamp,
}
```

Add assistant conversations/messages/source links:

```ts
assistant_conversations {
  id,
  actorId,
  contextKind,
  contextRecordId,
  title,
  createdAt,
  updatedAt,
}

assistant_messages {
  id,
  conversationId,
  role, // user | assistant
  body,
  answerMode, // deterministic | cloud | offline_cached | null for user
  confidence,
  createdAt,
}

assistant_message_sources {
  id,
  messageId,
  sourceKind,
  sourceRecordId,
  label,
  occurredAt,
}
```

Do not persist prompts containing hidden reasoning or provider internals.

### Constraints

- derived fact must have at least one parent (`organizationId`, `contactId`, `bookingId`).
- confidence/status values checked.
- extraction fingerprint unique enough to make reruns idempotent per fact/source.
- assistant source rows require nonblank kind/record/label.
- indexes on conversation actor/context, derived fact parents/status, source message.

### Steps

- [ ] **Step 1: Write failing schema tests** in `lib/db/src/booking-assistant-schema.test.ts`.
- [ ] **Step 2: Run schema test and confirm failure.**

```bash
pnpm exec vitest run lib/db/src/booking-assistant-schema.test.ts
```

- [ ] **Step 3: Add Drizzle tables and migration SQL.**
- [ ] **Step 4: Register migration marker** in `lib/db/src/migrations.ts` checking `business_knowledge_entries`, `derived_crm_facts`, and `assistant_conversations`.
- [ ] **Step 5: Add preservation test** verifying activities/source records/bookings are unchanged by the migration.
- [ ] **Step 6: Run DB tests/typecheck.**
- [ ] **Step 7: Commit.**

```bash
git add lib/db
git commit -m "feat: add booking assistant schema"
```

## Task 2: Define typed source and answer contracts

Create `assistant-types.ts` and mirror frontend-safe types as needed.

```ts
export type AssistantContextKind =
  | "organization"
  | "contact"
  | "event_family"
  | "booking"
  | "calendar_event"
  | "route"
  | "call_workspace";

export type AssistantSourceReference = {
  id: string;
  kind:
    | "booking"
    | "activity"
    | "follow_up"
    | "package"
    | "resource"
    | "route"
    | "business_knowledge"
    | "derived_fact";
  recordId: string;
  label: string;
  occurredAt: string | null;
};

export type AssistantAnswer = {
  text: string;
  mode: "deterministic" | "cloud" | "offline_cached";
  confidence: "high" | "medium" | "low";
  sources: AssistantSourceReference[];
  needsAdmin: false;
};
```

Define source IDs deterministically within each response bundle; do not expose database IDs as the user-facing label.

### Steps

- [ ] **Step 1: Write type/serialization tests** for allowed source kinds and JSON-safe date strings.
- [ ] **Step 2: Add Zod input schemas** for context requests and ask requests:

```ts
getAssistantContextInput = { contextKind, contextRecordId }
askBookingAssistantInput = { conversationId?: uuid, contextKind, contextRecordId, question }
```

- [ ] **Step 3: Reject blank questions and invalid context kinds/UUIDs.**
- [ ] **Step 4: Commit.**

## Task 3: Add curated Adventure Zone business knowledge repository and seed

### Seed content

Seed a small initial set based on already-approved business understanding, not a live scraper:

- Adventure Zone package: suggested 10, normal 10–12, customizable.
- Warrior's Playground: around 5, customizable.
- Pirate's Rebellion: around 3, customizable.
- Carnival games/extras tracked separately.
- Paintball treated as special/shared equipment.
- General family-business flexibility language.
- Public-site setup/site requirement text only where the exact current source has been reviewed during implementation.

Each website-derived entry stores `sourceUrl` and `lastReviewedAt` with the review date. If implementation re-checks the site, use the current page and update the seed text deliberately. Do not add unsupported setup claims from memory.

### Repository contract

```ts
export interface BusinessKnowledgeRepository {
  listActiveForContext(input: {
    packageTemplateIds: string[];
    resourceIds: string[];
    includeGlobal: boolean;
  }): Promise<BusinessKnowledgeEntry[]>;
}
```

### Steps

- [ ] **Step 1: Write failing repository/seed tests** for active filtering, scope filtering, and idempotent stable seed keys.
- [ ] **Step 2: Implement repository.**
- [ ] **Step 3: Add seed/upsert path** following the repo's existing seed conventions; never duplicate entries on repeated deploy.
- [ ] **Step 4: Verify deactivated knowledge is not used.**
- [ ] **Step 5: Commit.**

```bash
git add artifacts/api-server/src/features/assistant lib/db
git commit -m "feat: add assistant business knowledge"
```

## Task 4: Add source-linked derived CRM facts from ACT! history

### Fact kinds for first release

Keep scope tight:

```ts
export const derivedFactKindValues = [
  "recurring_event_timing",
  "usual_package",
  "usual_attraction_count",
  "contact_preference",
  "decision_maker",
  "objection",
  "promised_follow_up",
  "prior_outcome",
  "special_requirement",
] as const;
```

### Extraction rules

- Source set is existing `activities` rows tied to a profile/contact/booking, including imported note/history records.
- Preserve `sourceActivityId` and, when present, ACT! `sourceRecordId`/`sourceVersionId`.
- Extraction fingerprint includes source activity/version + normalized fact kind/value so reruns are idempotent.
- AI output is proposed/low-or-higher confidence; it never writes structured CRM fields.
- Where deterministic parsing already provides the fact (e.g. known booking package history), do not ask AI to rediscover it.

### Reuse existing AI client

`derived-fact-extractor.ts` must accept an injected `AiCompletionClient` and production wiring calls `createAiClient()` from the existing AI suggestions module.

```ts
export interface DerivedFactExtractor {
  extract(input: {
    organizationId?: string;
    contactId?: string;
    activities: DerivedFactSourceActivity[];
  }): Promise<DerivedFactCandidate[]>;
}
```

### Steps

- [ ] **Step 1: Write parser tests** with malformed/non-JSON model responses, unknown fact kinds, missing provenance, and confidence normalization.
- [ ] **Step 2: Write repository idempotency tests.** Same source/fact rerun must not duplicate.
- [ ] **Step 3: Implement prompt builder** requesting concise JSON candidates plus the exact source activity ID supplied in the input.
- [ ] **Step 4: Implement safe parser.** Drop candidates whose claimed source ID was not in the supplied activity batch.
- [ ] **Step 5: Implement storage** as `proposed`; do not auto-confirm.
- [ ] **Step 6: Add an admin-triggered or worker-compatible extraction entry point** using existing background/recovery conventions. Do not make profile page load synchronously call the LLM across years of history.
- [ ] **Step 7: Run tests and commit.**

```bash
git add artifacts/api-server/src/features/assistant
git commit -m "feat: extract source linked crm facts"
```

## Task 5: Build the authorized Booking Assistant context bundle

### Context contract

```ts
export type BookingAssistantContextBundle = {
  context: {
    kind: AssistantContextKind;
    recordId: string;
    label: string;
  };
  profile: {
    organizationId: string | null;
    contactIds: string[];
    eventFamilyId: string | null;
  };
  currentBooking: BookingAssistantBookingSummary | null;
  priorBookings: BookingAssistantBookingSummary[];
  recentActivities: BookingAssistantActivitySummary[];
  openFollowUps: BookingAssistantFollowUpSummary[];
  packageHistorySignals: PackageHistorySignal[];
  routeContext: BookingAssistantRouteSummary | null;
  derivedFacts: BookingAssistantDerivedFactSummary[];
  businessKnowledge: BookingAssistantKnowledgeSummary[];
  sources: AssistantSourceReference[];
  generatedAt: string;
};
```

### Authorization

The route/controller must authenticate owner/admin first using the existing admin auth helper. The repository receives a resolved authorized context target, not an arbitrary freeform SQL filter.

Context resolution rules:

- booking -> booking + linked organization/contact/event family if present,
- organization/profile -> organization + related contacts/bookings/family,
- event family -> family members/bookings,
- contact -> contact + linked organizations/bookings,
- call workspace -> active call/profile context passed explicitly by an existing canonical ID,
- calendar event -> resolve to booking/activity canonical record,
- route -> route/trip context plus relevant bookings; avoid loading all CRM history for every route stop unless requested.

### Steps

- [ ] **Step 1: Write repository tests** for each context type using minimal fixtures.
- [ ] **Step 2: Write authorization route tests** proving unauthenticated access fails.
- [ ] **Step 3: Implement context resolution** with bounded limits: recent meaningful activities and prior bookings, not unlimited raw history.
- [ ] **Step 4: Attach source references** at the time each fact enters the bundle.
- [ ] **Step 5: Ensure package history signals from Release 1 are reused**, not recomputed differently.
- [ ] **Step 6: Run tests and commit.**

```bash
git add artifacts/api-server/src/features/assistant artifacts/api-server/src/routes
git commit -m "feat: build assistant context bundles"
```

## Task 6: Build deterministic Booking Briefs

### Contract

```ts
export type BookingBrief = {
  headline: string;
  items: Array<{
    key:
      | "package_history"
      | "last_outcome"
      | "timing"
      | "attraction_count"
      | "contact"
      | "objection_or_promise"
      | "follow_up"
      | "route_fit"
      | "year_over_year_change"
      | "next_action";
    text: string;
    confidence: "high" | "medium" | "low";
    sourceIds: string[];
  }>;
  generatedAt: string;
};
```

### Precedence

1. structured current records,
2. deterministic prior-booking/package history,
3. confirmed derived facts,
4. proposed high-confidence derived facts explicitly labeled as historical inference,
5. omit rather than invent.

`next_action` can be deterministic from overdue/open follow-up + booking status. Do not use LLM merely to populate every brief.

### Steps

- [ ] **Step 1: Write pure brief tests** for a rich customer, sparse customer, conflicting derived fact vs structured record, and no-route case.
- [ ] **Step 2: Implement pure `buildBookingBrief(bundle)`** with no DB or AI calls.
- [ ] **Step 3: Ensure every item has at least one source ID except a purely computed `next_action`, which must cite the source records used for the computation.
- [ ] **Step 4: Commit.**

## Task 7: Add deterministic question answering

### First-release intents

Implement a compact matcher/handler layer for questions equivalent to:

- “What happened last year?”
- “What do they normally book?”
- “What is different from last year?”
- “What follow-up is due?”
- “Who is the main contact?”
- “Did they have paintball last time?”
- “What am I forgetting?” using known missing-current-vs-prior signals and open follow-ups.

Do not attempt a giant NLP classifier. Normalize question text and match a small set of intent patterns; unknown questions fall through to cloud mode.

### Contract

```ts
export function answerDeterministically(input: {
  question: string;
  context: BookingAssistantContextBundle;
  brief: BookingBrief;
}): AssistantAnswer | null;
```

### Steps

- [ ] **Step 1: Write tests** for supported paraphrases and unsupported questions.
- [ ] **Step 2: Implement handlers** returning plain language + exact source refs.
- [ ] **Step 3: Make low-evidence cases say “I don't have enough saved history to tell” rather than guessing.
- [ ] **Step 4: Commit.**

## Task 8: Add cloud question orchestration using the existing AI client

### Flow

`AssistantService.ask()`:

1. validate/authenticate context,
2. build context bundle + brief,
3. try deterministic answer,
4. if deterministic answer exists, persist conversation/message and return it,
5. otherwise create/reuse existing `AiCompletionClient`,
6. send a compact context prompt containing source IDs and explicit instructions not to invent facts,
7. parse a response object containing `text`, `confidence`, `sourceIds`,
8. reject unknown source IDs,
9. if model cites no sources for factual claims, downgrade/return a safe “I can’t support that from the saved records” response,
10. persist user/assistant messages and valid source links.

### Model output contract

```json
{
  "text": "...",
  "confidence": "high",
  "sourceIds": ["src_1", "src_4"]
}
```

No chain-of-thought field.

### Steps

- [ ] **Step 1: Write service tests with fake AI client** for deterministic bypass, successful cloud answer, unknown cited source, provider not configured, provider exception, and malformed JSON.
- [ ] **Step 2: Implement concise prompt builder** that clearly separates `STRUCTURED FACTS`, `HISTORICAL DERIVED FACTS`, and `BUSINESS KNOWLEDGE`.
- [ ] **Step 3: Implement safe output parsing.**
- [ ] **Step 4: On provider failure**, return a useful deterministic/cached brief response when possible; otherwise a normal user-facing error without losing the conversation.
- [ ] **Step 5: Do not expose provider name/key/error internals to the UI beyond a safe availability message.
- [ ] **Step 6: Commit.**

## Task 9: Add assistant API routes

Create authenticated routes:

- `GET /api/assistant/context?kind=...&id=...`
- `GET /api/assistant/brief?kind=...&id=...`
- `POST /api/assistant/ask`
- `GET /api/assistant/conversations/:id`

Use current route prefix conventions if `/api` is applied by router registration rather than route module paths.

### Steps

- [ ] **Step 1: Write route tests** for auth, validation, missing record, brief shape, source shape, deterministic answer, cloud fallback, and conversation ownership.
- [ ] **Step 2: Implement routes thinly** around `AssistantService`; do not put retrieval logic in Express handlers.
- [ ] **Step 3: Add request size limits** for question text via Zod max length.
- [ ] **Step 4: Register routes.**
- [ ] **Step 5: Run focused route tests and commit.**

## Task 10: Add admin-side assistant context provider and global drawer

### Frontend context

Create `AssistantContextProvider`:

```ts
export type ActiveAssistantContext = {
  kind: AssistantContextKind;
  recordId: string;
  label?: string;
} | null;

export type AssistantContextApi = {
  activeContext: ActiveAssistantContext;
  setActiveContext(context: ActiveAssistantContext): void;
  openAssistant(prefill?: string): void;
  closeAssistant(): void;
};
```

Pages register context on mount and clear/replace it on navigation. The persistent launcher lives inside `AppShell`, so admin pages do not each render a separate floating button.

### Steps

- [ ] **Step 1: Write provider tests** for switching profile -> booking -> route contexts.
- [ ] **Step 2: Write launcher/drawer tests** showing current context label and open/close behavior.
- [ ] **Step 3: Implement provider and drawer shell.**
- [ ] **Step 4: Wire provider around admin `AppShell` only**, not manager routes yet.
- [ ] **Step 5: Register context in BookingDetail, EventProfile, EventFamily, CallWorkspace, Calendar, Routes/Trip pages using canonical IDs already present on those pages.
- [ ] **Step 6: Commit.**

## Task 11: Add Booking Brief and Sources/Why UI

### UI behavior

- Relevant profile/booking pages show compact `BookingBriefCard` before chat.
- Assistant messages with sources show a collapsed `Sources / Why` control.
- Sources display plain labels/date and navigate to the existing record where a stable route exists.
- Derived fact sources should ultimately navigate to/show the source activity/history item, not just the derived fact row.
- Inference/recommendation language is visibly differentiated from factual language through text labels, not only color.

### Steps

- [ ] **Step 1: Write BookingBriefCard tests** for source-backed items and sparse state.
- [ ] **Step 2: Write AssistantSources tests** for collapsed/expanded and mixed source kinds.
- [ ] **Step 3: Implement message rendering** without raw HTML injection.
- [ ] **Step 4: Add Booking Brief to BookingDetail and EventProfile first; contextual drawer covers other pages.
- [ ] **Step 5: Commit.**

## Task 12: Add offline assistant context/brief cache

### Offline model

Do not cache the whole CRM database. Cache server-prepared assistant bundles the user actually opened, with bounded retention.

IndexedDB database: `adventure-zone-assistant`.

Store `contextBundles` keyed by:

```ts
`${actorId}:${contextKind}:${contextRecordId}`
```

Record:

```ts
export type CachedAssistantContext = {
  cacheKey: string;
  actorId: string;
  contextKind: AssistantContextKind;
  contextRecordId: string;
  bundle: BookingAssistantContextBundle;
  brief: BookingBrief;
  cachedAt: string;
};
```

### Privacy

- Cache is admin-user scoped by authenticated actor ID.
- Sign-out clears that actor's assistant cache.
- If the existing owner auth is one shared owner identity rather than individual accounts, use the stable authenticated owner identity exposed by current auth rather than inventing a device user.
- Do not cache AI provider secrets or server prompts.

### Behavior

- Online successful context fetch writes cache.
- Offline drawer/profile reads last cached bundle/brief.
- Offline deterministic question answering can run against cached bundle in the browser using mirrored pure `booking-brief`/deterministic functions or a compact frontend equivalent shared safely.
- Unknown/heavy question offline says it needs an internet connection for deeper AI analysis; it does not fake a cloud result.
- UI shows `Offline — using saved Command Center data`.

### Steps

- [ ] **Step 1: Write memory-store tests** before IndexedDB adapter tests.
- [ ] **Step 2: Implement cache interface + IndexedDB adapter.**
- [ ] **Step 3: Add offline deterministic answer tests** using cached bundle.
- [ ] **Step 4: Wire connectivity state** using existing browser online/offline conventions and `OfflineBanner`; do not add a second global network detector if one can be reused.
- [ ] **Step 5: Clear cache on admin sign-out.**
- [ ] **Step 6: Commit.**

## Task 13: Release verification

- [ ] Run all assistant server tests.
- [ ] Run all assistant frontend tests.
- [ ] Run impacted ACT! provenance/AI-suggestions tests to confirm reuse did not regress existing analysis.
- [ ] Run schema/migration tests.
- [ ] Run:

```bash
pnpm run typecheck
pnpm run build
```

- [ ] Manually verify:
  1. Open a profile -> assistant knows that profile.
  2. Open a booking -> context switches without restating it.
  3. Booking Brief shows source-backed package/history/follow-up facts.
  4. “What did they book last year?” is deterministic and cites the prior booking.
  5. A harder question uses cloud AI when configured.
  6. Bad/absent AI provider still leaves brief/deterministic questions usable.
  7. Sources/Why opens real records/history.
  8. Offline mode loads a previously viewed brief and clearly labels cached mode.
  9. Unknown offline question does not invent an answer.
  10. No question/answer automatically edits package, status, notes, follow-ups, or sends an email.

- [ ] Review all assistant logging to ensure prompts/customer history are not dumped into production logs unnecessarily.
- [ ] Review `git diff main...HEAD` for unrelated changes.

## Release completion

Open a PR from `feature/booking-assistant` to `main`. Release 3 begins from main after this PR merges so the Manager Assistant can reuse the established source/answer contracts without copying them.
