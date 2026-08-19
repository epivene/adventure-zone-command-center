# Guided Calling Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing assisted-calling workspace into a Five9-style guided console where one Today phone action launches the call and correct workspace, presents a context-aware briefing, guides the conversation through deterministic clickable branches, stages CRM suggestions, and lets the administrator save unresolved questions to a Needs Answer queue.

**Architecture:** Keep the existing call workspace, call completion service, Today queue, phone launcher, and assistant service authoritative. Add focused deterministic briefing/script units around the current workspace query, client-side guided-call state that only stages suggestions, a thin call-context adapter around the existing assistant service, and one small persistence model for unresolved Needs Answer items. Do not introduce a second calling subsystem or a second AI backend.

**Tech Stack:** TypeScript 5.9, React 19, Vite, Wouter, Express 5, PostgreSQL, Drizzle ORM, Zod 4, Tailwind CSS, Vitest 4, Testing Library, Supertest, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-08-19-guided-calling-console-design.md`

## Global Constraints

- Extend the existing assisted calling subsystem; do not create a parallel calling flow.
- A Today phone click may open/select the workspace and launch the phone handler, but must not create or complete a call record.
- The browser must never claim it can detect whether Phone Link connected, answered, or ended a call.
- Structured CRM/business data is preferred over AI interpretation for the call briefing and script selection.
- The branching script engine is deterministic and must not invent pricing, package contents, availability, contractual promises, legal commitments, or policy.
- Script branches may stage suggested outcome, next action, follow-up timing, note fragments, and missing facts; nothing is persisted until the existing Save/Complete Call action succeeds.
- Existing manual notes, call history, idempotent completion, follow-up creation, draft recovery, multiple phone numbers, extensions, number-level Do Not Call suppression, organization-level Last Resort behavior, and Phone Link / `tel:` launching must remain intact.
- Reuse the existing assistant service and trusted Adventure Zone/package/CRM context; do not add a second AI backend.
- The user is the administrator. Unresolved questions are saved to **Needs Answer**; no `send to admin` action or second admin escalation role exists.
- No call recording or live audio transcription is added in this release.
- Keep desktop controls keyboard-accessible and mobile response controls comfortably touch-sized.

---

## File map

### API / calling domain

- `artifacts/api-server/src/features/calls/call-briefing.ts` — deterministic reason/headline/key-fact assembly.
- `artifacts/api-server/src/features/calls/call-briefing.test.ts` — reason selection and bounded fact tests.
- `artifacts/api-server/src/features/calls/call-script.ts` — extend script-kind selection to rebooking/callback and return the recommended guided kind.
- `artifacts/api-server/src/features/calls/call-script.test.ts` — guided kind selection tests.
- `artifacts/api-server/src/features/calls/call-types.ts` — briefing and recommended script DTOs.
- `artifacts/api-server/src/features/calls/call-workspace-query.ts` — include briefing and guided script kind in the existing workspace payload.
- `artifacts/api-server/src/features/calls/call-workspace-query.test.ts` — enriched payload and backward-compatibility tests.
- `artifacts/api-server/src/routes/calls.ts` — expose existing workspace data plus call-context assistant endpoint.
- `artifacts/api-server/src/routes/calls.test.ts` — HTTP behavior tests.

### API / assistant and Needs Answer

- `artifacts/api-server/src/features/assistant/call-assistant.ts` — trusted call-context adapter over the existing assistant service.
- `artifacts/api-server/src/features/assistant/call-assistant.test.ts` — known-answer, unresolved, and no-invention boundary tests.
- `lib/db/src/schema/index.ts` — Needs Answer table/status enum.
- `lib/db/migrations/0XX_guided_call_needs_answer.sql` — additive Needs Answer migration; choose the next unused migration number at execution time and register it immediately after the current latest migration.
- `lib/db/src/migrations.ts` — register the migration under the same numeric ID chosen above.
- `artifacts/api-server/src/features/needs-answer/needs-answer-types.ts` — DTOs and status contract.
- `artifacts/api-server/src/features/needs-answer/needs-answer-repository.ts` — create/list/resolve persistence.
- `artifacts/api-server/src/features/needs-answer/needs-answer-repository.test.ts` — context and resolution tests.
- `artifacts/api-server/src/routes/needs-answer.ts` — list/create/resolve endpoints.
- `artifacts/api-server/src/routes/needs-answer.test.ts` — API tests.
- `artifacts/api-server/src/app.ts` — register Needs Answer routes if routes are registered centrally here.

### Web / guided calling

- `artifacts/adventure-zone/src/features/calls/call-types.ts` — web briefing/guided-script contract.
- `artifacts/adventure-zone/src/features/calls/guided-call-scripts.ts` — deterministic script definitions, validation, placeholder rendering, branch lookup.
- `artifacts/adventure-zone/src/features/calls/guided-call-scripts.test.ts` — complete graph validation and personalization tests.
- `artifacts/adventure-zone/src/features/calls/guided-call-state.ts` — current path and staged CRM suggestion state.
- `artifacts/adventure-zone/src/features/calls/guided-call-state.test.ts` — branch/staging/reset tests.
- `artifacts/adventure-zone/src/components/calls/call-briefing-card.tsx` — Why you're calling + quick context.
- `artifacts/adventure-zone/src/components/calls/guided-call-script-card.tsx` — prompt, coaching, response buttons, manual selector.
- `artifacts/adventure-zone/src/components/calls/guided-call-script-card.test.tsx` — branch interaction and unsaved suggestion tests.
- `artifacts/adventure-zone/src/components/calls/call-assistant-panel.tsx` — Ask Assistant / Save to Needs Answer UI.
- `artifacts/adventure-zone/src/components/calls/call-assistant-panel.test.tsx` — answer and unresolved workflows.
- `artifacts/adventure-zone/src/components/calls/call-workspace.tsx` — integrate briefing, script, staged suggestions, assistant, notes/outcomes/history in the approved order.
- `artifacts/adventure-zone/src/components/calls/call-workspace.test.tsx` — full shared-workspace behavior.
- `artifacts/adventure-zone/src/components/today/next-call-card.tsx` — compact phone icon/button where this component represents an actionable Today call item.
- `artifacts/adventure-zone/src/components/today/call-queue-workspace.tsx` — coordinate selected context + launcher from the same click.
- `artifacts/adventure-zone/src/components/today/call-queue-workspace.test.tsx` — one-click launch/open and no-save tests.
- `artifacts/adventure-zone/src/features/assistant/assistant-api.ts` — add call-context assistant and Needs Answer client calls or split Needs Answer into its own focused API file if existing conventions require it.
- `artifacts/adventure-zone/src/features/assistant/assistant-api.test.ts` — client contract tests.
- `artifacts/adventure-zone/src/pages/NeedsAnswerPage.tsx` — administrator queue with open/resolved items.
- `artifacts/adventure-zone/src/pages/NeedsAnswerPage.test.tsx` — resolve flow tests.
- `artifacts/adventure-zone/src/App.tsx` — add `/needs-answer` route.

---

### Task 1: Add deterministic call briefings to the existing workspace payload

**Files:**
- Create: `artifacts/api-server/src/features/calls/call-briefing.ts`
- Create: `artifacts/api-server/src/features/calls/call-briefing.test.ts`
- Modify: `artifacts/api-server/src/features/calls/call-script.ts`
- Modify: `artifacts/api-server/src/features/calls/call-script.test.ts`
- Modify: `artifacts/api-server/src/features/calls/call-types.ts`
- Modify: `artifacts/api-server/src/features/calls/call-workspace-query.ts`
- Modify: `artifacts/api-server/src/features/calls/call-workspace-query.test.ts`
- Modify: `artifacts/adventure-zone/src/features/calls/call-types.ts`

**Interfaces:**
- Consumes: existing `CallWorkspaceContext`, recent call/activity history, originating follow-up, booking/contact status, event/location/leg/package fields already assembled by `call-workspace-query.ts`.
- Produces:

```ts
export type GuidedCallScriptKind =
  | "first_outreach"
  | "rebooking"
  | "follow_up"
  | "proposal_contract"
  | "callback"
  | "incoming_inquiry";

export type CallBriefing = {
  reason: GuidedCallScriptKind;
  headline: string;
  status: string | null;
  eventName: string | null;
  eventDate: string | null;
  location: string | null;
  routeLeg: string | null;
  packageInterest: string | null;
  lastContactedAt: string | null;
  lastOutcome: string | null;
  keyFacts: string[];
  historySummary: string | null;
};

export function buildCallBriefing(input: CallBriefingInput): CallBriefing;
export function selectGuidedCallScriptKind(input: CallScriptSelectionInput): GuidedCallScriptKind;
```

- [ ] **Step 1: Write failing briefing tests for every required reason**

```ts
it.each([
  [{ priorCompletedCallCount: 0, callbackRequested: false, proposalPending: false, incoming: false }, "first_outreach"],
  [{ priorCompletedCallCount: 2, priorBookedEvent: true, callbackRequested: false, proposalPending: false, incoming: false }, "rebooking"],
  [{ priorCompletedCallCount: 1, callbackRequested: false, proposalPending: false, incoming: false }, "follow_up"],
  [{ priorCompletedCallCount: 1, callbackRequested: false, proposalPending: true, incoming: false }, "proposal_contract"],
  [{ priorCompletedCallCount: 1, callbackRequested: true, proposalPending: false, incoming: false }, "callback"],
  [{ priorCompletedCallCount: 0, callbackRequested: false, proposalPending: false, incoming: true }, "incoming_inquiry"],
])("selects %s", (input, expected) => {
  expect(selectGuidedCallScriptKind(input as CallScriptSelectionInput)).toBe(expected);
});

it("keeps key facts bounded and prioritizes call-relevant structured facts", () => {
  const briefing = buildCallBriefing(makeBriefingInput({
    packageInterest: "Adventure Zone",
    routeLeg: "Leg 3",
    eventDate: "2027-07-04",
    location: "Bismarck, ND",
    extraFacts: Array.from({ length: 20 }, (_, i) => `extra-${i}`),
  }));

  expect(briefing.keyFacts.length).toBeLessThanOrEqual(6);
  expect(briefing.keyFacts.join(" ")).toContain("Adventure Zone");
  expect(briefing.keyFacts.join(" ")).toContain("Leg 3");
});
```

- [ ] **Step 2: Run focused tests and verify they fail before the briefing unit exists**

Run:

```bash
pnpm --filter @workspace/api-server test -- src/features/calls/call-briefing.test.ts src/features/calls/call-script.test.ts
```

Expected: FAIL because `call-briefing.ts` and the guided script kinds are not implemented.

- [ ] **Step 3: Implement the deterministic briefing and script-kind selection**

Implement explicit priority in this order: incoming inquiry → callback → proposal/contract → prior booked/rebooking → first outreach → general follow-up. Build `keyFacts` from structured fields first, deduplicate strings, and cap the output at six facts. Build `historySummary` only from existing trusted summary/history text supplied to the function; return `null` when there is no usable source text.

```ts
const MAX_KEY_FACTS = 6;

export function selectGuidedCallScriptKind(input: CallScriptSelectionInput): GuidedCallScriptKind {
  if (input.incoming) return "incoming_inquiry";
  if (input.callbackRequested) return "callback";
  if (input.proposalPending) return "proposal_contract";
  if (input.priorBookedEvent) return "rebooking";
  if (input.priorCompletedCallCount === 0) return "first_outreach";
  return "follow_up";
}
```

- [ ] **Step 4: Enrich the existing workspace query without breaking old consumers**

Add `briefing` and `recommendedGuidedScriptKind` to the existing workspace response. Keep all current fields unchanged. If optional data needed for the briefing is unavailable, return a partial briefing rather than failing the whole workspace request.

- [ ] **Step 5: Add workspace-query regression tests**

```ts
it("includes a briefing and guided script recommendation", async () => {
  const workspace = await query.load(makeWorkspaceRequest());
  expect(workspace.briefing).toEqual(expect.objectContaining({
    headline: expect.any(String),
    keyFacts: expect.any(Array),
  }));
  expect(workspace.recommendedGuidedScriptKind).toBe("follow_up");
});

it("preserves existing workspace fields when optional guided context is missing", async () => {
  const workspace = await query.load(makeWorkspaceRequest({ bookingId: null, eventId: null }));
  expect(workspace.contact).toBeTruthy();
  expect(workspace.phones).toBeTruthy();
  expect(workspace.briefing).toBeTruthy();
});
```

- [ ] **Step 6: Run focused API tests and web typecheck**

Run:

```bash
pnpm --filter @workspace/api-server test -- src/features/calls/call-briefing.test.ts src/features/calls/call-script.test.ts src/features/calls/call-workspace-query.test.ts && pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the briefing foundation**

```bash
git add artifacts/api-server/src/features/calls artifacts/adventure-zone/src/features/calls/call-types.ts
git commit -m "feat: add guided call briefings"
```

---

### Task 2: Build and validate the deterministic branching script engine

**Files:**
- Create: `artifacts/adventure-zone/src/features/calls/guided-call-scripts.ts`
- Create: `artifacts/adventure-zone/src/features/calls/guided-call-scripts.test.ts`
- Create: `artifacts/adventure-zone/src/features/calls/guided-call-state.ts`
- Create: `artifacts/adventure-zone/src/features/calls/guided-call-state.test.ts`

**Interfaces:**
- Consumes: Task 1 `GuidedCallScriptKind`, trusted workspace placeholder values, existing call disposition and next-action value types.
- Produces:

```ts
export type GuidedCallSuggestion = {
  disposition?: string;
  nextAction?: string;
  followUpPreset?: "later_today" | "tomorrow" | "next_week" | "next_season";
  noteFragment?: string;
  collect?: Array<"event_date" | "location" | "attendance" | "package_interest" | "decision_maker">;
};

export type GuidedCallResponse = {
  id: string;
  label: string;
  nextNodeId: string | null;
  terminal?: boolean;
  suggestion?: GuidedCallSuggestion;
};

export type GuidedCallNode = {
  id: string;
  say: string;
  coach?: string;
  responses: GuidedCallResponse[];
};

export type GuidedCallScript = {
  kind: GuidedCallScriptKind;
  label: string;
  startNodeId: string;
  nodes: Record<string, GuidedCallNode>;
};

export function getGuidedCallScript(kind: GuidedCallScriptKind): GuidedCallScript;
export function validateGuidedCallScript(script: GuidedCallScript): string[];
export function renderGuidedText(text: string, context: GuidedCallRenderContext): string;
export function createGuidedCallState(script: GuidedCallScript): GuidedCallState;
export function chooseGuidedResponse(state: GuidedCallState, responseId: string): GuidedCallState;
```

- [ ] **Step 1: Write graph-validation tests before defining scripts**

```ts
it.each(GUIDED_CALL_SCRIPT_KINDS)("has a valid branch graph for %s", (kind) => {
  expect(validateGuidedCallScript(getGuidedCallScript(kind))).toEqual([]);
});

it("does not give a cold-call opening to a rebooking script", () => {
  const script = getGuidedCallScript("rebooking");
  expect(script.nodes[script.startNodeId].say.toLowerCase()).not.toContain("calling to introduce");
});

it("does not restart discovery in the proposal/contract script", () => {
  const script = getGuidedCallScript("proposal_contract");
  expect(script.nodes[script.startNodeId].responses.map((r) => r.label)).not.toContain("What event are you planning?");
});
```

- [ ] **Step 2: Run tests and verify the engine is missing**

Run:

```bash
pnpm --filter @workspace/adventure-zone test -- src/features/calls/guided-call-scripts.test.ts src/features/calls/guided-call-state.test.ts
```

Expected: FAIL with missing module/import errors.

- [ ] **Step 3: Define the six initial script families with safe branches**

Each script must have a stable start node plus common response paths including, where relevant: `Interested`, `Need pricing`, `Already booked`, `Send information`, `Call back later`, `Not interested`, and `Wrong person`. Pricing wording must only direct the user to stored package/pricing information; it must not embed invented dollar values in the script engine.

Required `Already booked` branch behavior for outreach/rebooking scripts:

```ts
{
  id: "already-booked",
  label: "Already booked",
  nextNodeId: "already-booked-this-year",
}
```

The follow-up node asks whether this applies only to the current event/year. A `Yes, just this year` response stages a future-season follow-up rather than a permanent decline.

- [ ] **Step 4: Implement placeholder rendering with an allowlist**

Only support known tokens such as `{{firstName}}`, `{{eventName}}`, `{{eventDate}}`, `{{packageInterest}}`, and `{{organizationName}}`. Missing values render as a neutral fallback or remove the optional phrase; they must never become the literal text `undefined` or `null`.

- [ ] **Step 5: Write guided-state tests proving suggestions are staged only**

```ts
it("advances a branch and stages a callback suggestion without persisting anything", () => {
  const script = getGuidedCallScript("follow_up");
  const state = createGuidedCallState(script);
  const next = chooseGuidedResponse(state, "call-back-later");

  expect(next.currentNodeId).not.toBe(state.currentNodeId);
  expect(next.stagedSuggestion).toEqual(expect.objectContaining({ nextAction: expect.any(String) }));
  expect(next.persisted).toBeUndefined();
});
```

- [ ] **Step 6: Run the guided engine tests**

Run:

```bash
pnpm --filter @workspace/adventure-zone test -- src/features/calls/guided-call-scripts.test.ts src/features/calls/guided-call-state.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the script engine**

```bash
git add artifacts/adventure-zone/src/features/calls/guided-call-scripts.ts artifacts/adventure-zone/src/features/calls/guided-call-scripts.test.ts artifacts/adventure-zone/src/features/calls/guided-call-state.ts artifacts/adventure-zone/src/features/calls/guided-call-state.test.ts
git commit -m "feat: add guided call script engine"
```

---

### Task 3: Add briefing and branching-script UI with staged CRM suggestions

**Files:**
- Create: `artifacts/adventure-zone/src/components/calls/call-briefing-card.tsx`
- Create: `artifacts/adventure-zone/src/components/calls/guided-call-script-card.tsx`
- Create: `artifacts/adventure-zone/src/components/calls/guided-call-script-card.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/calls/call-workspace.tsx`
- Modify: `artifacts/adventure-zone/src/components/calls/call-workspace.test.tsx`
- Modify: `artifacts/adventure-zone/src/features/calls/call-draft.ts`
- Modify: `artifacts/adventure-zone/src/features/calls/call-draft.test.ts`

**Interfaces:**
- Consumes: Task 1 `briefing` + `recommendedGuidedScriptKind`; Task 2 scripts/state; existing call draft fields, disposition controls, follow-up controls, notes editor.
- Produces: shared workspace sections for `Why you're calling`, guided script, staged suggestions, and manual script selection; draft fields `guidedScriptKind`, `guidedNodeId`, and `stagedGuidedSuggestion`.

- [ ] **Step 1: Write component tests for branch advancement and non-persistence**

```tsx
it("shows the recommended opening and advances when a caller response is clicked", async () => {
  render(<GuidedCallScriptCard kind="first_outreach" context={context} onSuggestion={onSuggestion} />);
  expect(screen.getByText(/calling/i)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Need pricing" }));
  expect(screen.getByText(/package/i)).toBeInTheDocument();
});

it("marks staged suggestions without calling save", async () => {
  render(<CallWorkspace {...workspaceProps} onComplete={onComplete} />);
  await user.click(screen.getByRole("button", { name: "Call back later" }));
  expect(screen.getByText(/Suggested/i)).toBeInTheDocument();
  expect(onComplete).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
pnpm --filter @workspace/adventure-zone test -- src/components/calls/guided-call-script-card.test.tsx src/components/calls/call-workspace.test.tsx
```

Expected: FAIL because the new components and staged behavior are missing.

- [ ] **Step 3: Implement `CallBriefingCard` with bounded Quick Facts**

Render headline, status, event date/location, route leg, package interest, last contact/outcome, up to six key facts, and a concise history summary. Omit empty rows instead of showing placeholder noise.

- [ ] **Step 4: Implement the guided script card**

Render the current `say` text prominently, `coach` as visually secondary text, and each `responses[]` item as a large tappable button. Include a manual script selector populated with the six script kinds and a `Use manual notes` action that leaves notes/outcome controls fully usable.

- [ ] **Step 5: Stage suggestions into existing controls without overwriting manual edits**

When a response suggests an outcome/follow-up/note fragment, visually mark it as `Suggested`. Apply it only when the corresponding user field is still blank or still contains the previous suggestion. If the user manually edits a field, later branches must not silently overwrite that manual value.

- [ ] **Step 6: Extend draft recovery for guided state**

Add the script kind, current node ID, and staged suggestion to the existing local draft serialization. Restore them after refresh under the same existing call-context draft key and clear them only under the same conditions that already clear the rest of the call draft.

- [ ] **Step 7: Run component and draft tests**

Run:

```bash
pnpm --filter @workspace/adventure-zone test -- src/components/calls/guided-call-script-card.test.tsx src/components/calls/call-workspace.test.tsx src/features/calls/call-draft.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the guided workspace UI**

```bash
git add artifacts/adventure-zone/src/components/calls artifacts/adventure-zone/src/features/calls/call-draft.ts artifacts/adventure-zone/src/features/calls/call-draft.test.ts
git commit -m "feat: guide calls with branching scripts"
```

---

### Task 4: Make the Today phone action open the correct workspace and launch the call in one gesture

**Files:**
- Modify: `artifacts/adventure-zone/src/components/today/next-call-card.tsx`
- Modify: `artifacts/adventure-zone/src/components/today/call-queue-workspace.tsx`
- Modify: `artifacts/adventure-zone/src/components/today/call-queue-workspace.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.tsx`
- Reuse: `artifacts/adventure-zone/src/features/calls/phone-launcher.ts`

**Interfaces:**
- Consumes: existing queue-item context IDs, selectable phone records, `phone-launcher.ts` call behavior, shared `CallWorkspace`.
- Produces:

```ts
export type StartGuidedCallInput = {
  queueItemId: string;
  contactId: string;
  eventId?: string | null;
  followUpId?: string | null;
  phoneId?: string | null;
};
```

The handler must set selected workspace context and invoke the phone launcher exactly once from the user's click.

- [ ] **Step 1: Write failing workflow tests for the single-click contract**

```tsx
it("opens the matching workspace and invokes the launcher once", async () => {
  render(<CallQueueWorkspace items={[queueItem]} launchPhone={launchPhone} />);
  await user.click(screen.getByRole("button", { name: /call .*Acme Festival/i }));

  expect(launchPhone).toHaveBeenCalledTimes(1);
  expect(launchPhone).toHaveBeenCalledWith(expect.objectContaining({ phoneId: queueItem.primaryPhoneId }));
  expect(await screen.findByText(queueItem.contactName)).toBeInTheDocument();
});

it("does not complete a call when the Today phone button is clicked", async () => {
  render(<CallQueueWorkspace items={[queueItem]} launchPhone={launchPhone} onComplete={onComplete} />);
  await user.click(screen.getByRole("button", { name: /call/i }));
  expect(onComplete).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the Today workspace test and verify failure**

Run:

```bash
pnpm --filter @workspace/adventure-zone test -- src/components/today/call-queue-workspace.test.tsx
```

Expected: FAIL because direct guided-call launching is not yet wired.

- [ ] **Step 3: Add the compact Today phone control**

Use an actual button with a phone icon plus an accessible label/title such as `Call Acme Festival`. Show it only when the item has a callable, non-suppressed number. Do not require opening the full profile first.

- [ ] **Step 4: Coordinate selection and launch from the same handler**

On click, synchronously store the selected queue/contact/event/follow-up/phone context and invoke the existing phone launcher. The workspace load may continue asynchronously. If launch fails or the handler is blocked, keep the workspace selected so Copy Number and the number selector remain usable.

- [ ] **Step 5: Preserve number-level Do Not Call and multi-number behavior**

Do not expose a direct call button for a suppressed number. If multiple callable numbers exist and there is no unambiguous selected primary number, open the workspace first and let the existing number selector choose rather than launching an arbitrary number.

- [ ] **Step 6: Run Today/component tests**

Run:

```bash
pnpm --filter @workspace/adventure-zone test -- src/components/today/call-queue-workspace.test.tsx src/components/calls/call-workspace.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit one-click guided calling**

```bash
git add artifacts/adventure-zone/src/components/today artifacts/adventure-zone/src/pages/TodayPage.tsx
git commit -m "feat: start guided calls from today"
```

---

### Task 5: Add a trusted call-context Ask Assistant adapter

**Files:**
- Create: `artifacts/api-server/src/features/assistant/call-assistant.ts`
- Create: `artifacts/api-server/src/features/assistant/call-assistant.test.ts`
- Modify: `artifacts/api-server/src/routes/calls.ts`
- Modify: `artifacts/api-server/src/routes/calls.test.ts`
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-api.ts`
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-api.test.ts`

**Interfaces:**
- Consumes: existing `assistant-service.ts`, deterministic answers/business/package context, current call workspace contact/event/organization identifiers and trusted context.
- Produces:

```ts
export type CallAssistantRequest = {
  question: string;
  contactId: string;
  organizationId?: string | null;
  eventId?: string | null;
  callSessionId?: string | null;
  followUpId?: string | null;
};

export type CallAssistantResult =
  | { kind: "answer"; answer: string; sources: string[] }
  | { kind: "needs_answer"; reason: string };

export async function answerCallQuestion(input: CallAssistantRequest): Promise<CallAssistantResult>;
```

- [ ] **Step 1: Write boundary tests before implementing the adapter**

```ts
it("answers from trusted package/business context when available", async () => {
  const result = await answerCallQuestion(makeCallQuestion("How many attractions are in Adventure Zone?"));
  expect(result.kind).toBe("answer");
});

it("returns needs_answer instead of inventing an unknown price", async () => {
  const result = await answerCallQuestion(makeCallQuestion("Can I promise them a price that is not stored anywhere?"));
  expect(result).toEqual(expect.objectContaining({ kind: "needs_answer" }));
});

it("never returns an admin escalation action", async () => {
  const result = await answerCallQuestion(makeCallQuestion("Something unknown"));
  expect(JSON.stringify(result).toLowerCase()).not.toContain("send to admin");
});
```

- [ ] **Step 2: Run focused assistant tests and verify failure**

Run:

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/call-assistant.test.ts
```

Expected: FAIL because the call adapter does not exist.

- [ ] **Step 3: Implement a thin context adapter around the existing assistant service**

Pass only the relevant contact/event/organization and approved business/package sources into the existing assistant service. Require a positive trusted-answer result; convert low-confidence/no-grounding cases to `{ kind: "needs_answer" }`. Do not create another provider/client instance.

- [ ] **Step 4: Expose the call-context assistant route**

Add `POST /api/calls/assistant` (or the existing calls router's equivalent base path) with Zod validation for a nonblank question and UUID/context fields. Return 200 for both `answer` and `needs_answer`; reserve 4xx/5xx for malformed requests or actual service failures.

- [ ] **Step 5: Add the web API client contract**

Implement `askCallAssistant(input: CallAssistantRequest)` using the same fetch/client conventions already used in `assistant-api.ts`.

- [ ] **Step 6: Run API and client tests**

Run:

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/call-assistant.test.ts src/routes/calls.test.ts && pnpm --filter @workspace/adventure-zone test -- src/features/assistant/assistant-api.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit call-context Assistant support**

```bash
git add artifacts/api-server/src/features/assistant/call-assistant.ts artifacts/api-server/src/features/assistant/call-assistant.test.ts artifacts/api-server/src/routes/calls.ts artifacts/api-server/src/routes/calls.test.ts artifacts/adventure-zone/src/features/assistant/assistant-api.ts artifacts/adventure-zone/src/features/assistant/assistant-api.test.ts
git commit -m "feat: add call context assistant"
```

---

### Task 6: Persist unresolved questions in an administrator-owned Needs Answer queue

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/0XX_guided_call_needs_answer.sql` using the next unused numeric prefix found on the branch during execution.
- Modify: `lib/db/src/migrations.ts`
- Create: `artifacts/api-server/src/features/needs-answer/needs-answer-types.ts`
- Create: `artifacts/api-server/src/features/needs-answer/needs-answer-repository.ts`
- Create: `artifacts/api-server/src/features/needs-answer/needs-answer-repository.test.ts`
- Create: `artifacts/api-server/src/routes/needs-answer.ts`
- Create: `artifacts/api-server/src/routes/needs-answer.test.ts`
- Modify: `artifacts/api-server/src/app.ts` if route registration occurs there.

**Interfaces:**
- Consumes: contact/event/organization/call/follow-up IDs that already exist; authenticated current user where route conventions expose it.
- Produces:

```ts
export const needsAnswerStatusValues = ["open", "resolved"] as const;
export type NeedsAnswerStatus = (typeof needsAnswerStatusValues)[number];

export type NeedsAnswerRecord = {
  id: string;
  question: string;
  contactId: string | null;
  organizationId: string | null;
  eventId: string | null;
  callSessionId: string | null;
  followUpId: string | null;
  userNote: string | null;
  status: NeedsAnswerStatus;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
};
```

- [ ] **Step 1: Inspect the migration registry and choose the next unused migration number**

Run:

```bash
ls lib/db/migrations | sort | tail -20
grep -n "migration" lib/db/src/migrations.ts | tail -20
```

Expected: identify one numeric prefix that is unused on `feature/guided-calling-console`. Rename the planned file from `0XX_guided_call_needs_answer.sql` to that exact prefix and use that same ID in `migrations.ts`.

- [ ] **Step 2: Write failing repository tests for context retention and resolution**

```ts
it("creates an open item with call context", async () => {
  const item = await repository.create({
    question: "Can we support this unusual venue requirement?",
    contactId,
    organizationId,
    eventId,
    callSessionId: null,
    followUpId,
    userNote: "Asked while I was on the phone",
  }, now);

  expect(item).toMatchObject({ status: "open", contactId, organizationId, eventId, followUpId });
});

it("resolves an item without deleting its original question/context", async () => {
  const resolved = await repository.resolve(itemId, "Yes; use the standard setup rule.", now);
  expect(resolved).toMatchObject({ status: "resolved", resolution: "Yes; use the standard setup rule." });
  expect(resolved.question).toBe(originalQuestion);
});
```

- [ ] **Step 3: Run the focused repository test and verify failure**

Run:

```bash
pnpm --filter @workspace/api-server test -- src/features/needs-answer/needs-answer-repository.test.ts
```

Expected: FAIL because the table/repository does not exist.

- [ ] **Step 4: Add the additive schema and migration**

Create one `needs_answer_status` enum and one `needs_answer_items` table with UUID primary key, required nonblank question, nullable entity/call/follow-up foreign keys where appropriate, optional `user_note`, `status` defaulting to `open`, nullable resolution/resolved timestamp, created/updated timestamps, and an index on `(status, created_at)` for the queue. Do not add an assignee/admin-escalation column.

- [ ] **Step 5: Implement repository create/list/resolve**

`list({ status })` sorts open items newest-first; resolving requires nonblank resolution text and stamps `resolvedAt`. Creating an item must preserve whatever valid context IDs are supplied but must not require a call session, because the question can arise before a saved call exists.

- [ ] **Step 6: Add HTTP routes and tests**

Provide:

```text
GET    /api/needs-answer?status=open|resolved
POST   /api/needs-answer
PATCH  /api/needs-answer/:id/resolve
```

Validate question/resolution text as trimmed nonblank strings. The create response is the saved item; resolve returns the updated item.

- [ ] **Step 7: Run DB/API tests and library typecheck**

Run:

```bash
pnpm --filter @workspace/api-server test -- src/features/needs-answer/needs-answer-repository.test.ts src/routes/needs-answer.test.ts && pnpm run typecheck:libs
```

Expected: PASS.

- [ ] **Step 8: Commit Needs Answer persistence**

```bash
git add lib/db/src/schema/index.ts lib/db/src/migrations.ts lib/db/migrations/*guided_call_needs_answer.sql artifacts/api-server/src/features/needs-answer artifacts/api-server/src/routes/needs-answer.ts artifacts/api-server/src/routes/needs-answer.test.ts artifacts/api-server/src/app.ts
git commit -m "feat: add needs answer queue"
```

---

### Task 7: Add Ask Assistant and Needs Answer UI to the shared calling workspace

**Files:**
- Create: `artifacts/adventure-zone/src/components/calls/call-assistant-panel.tsx`
- Create: `artifacts/adventure-zone/src/components/calls/call-assistant-panel.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/calls/call-workspace.tsx`
- Modify: `artifacts/adventure-zone/src/components/calls/call-workspace.test.tsx`
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-api.ts`
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-api.test.ts`
- Create: `artifacts/adventure-zone/src/pages/NeedsAnswerPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/NeedsAnswerPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`

**Interfaces:**
- Consumes: Task 5 `askCallAssistant`; Task 6 Needs Answer REST API; existing workspace context IDs.
- Produces: `CallAssistantPanel`; administrator route `/needs-answer`; retry-safe unsaved-question draft in local component/storage state.

- [ ] **Step 1: Write failing panel tests for answer and unresolved paths**

```tsx
it("shows a grounded assistant answer in the call workspace", async () => {
  askCallAssistant.mockResolvedValue({ kind: "answer", answer: "The stored package includes 10 attractions.", sources: ["packages"] });
  render(<CallAssistantPanel context={context} />);
  await user.type(screen.getByRole("textbox"), "How many attractions?");
  await user.click(screen.getByRole("button", { name: "Ask Assistant" }));
  expect(await screen.findByText(/10 attractions/i)).toBeInTheDocument();
});

it("offers Save to Needs Answer when the assistant cannot answer", async () => {
  askCallAssistant.mockResolvedValue({ kind: "needs_answer", reason: "No trusted source" });
  render(<CallAssistantPanel context={context} />);
  await user.type(screen.getByRole("textbox"), "Unknown question");
  await user.click(screen.getByRole("button", { name: "Ask Assistant" }));
  expect(await screen.findByRole("button", { name: "Save to Needs Answer" })).toBeInTheDocument();
  expect(screen.queryByText(/send to admin/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run component tests and verify failure**

Run:

```bash
pnpm --filter @workspace/adventure-zone test -- src/components/calls/call-assistant-panel.test.tsx src/pages/NeedsAnswerPage.test.tsx
```

Expected: FAIL because the UI is missing.

- [ ] **Step 3: Implement `CallAssistantPanel`**

Use a compact textarea/input plus `Ask Assistant`. Preserve the typed question until the user replaces/discards it. For `answer`, show the response without modifying call notes automatically. For `needs_answer`, show a clear uncertainty message and `Save to Needs Answer`; include optional user note/context when saving.

- [ ] **Step 4: Keep failed Needs Answer saves retryable**

If the POST fails, retain question and optional note in local state/local storage under the active workspace context key and show Retry/Discard. Clear only after a successful save or explicit discard.

- [ ] **Step 5: Implement the administrator Needs Answer page**

Render Open and Resolved filters. Each open item shows the question, entity context, created time, user note, and a resolution input/button. Resolving moves it to the resolved list after the API confirms success. Do not render assignment/escalation controls.

- [ ] **Step 6: Add `/needs-answer` route**

Register the page using the same authenticated/private route pattern already used by other admin pages.

- [ ] **Step 7: Integrate Assistant into the approved workspace order**

Order on desktop and mobile:

1. Caller header + phone actions.
2. Why you're calling / briefing.
3. Guided script.
4. Quick Facts/history summary.
5. Ask Assistant.
6. Notes.
7. Outcome / next action / follow-up.
8. Recent history.

- [ ] **Step 8: Run UI tests and typecheck**

Run:

```bash
pnpm --filter @workspace/adventure-zone test -- src/components/calls/call-assistant-panel.test.tsx src/components/calls/call-workspace.test.tsx src/pages/NeedsAnswerPage.test.tsx src/features/assistant/assistant-api.test.ts && pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit the Assistant/Needs Answer UI**

```bash
git add artifacts/adventure-zone/src/components/calls artifacts/adventure-zone/src/features/assistant artifacts/adventure-zone/src/pages/NeedsAnswerPage.tsx artifacts/adventure-zone/src/pages/NeedsAnswerPage.test.tsx artifacts/adventure-zone/src/App.tsx
git commit -m "feat: add call assistant needs answer flow"
```

---

### Task 8: Finish mobile behavior and run full guided-calling regressions

**Files:**
- Modify as needed only within files touched by Tasks 1–7 when verification exposes a defect.
- Test: existing assisted-calling suites plus all new guided-calling suites.

**Interfaces:**
- Consumes: completed Tasks 1–7.
- Produces: verified release candidate with no assisted-calling regression.

- [ ] **Step 1: Add/confirm mobile interaction tests in the shared workspace suite**

At a narrow viewport, verify the script remains before notes/outcome, response buttons are touch-sized, and completing/saving the call remains reachable. Do not create a separate mobile-only script engine.

- [ ] **Step 2: Run all focused guided-calling tests**

Run:

```bash
pnpm --filter @workspace/api-server test -- src/features/calls/call-briefing.test.ts src/features/calls/call-script.test.ts src/features/calls/call-workspace-query.test.ts src/features/assistant/call-assistant.test.ts src/features/needs-answer/needs-answer-repository.test.ts src/routes/calls.test.ts src/routes/needs-answer.test.ts
pnpm --filter @workspace/adventure-zone test -- src/features/calls/guided-call-scripts.test.ts src/features/calls/guided-call-state.test.ts src/features/calls/call-draft.test.ts src/components/calls/guided-call-script-card.test.tsx src/components/calls/call-assistant-panel.test.tsx src/components/calls/call-workspace.test.tsx src/components/today/call-queue-workspace.test.tsx src/pages/NeedsAnswerPage.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run assisted-calling regression tests**

Run the existing tests covering phone launcher, multiple phone numbers, caller finder, contact call entry points, event-profile call entry points, call completion, follow-up creation, Do Not Call, and call draft recovery. Use repository test filenames found by:

```bash
find artifacts/api-server/src artifacts/adventure-zone/src -type f \( -name "*.test.ts" -o -name "*.test.tsx" \) | grep -E "calls|caller|phone|ContactDetail|EventProfile|call-draft" | sort
```

Then run the resulting assisted-calling test files with their package-specific `pnpm --filter ... test --` commands. Expected: PASS with no changes to call completion semantics.

- [ ] **Step 4: Run package typechecks**

Run:

```bash
pnpm run typecheck:libs
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 5: Manually verify the real browser/Phone Link handoff**

Verify on a Windows machine configured to handle `tel:` links:

1. Open Today.
2. Click the small phone action for a callable queue item.
3. Confirm the correct workspace opens immediately.
4. Confirm the OS phone handler is invoked once.
5. Confirm no call activity is saved merely by the launch.
6. Click through at least one branching script path and verify suggestions remain editable/unsaved.
7. Save through the normal completion flow and verify the existing history/follow-up behavior.
8. Ask one answerable Assistant question and one intentionally unknown question.
9. Save the unknown question to Needs Answer and resolve it from `/needs-answer`.
10. Repeat at a phone-sized viewport and confirm the script/Save actions remain usable.

- [ ] **Step 6: Check the admin-language boundary**

Run:

```bash
grep -RniE "send to admin|escalate to admin|contact admin" artifacts/adventure-zone/src/components/calls artifacts/api-server/src/features/assistant artifacts/api-server/src/features/needs-answer artifacts/adventure-zone/src/pages/NeedsAnswerPage.tsx || true
```

Expected: no user-facing admin-escalation copy in the guided-calling flow.

- [ ] **Step 7: Commit any verification-only fixes**

If verification required fixes, commit only those focused changes:

```bash
git add artifacts/api-server artifacts/adventure-zone lib/db
git commit -m "test: verify guided calling console"
```

If no fixes were required, do not create an empty commit.

---

## Final acceptance checklist

- [ ] Today has a compact phone action for callable items.
- [ ] One click opens/selects the exact contact/event/follow-up workspace and invokes the existing phone launcher exactly once.
- [ ] Launching does not create or complete a call record.
- [ ] The workspace shows who is being called, why the call is due, and the most useful trusted context before the conversation begins.
- [ ] First outreach, rebooking, follow-up, proposal/contract, callback, and incoming inquiry select distinct guided script families.
- [ ] Common caller responses are clickable and move through valid deterministic branches.
- [ ] Past customers do not get cold-call wording; proposal follow-ups do not restart discovery.
- [ ] Suggested outcomes/follow-ups/notes are clearly marked, editable, and never silently persisted.
- [ ] Manual notes and manual script selection remain available at every point.
- [ ] Ask Assistant uses the existing assistant backend and trusted Adventure Zone/CRM/package information.
- [ ] Unknown questions return Needs Answer instead of invented business facts.
- [ ] Needs Answer items retain relevant contact/event/organization/call/follow-up context, can be resolved by the user, and contain no separate admin escalation workflow.
- [ ] Existing multiple-phone, extension, Do Not Call, Last Resort, draft recovery, idempotent call completion, history, and follow-up behavior still pass regression tests.
- [ ] Desktop and mobile layouts remain usable and accessible.
