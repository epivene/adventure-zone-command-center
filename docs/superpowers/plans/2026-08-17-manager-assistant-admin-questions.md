# Manager Assistant and Admin Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Follow test-driven development, especially for authorization and offline idempotency.

**Goal:** Give each Leg Manager a permission-scoped Operations Assistant that answers from assigned-leg/event data, escalates uncertain questions into an Admin Questions inbox, returns admin answers to the manager, and remains useful with unreliable connectivity.

**Architecture:** Reuse the Booking Assistant source/answer contracts but build an entirely separate server-side manager context resolver that derives leg scope from the authenticated manager session. Add structured Admin Question and reusable operations knowledge records. Reuse `manager-offline-db.ts` and `manager-sync-queue.ts` for offline question submission. Integrate admin review into existing manager communications administration rather than creating a separate management product.

**Tech Stack:** TypeScript, React, Vite, Wouter, Express, Drizzle/PostgreSQL, Zod, Vitest/Testing Library, existing manager authentication/session helpers, existing IndexedDB manager mutation queue, existing AI client when online.

## Dependencies

- Booking Assistant release is merged so `AssistantSourceReference` and `AssistantAnswer` contracts are available.
- Existing Leg Manager portal auth, route/calendar scoping, messages, acknowledgments, and offline mutation queue remain canonical.
- Existing manager communication design remains in force: admins can supervise in-app manager communication and operational changes continue through canonical workflows.

## Global constraints

1. Manager context comes from the authenticated manager session's leg ID. Never accept a client-supplied leg ID as authority.
2. Manager Assistant may retrieve only assigned-leg/event operational information already permitted to that manager.
3. Full sales CRM history, unrelated customer notes, pricing strategy, other legs, and admin-only data are out of manager scope.
4. If an answer is not supported confidently by authorized context, return `needsAdmin: true` and offer `Ask Admin`.
5. Do not use cloud AI to widen context. The server constructs the scoped bundle before any model call.
6. Admin Question submission contains only manager-authorized context references/snapshot fields.
7. `clientMutationId` is unique and server-enforced so offline retries create one question.
8. An admin answer is communication, not an automatic booking/route/resource mutation.
9. If an admin changes official data while resolving a question, use the existing canonical operation and acknowledgment workflow.
10. Reusable operations knowledge is created only via explicit admin action.
11. Reusable knowledge has scope/effective dates and can be deactivated or reviewed later.
12. Manager offline cache remains leg-private and is cleared on sign-out/leg switch according to current portal invariants.
13. Optional local browser-model support is a final enhancement; deterministic offline answers and Admin Question queueing ship first.
14. No model files or AI dependencies may make manager sign-in/route/events unusable.

## Migration

Use `lib/db/migrations/046_manager_assistant_questions.sql` unless prefix 046 is occupied on the implementation base; shift consistently if required before coding.

## File map

### Shared schema

- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/046_manager_assistant_questions.sql`
- Modify: `lib/db/src/migrations.ts`
- Create: `lib/db/src/manager-assistant-schema.test.ts`

### Server manager assistant

Create under `artifacts/api-server/src/features/manager-assistant/`:

- `manager-assistant-types.ts`
- `manager-assistant-input.ts`
- `manager-assistant-context-repository.ts`
- `manager-assistant-context.ts`
- `manager-deterministic-answers.ts`
- `manager-assistant-prompt.ts`
- `manager-assistant-service.ts`
- `admin-question-repository.ts`
- `admin-question-service.ts`
- `operations-knowledge-repository.ts`
- colocated tests.

Reuse existing manager auth/session and existing manager portal domain services rather than copying their SQL.

Create/modify routes according to current manager route organization:

- manager assistant context/ask routes,
- manager Admin Question create/list routes,
- admin Admin Question list/respond/resolve/promote routes,
- route tests.

### Frontend manager portal

Create components:

- `artifacts/adventure-zone/src/components/manager/manager-assistant-launcher.tsx`
- `manager-assistant-drawer.tsx`
- `manager-assistant-message.tsx`
- `ask-admin-card.tsx`
- `admin-question-status-card.tsx`
- tests.

Modify:

- `artifacts/adventure-zone/src/components/manager/manager-shell.tsx`
- `artifacts/adventure-zone/src/pages/ManagerHomePage.tsx`
- `artifacts/adventure-zone/src/pages/ManagerRoutePage.tsx`
- manager event/detail/wrap-up pages where event context exists.
- `artifacts/adventure-zone/src/lib/manager-offline-db.ts`
- `artifacts/adventure-zone/src/lib/manager-sync-queue.ts` only if needed to support cache stores in addition to mutation store.

### Admin UI

Create:

- `artifacts/adventure-zone/src/components/manager-admin/admin-question-review.tsx`
- `artifacts/adventure-zone/src/components/manager-admin/admin-question-review.test.tsx`

Modify:

- `artifacts/adventure-zone/src/pages/ManagerCommunicationsAdminPage.tsx`
- existing admin navigation badges/counts only if a current notification/badge pattern exists.

## Task 1: Add Admin Question and operations knowledge schema

### Tables

Add `manager_admin_questions`:

```ts
{
  id: uuid,
  clientMutationId: text,
  travelLegId: uuid,
  bookingId: uuid | null,
  tripId: uuid | null,
  managerSessionSubject: text,
  question: text,
  urgency: text, // normal | urgent
  status: text, // needs_answer | answered | resolved
  escalationReason: text,
  checkedSourceRefs: jsonb,
  contextSnapshot: jsonb,
  createdAt: timestamp,
  answeredAt: timestamp | null,
  resolvedAt: timestamp | null,
  updatedAt: timestamp,
}
```

Add `manager_admin_question_responses`:

```ts
{
  id: uuid,
  questionId: uuid,
  actorType: text, // admin | manager
  actorId: text,
  body: text,
  createdAt: timestamp,
}
```

Add `operations_knowledge_entries`:

```ts
{
  id: uuid,
  title: text,
  body: text,
  scope: text, // global | package | resource | site | leg
  scopeRecordId: text | null,
  sourceAdminQuestionId: uuid | null,
  active: boolean,
  effectiveAt: timestamp,
  reviewAfter: timestamp | null,
  createdBy: text,
  createdAt: timestamp,
  updatedAt: timestamp,
}
```

### Constraints/indexes

- unique `manager_admin_questions.client_mutation_id`.
- question text/escalation reason nonblank.
- status/urgency check values.
- travel leg required.
- indexes on `(status, urgency, createdAt)`, travel leg, booking.
- response body nonblank and indexed by question/time.
- operations knowledge scope valid and active/effective index.

### Steps

- [ ] **Step 1: Write failing schema tests** in `lib/db/src/manager-assistant-schema.test.ts`.
- [ ] **Step 2: Run failing test.**

```bash
pnpm exec vitest run lib/db/src/manager-assistant-schema.test.ts
```

- [ ] **Step 3: Add Drizzle schema + migration.**
- [ ] **Step 4: Register migration marker** checking all three tables.
- [ ] **Step 5: Add preservation test** proving existing manager access/messages/acknowledgments/leg data remain intact.
- [ ] **Step 6: Run DB tests/typecheck and commit.**

```bash
git add lib/db
git commit -m "feat: add manager assistant question schema"
```

## Task 2: Define manager-specific assistant contracts

Reuse `AssistantSourceReference` and `AssistantAnswer` where safe; extend source kinds from Release 2 with manager-only kinds:

```ts
export type ManagerAssistantContextKind = "leg" | "booking" | "route" | "operations";

export type ManagerAssistantContextBundle = {
  leg: {
    id: string;
    name: string;
  };
  activeContext: {
    kind: ManagerAssistantContextKind;
    recordId: string;
    label: string;
  };
  assignedEvents: ManagerAssignedEventSummary[];
  activeEvent: ManagerAssignedEventSummary | null;
  route: ManagerRouteAssistantSummary | null;
  handoffs: ManagerHandoffAssistantSummary[];
  acknowledgments: ManagerAcknowledgmentAssistantSummary[];
  operationalInstructions: ManagerInstructionSummary[];
  knowledge: OperationsKnowledgeSummary[];
  sources: AssistantSourceReference[];
  generatedAt: string;
};
```

Manager answer:

```ts
export type ManagerAssistantAnswer = AssistantAnswer & {
  needsAdmin: boolean;
  escalationReason: string | null;
};
```

### Steps

- [ ] **Step 1: Write serialization/input tests.**
- [ ] **Step 2: Add Zod schemas** for event/context selection and question. Inputs may include booking/trip/context IDs, but never a leg ID used for authorization.
- [ ] **Step 3: Add max question length and trim validation.**
- [ ] **Step 4: Commit.**

## Task 3: Build leg-scoped context repository with adversarial authorization tests

### Scope rules

The server manager auth helper returns the authenticated leg identity. Repository methods receive that resolved leg ID internally.

Allowed data:

- the manager's `travelLegs` row,
- bookings assigned to that leg/current trip/route according to existing portal scope logic,
- package/resource summaries for those bookings,
- setup/teardown and location data already exposed to the manager,
- operational customer contacts already exposed for the assigned event,
- approved handoffs/meetups involving the leg,
- pending acknowledgments for the leg,
- manager instructions/operational notes allowed by existing portal APIs,
- active reusable operations knowledge applicable globally or to the relevant package/resource/site/leg.

Forbidden data:

- sales-only activity history,
- private ACT! notes not already exposed operationally,
- other legs' finances/routes/events,
- admin-only resource conflict notes,
- pricing/negotiation strategy unless explicitly part of the manager-facing booking data today.

### Steps

- [ ] **Step 1: Write adversarial repository/service tests** with Leg A and Leg B fixtures. Attempt to ask about a Leg B booking while authenticated as Leg A; expect not found/forbidden without revealing that Leg B record details exist.
- [ ] **Step 2: Test hand-edited booking/trip IDs** cannot widen scope.
- [ ] **Step 3: Test global operations knowledge is visible but another leg-scoped knowledge item is not.
- [ ] **Step 4: Implement repository by calling/reusing existing leg-scope query helpers where available.** Avoid duplicating portal authorization logic.
- [ ] **Step 5: Build `ManagerAssistantContextBundle` with bounded upcoming/current events and source refs.
- [ ] **Step 6: Run tests and commit.**

```bash
git add artifacts/api-server/src/features/manager-assistant
git commit -m "feat: build scoped manager assistant context"
```

## Task 4: Add deterministic Operations Assistant answers

### Supported first-release intents

Handle questions equivalent to:

- What time should we arrive / when is setup?
- Which equipment is assigned to this event?
- What packages are at this event?
- Does this event have water/site/setup requirements recorded?
- Do we have a forklift/load-out instruction recorded?
- Where is our next event?
- Is paintball assigned/transferring after this event?
- What handoffs/meetups are approved?
- What do I still need to acknowledge?
- What did admin say about this setup? from authorized operational instructions/knowledge.

If the requested detail is absent, answer should not transform absence into a “no.” Example: missing forklift note means “I don’t have a confirmed forklift instruction in the saved event information,” not “No forklift is needed.”

### Contract

```ts
export function answerManagerQuestionDeterministically(input: {
  question: string;
  context: ManagerAssistantContextBundle;
}): ManagerAssistantAnswer | null;
```

### Confidence rule

- high: direct structured field/approved operational record.
- medium: applicable reusable operations knowledge plus matching package/resource/site context.
- low/unsupported: do not provide a definitive operational answer; return `needsAdmin: true` through service orchestration.

### Steps

- [ ] **Step 1: Write supported-intent tests.**
- [ ] **Step 2: Write missing-data tests** proving “unknown” is not converted to “no.”
- [ ] **Step 3: Implement pure handlers.**
- [ ] **Step 4: Ensure source IDs match only rows in manager bundle.
- [ ] **Step 5: Commit.**

## Task 5: Add cloud manager question orchestration with mandatory uncertainty escalation

### Flow

`ManagerAssistantService.ask()`:

1. build scoped context from authenticated manager session,
2. try deterministic answer,
3. if direct answer exists at high/medium confidence, return it,
4. for a complex question and online/provider available, call existing AI client with only the scoped bundle,
5. require model JSON `{ text, confidence, sourceIds, answerable }`,
6. reject unknown source IDs,
7. if `answerable !== true`, no valid sources, confidence low, or operational answer cannot be supported, return a concise uncertainty response with `needsAdmin: true`,
8. never query broader CRM context as a fallback.

### Example escalation response

```ts
{
  text: "I don't have a confirmed forklift instruction for this event.",
  mode: "deterministic",
  confidence: "low",
  sources: [],
  needsAdmin: true,
  escalationReason: "No manager-visible event or operations record confirms the load-out equipment requirement."
}
```

### Steps

- [ ] **Step 1: Write fake-client service tests** for deterministic answer, safe cloud answer, malformed output, unknown sources, low confidence, provider unavailable.
- [ ] **Step 2: Write explicit security test** proving cloud prompt never contains a fixture's other-leg/private CRM text.
- [ ] **Step 3: Implement prompt with plain operational role instructions and no hidden reasoning request.
- [ ] **Step 4: Implement safe parser/escalation threshold.
- [ ] **Step 5: Commit.**

## Task 6: Add idempotent Admin Question repository/service

### Create input

```ts
export type CreateAdminQuestionInput = {
  clientMutationId: string;
  bookingId: string | null;
  tripId: string | null;
  question: string;
  urgency: "normal" | "urgent";
  escalationReason: string;
  checkedSourceRefs: AssistantSourceReference[];
};
```

The caller does **not** send `travelLegId`. Service derives it from manager session.

### Server create behavior

- validate any booking/trip belongs to authenticated leg,
- filter `checkedSourceRefs` against the manager context, never blindly store arbitrary references,
- build a small context snapshot containing event/leg labels/dates relevant to admin triage,
- insert using unique `clientMutationId`,
- on duplicate retry, return the existing same-leg question as success rather than creating another,
- if same mutation ID somehow belongs to another leg/subject, return conflict without exposing record data.

### Admin workflow

Repository/service methods:

```ts
listOpenAdminQuestions(): Promise<AdminQuestionSummary[]>
answerAdminQuestion(input: { questionId: string; actorId: string; body: string }): Promise<...>
resolveAdminQuestion(input: { questionId: string; actorId: string }): Promise<...>
addManagerQuestionFollowUp(...): Promise<...>
```

Answer changes status `needs_answer -> answered`; resolution changes `answered -> resolved`. A manager follow-up on an answered unresolved question may move it back to `needs_answer`.

### Steps

- [ ] **Step 1: Write repository idempotency test** with same mutation ID twice.
- [ ] **Step 2: Write cross-leg mutation collision test.**
- [ ] **Step 3: Write status transition tests.**
- [ ] **Step 4: Implement repository/service transactionally.
- [ ] **Step 5: If current manager notification service exists, create/emit the appropriate admin/manager notification through that service rather than a new notification table.
- [ ] **Step 6: Commit.**

## Task 7: Add manager/admin API routes

### Manager endpoints

- `GET /manager/assistant/context` with optional allowed booking/trip context ID.
- `POST /manager/assistant/ask`.
- `POST /manager/admin-questions`.
- `GET /manager/admin-questions` returning only that manager leg's questions.
- `POST /manager/admin-questions/:id/follow-up` if follow-ups are included in initial UI.

Use existing manager route prefix/session middleware conventions.

### Admin endpoints

- `GET /admin/manager-questions?status=...`
- `POST /admin/manager-questions/:id/answer`
- `POST /admin/manager-questions/:id/resolve`
- `POST /admin/manager-questions/:id/promote-knowledge`

Use current admin auth helper.

### Steps

- [ ] **Step 1: Write route tests** for manager auth, admin auth, input validation, Leg A/Leg B isolation, idempotent create, list scope, answer/resolve.
- [ ] **Step 2: Implement thin route handlers.**
- [ ] **Step 3: Verify response payloads never include full stored context snapshot fields not intended for manager UI after admin enrichment.
- [ ] **Step 4: Commit.**

## Task 8: Extend manager offline cache for assistant read context

Current manager IndexedDB contains the mutation store. Extend the same `adventure-zone-manager` database using a version upgrade rather than creating a second manager database.

### New store

`assistant_context` keyed by a context key:

```ts
export type CachedManagerAssistantContext = {
  key: string; // `${legId}:${kind}:${recordId}`
  legId: string;
  kind: ManagerAssistantContextKind;
  recordId: string;
  bundle: ManagerAssistantContextBundle;
  cachedAt: string;
};
```

### Requirements

- DB version upgrade creates store without deleting `mutations`.
- `clearManagerPrivateData(legId)` clears both mutations and assistant context for that leg.
- Manager switching/signout tests verify Leg B cannot read Leg A cache.
- Keep bounded retention: current leg + near-term event contexts; provide an eviction helper based on oldest `cachedAt` if cache exceeds a modest fixed count such as 50 contexts.

### Steps

- [ ] **Step 1: Write IndexedDB/memory adapter contract tests.**
- [ ] **Step 2: Update `manager-offline-db.ts` database version and stores.**
- [ ] **Step 3: Update private-data clear path.**
- [ ] **Step 4: Add cache read/write helper tests.**
- [ ] **Step 5: Commit.**

## Task 9: Queue Admin Questions offline using existing mutation queue

### Mutation shape

Use existing generic `ManagerMutation`:

```ts
{
  id: clientMutationId,
  legId: authenticatedLegId,
  method: "POST",
  path: "/manager/admin-questions",
  body: CreateAdminQuestionInput,
  createdAt,
}
```

The queue already idempotently ignores duplicate local IDs and retries; server uniqueness completes end-to-end idempotency.

### Steps

- [ ] **Step 1: Write queue test** creating Admin Question offline, flushing twice, and asserting one server create call or idempotent result.
- [ ] **Step 2: Test network failure -> `saved_offline` and later reconnect -> `synced`.
- [ ] **Step 3: Test 409 cross-leg/conflict -> `needs_attention` under existing queue semantics.
- [ ] **Step 4: Add helper `queueAdminQuestion(...)` around generic queue so UI does not hand-build paths/body repeatedly.
- [ ] **Step 5: Commit.**

## Task 10: Build persistent/contextual Manager Assistant UI

### Placement

- One persistent assistant launcher inside `ManagerShell`.
- Context defaults to current leg.
- Event/route pages can set active booking/trip context using a manager assistant context provider/hook.
- Do not add a separate top navigation page solely for AI.

### Drawer behavior

- Shows context label: `Leg 3`, `Morton County Fair`, etc.
- Shows connectivity state.
- Loads cached context immediately when offline/available.
- Shows suggested operational prompts based on current context.
- Renders sources in plain manager-visible terms only.
- If answer `needsAdmin`, show `Ask Admin` card prefilled with original question and escalation reason.

### Steps

- [ ] **Step 1: Write ManagerShell launcher tests.**
- [ ] **Step 2: Write context-switch tests for manager home -> event -> route.
- [ ] **Step 3: Write `needsAdmin` UI test** proving button/card appears only when appropriate.
- [ ] **Step 4: Implement components mobile-first.**
- [ ] **Step 5: Wire event/route context without duplicating page data loads where existing query results can supply labels/IDs.
- [ ] **Step 6: Commit.**

## Task 11: Build Ask Admin online/offline UX

### Form

Prefill:

- original question,
- context event/leg label,
- assistant explanation of what is missing.

Manager can:

- edit the question text before sending,
- choose normal/urgent,
- submit.

Do not let manager edit the hidden leg association.

### States

- `Sending…`
- `Sent to admin`
- `Saved offline — will send when connected`
- `Needs attention` if queue reports conflict/permanent problem.

### Steps

- [ ] **Step 1: Write online submission test.**
- [ ] **Step 2: Write offline queue UI test.**
- [ ] **Step 3: Implement mutation helper integration.
- [ ] **Step 4: Add manager question status cards** to assistant drawer or existing Messages/Operations area so answered questions can be found again.
- [ ] **Step 5: Commit.**

## Task 12: Integrate Admin Questions into Manager Communications admin

### UI

Add a clear `Questions` section/tab/card within `ManagerCommunicationsAdminPage`, reusing the page's current communication layout. Show:

- urgent first,
- needs answer,
- answered awaiting resolution,
- resolved history behind a filter.

Question review shows:

- manager/leg,
- event/booking link,
- original question,
- context snapshot,
- what assistant checked,
- escalation reason,
- response history.

Admin actions:

- Answer
- Answer & resolve
- Mark resolved
- Save answer as reusable knowledge

### Steps

- [ ] **Step 1: Write admin review component tests** for status/urgency ordering and answer submission.
- [ ] **Step 2: Implement component and route data hook.**
- [ ] **Step 3: Keep existing messages/acknowledgment workflows intact; do not merge question rows into chat-message storage.
- [ ] **Step 4: Add notification/badge if existing admin communication page already has a compatible badge mechanism; otherwise keep the initial implementation inside the page rather than inventing a global notification system.
- [ ] **Step 5: Commit.**

## Task 13: Add explicit reusable operations knowledge promotion

### Promotion input

```ts
{
  questionId: string,
  title: string,
  body: string,
  scope: "global" | "package" | "resource" | "site" | "leg",
  scopeRecordId: string | null,
  effectiveAt: string,
  reviewAfter: string | null,
}
```

Admin sees the answered text prefilled but must explicitly submit.

### Rules

- Global scope requires no record ID.
- Package/resource/site/leg scopes require an existing valid matching record.
- Promoting creates a knowledge row; it does not alter the historical question/answer.
- Re-promoting same question is allowed only deliberately if entries have different scopes; avoid accidental duplicate exact entries via service validation/fingerprint.
- Deactivated/expired-by-review-policy entries do not appear as authoritative manager knowledge. `reviewAfter` should cause a “needs review” admin signal, not automatically delete history.

### Steps

- [ ] **Step 1: Write promotion validation/repository tests.**
- [ ] **Step 2: Implement repository/service.
- [ ] **Step 3: Add admin promotion form/dialog.
- [ ] **Step 4: Add manager context tests** proving matching scoped knowledge is retrieved and unrelated scope is not.
- [ ] **Step 5: Commit.**

## Task 14: Return answers to managers and preserve canonical operational-change semantics

### Behavior

- Manager question list/drawer polls/refetches or uses current app refresh pattern for answered status.
- Admin answer is visible as response history.
- If admin answer says a schedule/equipment value has changed, the text alone does not change canonical data.
- When admin separately changes booking/route/resource data, existing acknowledgment system creates/handles the official change notice.

### Steps

- [ ] **Step 1: Write integration test**: question answered -> manager can read answer.
- [ ] **Step 2: Write regression test** proving answering a question does not update booking date/resource assignment.
- [ ] **Step 3: If an existing manager notification service is available, notify manager on answer; otherwise rely on visible answered state/refetch in this release and document the UI behavior.
- [ ] **Step 4: Commit.**

## Task 15: Optional local browser-model adapter, behind capability detection

This task is optional for Release 3 acceptance. Core offline behavior already works through cached deterministic context. Implement only after all prior tasks pass.

### Boundary

Create a single frontend adapter:

`artifacts/adventure-zone/src/features/assistant/local-assistant-runtime.ts`

```ts
export interface LocalAssistantRuntime {
  isSupported(): Promise<boolean>;
  isModelAvailable(): Promise<boolean>;
  downloadModel(onProgress: (progress: number) => void): Promise<void>;
  complete(input: { prompt: string; maxTokens: number }): Promise<string>;
}
```

### Rules

- Do not hardwire model download into app startup.
- User/admin explicitly opts in to download.
- If browser/device unsupported, hide/disable local-model option and continue deterministic offline mode.
- Model output receives only already manager-scoped cached context.
- Local model may rephrase/summarize deterministic facts but must not turn low-confidence missing information into a definitive operational answer.
- Do not bundle gigabytes in the application build.

### Implementation selection

Before adding a library, verify a currently maintained browser local-inference option against the target browsers and project bundler. Record the chosen library/model and size in a short implementation note. If no acceptable option meets mobile/device constraints, skip this task; deterministic offline mode remains the supported release behavior.

### Steps

- [ ] **Step 1: Add adapter contract tests with fake runtime.**
- [ ] **Step 2: Add capability/opt-in UI tests.**
- [ ] **Step 3: Implement one adapter only if current technical verification passes.
- [ ] **Step 4: Add a clear storage/download warning before model download.
- [ ] **Step 5: Run mobile/browser build verification.
- [ ] **Step 6: Commit separately so the optional runtime can be reverted without touching core manager assistant behavior.**

## Task 16: Release verification

- [ ] Run manager assistant unit/service/route tests.
- [ ] Run manager auth/scope regression tests.
- [ ] Run manager offline DB/sync queue tests.
- [ ] Run existing messages/acknowledgment/meetup tests.
- [ ] Run schema/migration tests.
- [ ] Run:

```bash
pnpm run typecheck
pnpm run build
```

- [ ] Manual adversarial checks:
  1. Leg A asks about its event and receives valid package/equipment/setup details.
  2. Leg A manually changes a booking ID in a request to Leg B's booking and receives no Leg B data.
  3. Missing forklift instruction produces uncertainty + Ask Admin, not “no forklift needed.”
  4. Manager goes offline, submits Ask Admin, sees saved-offline state.
  5. Reconnect flushes it once; refreshing/retrying does not duplicate the server row.
  6. Admin sees correct leg/event/context and answers.
  7. Manager sees answer.
  8. Answer alone does not mutate route/booking/equipment.
  9. Admin promotes a generic answer to operations knowledge explicitly.
  10. New matching event can use that knowledge; unrelated leg/scope cannot.
  11. Sign out/leg switch clears prior leg assistant cache.
  12. If optional local model is not installed/supported, all core portal/assistant workflows still work.

- [ ] Review logs to ensure manager-scoped prompts/context are not unnecessarily emitted.
- [ ] Review `git diff main...HEAD` for unrelated changes.

## Release completion

Open a PR from `feature/manager-assistant-admin-questions` to `main`. The three-release packages/assistant roadmap is complete after this PR passes its exit gate and the cross-release acceptance checklist in `2026-08-17-packages-assistants-master.md`.
