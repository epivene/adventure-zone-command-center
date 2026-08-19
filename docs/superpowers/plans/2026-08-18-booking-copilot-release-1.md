# Booking Copilot Release 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Today workflow into a ranked Booking Copilot work queue that explains why each item matters and gives the user a compact, automatic contact brief before outreach.

**Architecture:** Extend the existing `/today` dashboard and follow-up ranking rather than introducing a second task system. Add deterministic priority/reason generation on the API side, then expose those reasons in the existing Today call queue and next-step cards. Add a profile-brief endpoint/service that summarizes existing structured CRM facts first and optionally uses the existing assistant infrastructure for concise prose, with a deterministic fallback so the workflow remains useful when AI is unavailable.

**Tech Stack:** React + TypeScript frontend, Express + TypeScript API, Drizzle/Postgres data layer, existing Assistant infrastructure, existing Today/follow-up components.

**Spec:** Conversation-approved Booking Copilot Release 1: prioritized Next Actions + automatic Contact Briefs integrated into the existing Command Center.

## Global Constraints

- Reuse the existing Today, follow-up, booking, organization, contact, notes/activity, and assistant data paths; do not create a second CRM or task database.
- Existing manual follow-ups remain authoritative and editable.
- AI is assistive only; users must be able to continue working when AI generation is unavailable.
- Priority explanations must be plain English and traceable to stored CRM facts.
- Do not send email, place calls, alter booking status, or create follow-ups automatically without an explicit user action.
- Preserve the current compact profile design and side-profile workflow.
- Keep mobile usability as a first-class constraint.

---

### Task 1: Define the Booking Copilot next-action contract

**Files:**
- Modify: `artifacts/api-server/src/features/follow-ups/today-query.ts`
- Test: existing Today/follow-up query test file adjacent to this feature; if coverage is currently consolidated, extend the established Today query test rather than introducing a parallel harness.

**Interfaces:**
- Consumes: existing `FollowUpSummary`, `FollowUpPlanItem`, booking status/probability, due date, last-contacted data, route operations summaries.
- Produces: `BookingCopilotReason`, `BookingCopilotPriority`, and explanatory fields attached to Today queue items.

- [ ] **Step 1: Write failing contract tests**

Add tests that require deterministic ranking and explanation for at least these cases:

```ts
expect(copilot.priority).toBe("urgent");
expect(copilot.reason).toContain("overdue");

expect(renewalCopilot.reason).toContain("previous");
expect(likelyCopilot.reason).toContain("Likely");
```

Cover ordering for overdue follow-up, due today, deadline/pending contract, likely opportunity, quiet lead, and unplanned next-step item.

- [ ] **Step 2: Run the focused Today query tests and confirm failure**

Run the repository's established focused test command for the Today/follow-up feature. Expected: failure because the Booking Copilot fields/functions do not exist yet.

- [ ] **Step 3: Add explicit types and a pure explanation function**

Implement a pure function with a stable contract such as:

```ts
export type BookingCopilotPriority = "urgent" | "high" | "normal" | "low";

export type BookingCopilotReason = {
  priority: BookingCopilotPriority;
  headline: string;
  reasons: string[];
};

export function explainTodayAction(item: FollowUpSummary, now: Date): BookingCopilotReason
```

The function must use existing stored facts only. Example reasons: overdue, due today, pending decision/contract, likely probability, long quiet period, route warning, or missing next step.

- [ ] **Step 4: Attach Copilot metadata to Today API records**

Extend `FollowUpSummary` and `FollowUpPlanItem` responses with the explanation metadata without removing any existing fields.

- [ ] **Step 5: Re-run focused tests and commit**

Commit message:

```bash
git commit -m "feat: explain Booking Copilot next actions"
```

---

### Task 2: Upgrade Today into a single ranked work queue

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.tsx`
- Modify: `artifacts/adventure-zone/src/components/today/call-queue-workspace.tsx`
- Modify: `artifacts/adventure-zone/src/components/today/next-call-card.tsx`
- Modify: `artifacts/adventure-zone/src/components/today/follow-up-list.tsx` only if the non-assisted-calling path needs the same explanation UI.
- Test: existing Today page/component tests.

**Interfaces:**
- Consumes: Copilot explanation metadata returned by `/today`.
- Produces: an "Up Next" experience that clearly answers what to do and why.

- [ ] **Step 1: Write failing UI tests**

Require the top item to show:

```txt
Up Next
<profile/event name>
<recommended action>
Why this is next: <plain-English reasons>
```

Also require a visible remaining-action count and preservation of the existing call/follow-up controls.

- [ ] **Step 2: Verify the tests fail**

Run the focused Today frontend tests. Expected: failure because the reason UI does not exist.

- [ ] **Step 3: Render concise priority reasons in existing cards**

Do not add a separate Copilot dashboard. Enhance current cards with a small explanation block and priority badge. Keep the visible copy brief; expose at most the top 2-3 reasons without expanding.

- [ ] **Step 4: Make "Next" behavior preserve queue flow**

After a call outcome/follow-up completion refreshes `/today`, ensure the next ranked item naturally becomes the new Up Next item without navigating the user back through unrelated screens.

- [ ] **Step 5: Re-run focused tests and commit**

```bash
git commit -m "feat: turn Today into Booking Copilot queue"
```

---

### Task 3: Build a deterministic contact-brief service

**Files:**
- Create: `artifacts/api-server/src/features/assistant/contact-brief.ts`
- Modify: the existing profile/assistant route module that already serves profile assistant context; if no suitable route exists, add a focused route under the established assistant router.
- Test: add a focused contact-brief service test beside existing assistant/profile tests.

**Interfaces:**
- Consumes: organization, primary contact, booking/event family context, activities/notes, call history, previous bookings, follow-ups, communication preference fields when present.
- Produces:

```ts
export type ContactBrief = {
  summary: string;
  relationshipFacts: string[];
  suggestedTalkingPoints: string[];
  lastMeaningfulContactAt: string | null;
  sourceCounts: {
    activities: number;
    bookings: number;
    calls: number;
  };
};
```

- [ ] **Step 1: Write failing service tests with representative CRM history**

Require the brief to surface facts such as previous bookings, main contact, most recent meaningful interaction, prior interest/budget notes, and a useful next conversation prompt.

- [ ] **Step 2: Verify failure before implementation**

Run the focused service test and confirm the service is absent.

- [ ] **Step 3: Implement deterministic fact extraction first**

Collect a bounded set of recent/high-value facts from existing data. Avoid dumping raw ACT HTML/history into the brief. Prefer cleaned activity text and structured booking fields.

- [ ] **Step 4: Add concise prose generation through the existing Assistant provider when available**

Feed only the bounded extracted facts to the existing assistant path. Require a short summary and 2-4 talking points. If AI is unavailable or errors, return a deterministic summary assembled from the extracted facts.

- [ ] **Step 5: Add authenticated brief endpoint**

Expose a read-only endpoint for the current profile/contact/booking context. It must not mutate CRM data.

- [ ] **Step 6: Re-run tests and commit**

```bash
git commit -m "feat: add automatic contact briefs"
```

---

### Task 4: Show the contact brief exactly where outreach happens

**Files:**
- Modify: `artifacts/adventure-zone/src/components/today/call-queue-workspace.tsx`
- Modify: `artifacts/adventure-zone/src/components/profiles/profile-detail-sheet.tsx`
- Modify: full-profile component/page only if needed to share the same brief card.
- Test: existing call queue/profile interaction tests.

**Interfaces:**
- Consumes: read-only contact brief endpoint.
- Produces: a compact "Before you contact them" card in call flow and profile context.

- [ ] **Step 1: Write failing UI tests**

Require the brief to render for a selected Up Next item, show loading/error fallback states, and never block the call controls.

- [ ] **Step 2: Verify the focused UI tests fail**

Expected: no brief UI yet.

- [ ] **Step 3: Add the compact brief card**

Display:

```txt
Before you contact them
<2-4 sentence relationship summary>
Talking points
• ...
• ...
```

Keep raw notes/history behind the existing profile detail controls instead of duplicating them in the brief.

- [ ] **Step 4: Add refresh/regenerate only as a user action**

If the Assistant-backed summary is cached or stale, allow the user to refresh it. Do not continuously regenerate on every render.

- [ ] **Step 5: Re-run tests and commit**

```bash
git commit -m "feat: show contact briefs in outreach flow"
```

---

### Task 5: Add safe completion and follow-up suggestions

**Files:**
- Modify: existing call outcome/follow-up UI used by `call-queue-workspace.tsx`
- Modify: API only if a read-only suggestion endpoint/helper is required.
- Test: current call outcome/follow-up tests.

**Interfaces:**
- Consumes: saved call outcome, note, booking stage, existing open follow-up.
- Produces: suggested next step only; explicit user confirmation remains required to save a follow-up or clear the item.

- [ ] **Step 1: Add failing tests for suggestions after common outcomes**

Cover no answer, requested callback date, sent information, waiting on board/decision, not this year, and no follow-up needed.

- [ ] **Step 2: Verify tests fail**

- [ ] **Step 3: Implement deterministic suggestions**

Examples:

```ts
"no_answer" -> suggest retry
"callback_requested" -> suggest stated callback date
"waiting_on_decision" -> suggest follow-up
"not_this_year" -> suggest next-season renewal timing
```

No suggestion may be persisted without the existing save/confirm action.

- [ ] **Step 4: Re-run tests and commit**

```bash
git commit -m "feat: suggest safe next steps after outreach"
```

---

### Task 6: Regression and end-to-end verification

**Files:**
- Modify tests only as required for final integration.
- Modify docs only if user-facing behavior changed from this plan.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified Release 1 behavior on both assisted-calling and normal Today workflows.

- [ ] **Step 1: Run the focused Today, follow-up, assistant/contact-brief, profile, and call workflow test suites**

All must pass.

- [ ] **Step 2: Run the repository build/typecheck commands used by CI**

Do not claim success unless the commands actually execute successfully. If GitHub Actions again terminates before executing steps, report that separately as infrastructure-blocked.

- [ ] **Step 3: Manually verify the core user story**

Verify this sequence:

```txt
Open Today
→ see one clearly ranked Up Next item and why
→ open/start outreach
→ see the contact brief and talking points
→ record outcome
→ choose/confirm next step
→ return to the refreshed queue with the next item promoted
```

Also verify mobile width and the non-AI fallback brief.

- [ ] **Step 4: Commit final integration fixes**

```bash
git commit -m "test: verify Booking Copilot release 1"
```

## Self-Review

- Spec coverage: Next Actions, plain-English rationale, automatic Contact Briefs, call-flow integration, and explicit-user-control safety are all assigned to concrete tasks.
- Placeholder scan: no TBD/TODO implementation placeholders are intentionally left in the plan.
- Type consistency: `BookingCopilotReason`, `BookingCopilotPriority`, and `ContactBrief` are defined once and consumed by later tasks.
- Scope guard: Event Discovery, route-gap prospecting, autonomous email generation/sending, and Brain Dump remain outside Release 1 and should be separate follow-on releases.
