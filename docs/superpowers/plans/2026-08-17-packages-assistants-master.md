# Packages and Assistants Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this roadmap release-by-release. Do not implement multiple releases in one branch or PR.

**Goal:** Turn the approved package/assistant design into three independently testable releases: flexible package intelligence, a source-backed Booking Assistant, and a leg-scoped Manager Assistant with Admin Question escalation and offline support.

**Architecture:** Extend the existing Command Center package/resource model, reuse the existing provider-agnostic AI client and ACT! provenance patterns, and reuse the existing Leg Manager authorization/offline mutation infrastructure. Structured Command Center records remain canonical. AI summarizes and recommends but never silently mutates CRM or operational records.

**Tech Stack:** TypeScript, React, Vite, Wouter, TanStack React Query, Express, Drizzle ORM/PostgreSQL, Zod, Vitest/Testing Library, browser IndexedDB, existing manager sync queue, existing `createAiClient()` provider abstraction.

## Source design

Implementation must conform to:

- `docs/superpowers/specs/2026-08-17-packages-booking-manager-assistants-design.md`
- `docs/superpowers/specs/2026-08-15-manager-communications-acknowledgments-design.md`
- `docs/superpowers/plans/2026-08-15-leg-manager-portal-master.md`

The August 17 design overrides the old package behavior that required approval for an attraction count outside 10–12.

## Global constraints

1. Package ranges are **guidance**, never booking-blocking limits.
2. Adventure Zone starts with a 10–12 normal main-attraction range. Larger or smaller legitimate bookings remain saveable without a special approval reason.
3. Warrior's Playground and Pirate's Rebellion are editable range-capable templates. Preserve existing stable package codes and historical foreign keys; rename display labels without destructive code changes.
4. One booking may contain multiple packages. Each package gets its own guideline/assigned-attraction view while physical resources remain counted once.
5. Carnival games/extras are distinct from main-attraction target counts.
6. Paintball and other movable shared equipment retain independent resource scheduling/conflict behavior.
7. Historical comparisons are advisory. They never copy prior-year package/resource choices into a new booking without explicit user action.
8. Structured CRM/booking/route records outrank AI-extracted facts if they conflict.
9. Raw ACT! notes/history remain unchanged. Any summary/extracted fact retains provenance to source records.
10. Booking Assistant authorization is identical to the signed-in admin/booking user's authorization. AI is not a privilege boundary.
11. Manager Assistant retrieval is derived from the manager session's leg scope on the server. Never trust a client-supplied leg ID to widen scope.
12. Manager Assistant must escalate uncertainty instead of inventing an operational answer.
13. Assistant-generated drafts are editable outputs, not automatically sent messages or CRM mutations.
14. Core assistant usefulness must survive loss of connectivity using cached structured context, deterministic rules, and queued writes.
15. Local browser-model support is optional enhancement work after deterministic offline behavior works. Do not make a large model download a prerequisite for the app.
16. Admin Questions reuse the existing manager communication/notification ecosystem and existing manager offline mutation queue rather than creating a second offline system.
17. Manager sign-out/leg switch must continue clearing leg-private cached data and queued private data according to the existing portal invariant.
18. All schema migrations must preserve current production data and be additive/backward-compatible for the rollout step that introduces them.

## Migration allocation

Current `main` registers migrations through `043_act_archive_full_recovery.sql`. These plans reserve the next three prefixes on the implementation line:

- Release 1: `044_package_intelligence.sql`
- Release 2: `045_booking_assistant.sql`
- Release 3: `046_manager_assistant_questions.sql`

Before beginning each release, fetch current `main`. If any reserved prefix has been occupied, shift that release and all later unimplemented release migration prefixes forward together to the next unused sequential values and update the plan paths before coding. Never reuse an existing filename.

## Delivery order

### Release 1 — Package Intelligence

Plan: `docs/superpowers/plans/2026-08-17-package-intelligence.md`

**Purpose:** Correct the old rigid package-count policy, make package guideline ranges and business knowledge editable, distinguish main attractions/games/shared resources, and add deterministic prior-booking comparison signals.

**Key outcomes:**

- Adventure Zone displays 10–12 as a normal guideline, not a maximum.
- Out-of-range attraction totals no longer require an approval reason solely because of the range.
- Package templates hold editable minimum/maximum guidance and business-facing/operational text.
- Existing stable package codes remain intact while display names are corrected.
- Booking pages show package sections and soft warnings.
- Prior bookings can generate source-linked signals such as missing paintball, changed attraction count, or usual package mix.

**Exit gate:** An admin can configure package ranges, save an Adventure Zone booking with 14 main attractions without an approval reason, combine multiple packages, distinguish games from main attractions, keep paintball as a shared resource, and see deterministic prior-year comparison signals without any prior-year data being copied automatically.

### Release 2 — Booking Assistant

Plan: `docs/superpowers/plans/2026-08-17-booking-assistant.md`

**Purpose:** Build a global/contextual booking copilot using structured CRM facts, package intelligence, ACT! provenance, route/follow-up context, curated website/business knowledge, and the existing AI provider abstraction.

**Key outcomes:**

- Automatic Booking Brief on relevant records.
- Persistent Assistant drawer available from the admin app.
- Context follows the current profile/organization/event family/booking/call workspace/calendar/route.
- Deterministic facts and comparisons work without an LLM.
- Complex online questions use the existing `createAiClient()` abstraction.
- Important statements return typed source references and a `Sources / Why` UI.
- ACT!-derived facts are stored separately from raw history with confidence and provenance.
- Previously synced assistant context/briefs remain readable offline.

**Exit gate:** From a real profile or booking, the user can open a Booking Brief, ask a contextual question without restating the record, inspect supporting sources, receive a deterministic answer when possible, receive a cloud-enhanced answer when online, and still access cached brief/context when offline. No assistant action silently changes CRM records.

### Release 3 — Manager Assistant, Admin Questions, and Offline Escalation

Plan: `docs/superpowers/plans/2026-08-17-manager-assistant-admin-questions.md`

**Purpose:** Give Leg Managers an operations-only assistant that respects existing leg permissions, escalates uncertain questions into Command Center, and uses the existing IndexedDB/idempotent sync path offline.

**Key outcomes:**

- Persistent/contextual Manager Assistant in the manager portal.
- Server-built manager context contains only assigned-leg/event operational data.
- Unanswerable/uncertain questions offer `Ask Admin` instead of guessing.
- Admin Questions inbox is integrated into manager communications administration.
- Admin answers return to the correct manager/event context.
- Explicit `Save as reusable knowledge` can promote suitable answers.
- Admin Questions can be queued offline with client-generated idempotency IDs.
- Optional local browser-model adapter can be added only after deterministic offline behavior is complete and tested.

**Exit gate:** A manager can ask an event-specific question, receive a scoped answer when the data supports it, get no unauthorized CRM/other-leg data, queue an Admin Question offline, reconnect and create it exactly once, receive an admin response, and use approved reusable operations knowledge later.

## Cross-release interfaces

### Package guideline interface

Release 1 establishes the package contract consumed by both assistants:

```ts
export type PackageGuideline = {
  packageTemplateId: string;
  name: string;
  suggestedMainAttractionCount: number;
  minimumMainAttractionCount: number;
  maximumMainAttractionCount: number;
};
```

`minimum` and `maximum` describe the normal range only. They never imply validation failure.

### Assistant source interface

Release 2 establishes a source reference shape reused by the Manager Assistant:

```ts
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
    | "derived_fact"
    | "manager_instruction"
    | "admin_answer";
  recordId: string;
  label: string;
  occurredAt: string | null;
};
```

The frontend may display only a concise label initially, but the server response must preserve a traceable record ID.

### Assistant answer interface

Both assistants should converge on:

```ts
export type AssistantAnswer = {
  text: string;
  mode: "deterministic" | "cloud" | "offline_cached";
  confidence: "high" | "medium" | "low";
  sourceIds: string[];
  needsAdmin: boolean;
};
```

Booking Assistant normally uses `needsAdmin: false`. Manager Assistant sets `needsAdmin: true` when it cannot support an operational answer confidently.

## Branch and PR strategy

Use one branch and PR per release. Recommended branches:

- `feature/package-intelligence`
- `feature/booking-assistant`
- `feature/manager-assistant-admin-questions`

For each branch:

1. start from latest `main` after the prior release merges,
2. implement tasks in the child plan in order and test-first,
3. run focused tests after every task,
4. run full typecheck/build before opening the PR,
5. do not stack later-release code into the current PR.

## Regression expectations

Every release must preserve:

- existing ACT! import/recovery raw data,
- existing bookings and package selections,
- current calendar booked-event behavior,
- existing manager login/session scope,
- existing manager finance/crew/review/incidents workflows,
- existing manager messages/acknowledgments/meetup workflows,
- existing resource conflict detection and paintball transfer handling,
- current owner/admin authentication.

## Final acceptance checklist

The overall project is complete only when all three release exit gates pass and:

- `10–12` appears as Adventure Zone guidance, not a database-enforced maximum.
- Multi-package bookings retain independent package sections and one physical resource truth.
- Games/extras and special/shared resources are not accidentally counted as ordinary package main attractions.
- Prior-year comparisons cite the booking/resource records that produced them.
- Booking Brief claims can be traced to source records.
- An AI provider outage does not remove deterministic Booking Assistant facts.
- Offline cached answers visibly disclose that they use saved data.
- Manager Assistant endpoints cannot retrieve another leg by changing URL/query/body IDs.
- Low-confidence manager questions escalate rather than hallucinate.
- Offline Admin Question retries create one server row, not duplicates.
- Admin answers do not mutate official route/booking state unless an admin performs the normal underlying operation.
- Reusable operations knowledge is created only by explicit admin action.
- Raw ACT! history is never replaced by AI-generated text.
- Assistant-generated drafts remain drafts until the user explicitly acts on them.
