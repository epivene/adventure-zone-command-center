# Profile Research & Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user research one incomplete event profile using saved CRM/history clues plus public internet sources, review evidence-backed suggestions, and explicitly apply only the facts they trust.

**Architecture:** Reuse the existing profile/Assistant context and existing organization/contact/booking write paths. Add a bounded research-context builder, a provider abstraction for live web research, a dedicated persisted research-run store, a read-only orchestration service, and a separate apply service that revalidates current values before writing. UI lives on the existing profile surfaces and opens a larger research review view rather than expanding the compact side profile.

**Tech Stack:** React + TypeScript, Express + TypeScript, Drizzle/Postgres, existing Booking Assistant context/brief infrastructure, existing profile/contact/booking APIs and validation.

**Spec:** `docs/superpowers/specs/2026-08-18-profile-research-enrichment-design.md`

## Global Constraints

- Research is read-only until the user explicitly approves selected suggestions.
- Do not create a second CRM context layer; reuse profile, contact, booking, follow-up, activity/history, event-family/organization context, and Assistant-derived facts.
- Search only public internet information; do not bypass logins/paywalls or collect private/non-public personal data.
- Do not send raw/private ACT notes verbatim to external search queries; reduce history to public identity clues.
- Never automatically send outreach, place calls, change booking status/probability, create follow-ups, delete values, merge organizations, or create event-family relationships.
- Re-read current target values before applying and reject stale suggestions when the CRM changed after research.
- Low-confidence suggestions are never preselected; conflicting non-empty values always require explicit review.
- Keep the side profile compact; full research results open in a larger sheet/page.
- Provider/internet failure must never block normal profile use or discard a prior successful run.

---

### Task 1: Build bounded research context and gap detection

**Files:**
- Create: `artifacts/api-server/src/features/profile-research/profile-research-types.ts`
- Create: `artifacts/api-server/src/features/profile-research/profile-research-context.ts`
- Create: `artifacts/api-server/src/features/profile-research/profile-research-context.test.ts`
- Modify: existing Assistant/profile context repository only if a small read helper is needed; do not duplicate repository logic.

**Interfaces:**
- Consumes: existing organization/profile context, contacts, bookings, follow-ups, cleaned activities/history, event-family/organization context, Assistant derived facts.
- Produces: `ProfileResearchContext`, `ProfileResearchGap[]`, and minimized `searchClues`.

- [ ] **Step 1: Write failing context tests**

Cover: website/phone/location/contact gaps, recurring-event date gap, useful public identity clues from history, exclusion of system/noisy history, history volume cap, and no verbatim private note body in generated search clues.

```ts
expect(context.gaps.map((gap) => gap.field)).toContain("website");
expect(context.searchClues).toContain("River Days Fargo ND");
expect(context.searchClues.join(" ")).not.toContain("private internal pricing note");
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run the existing API Vitest command scoped to `profile-research-context.test.ts`. Expected: module/types absent.

- [ ] **Step 3: Define stable research types**

```ts
export type ResearchMode = "quick" | "deep";
export type ResearchConfidence = "high" | "medium" | "low";
export type ResearchTargetKind = "organization" | "contact" | "booking";

export type ProfileResearchGap = {
  field: string;
  label: string;
  targetKind: ResearchTargetKind;
};

export type ProfileResearchContext = {
  profileId: string;
  profileName: string;
  mode: ResearchMode;
  knownFacts: Array<{ key: string; value: string; source: "crm" | "history" }>;
  searchClues: string[];
  gaps: ProfileResearchGap[];
};
```

- [ ] **Step 4: Implement context building and gap detection**

Reuse existing cleaned history/profile context. Convert notes into bounded public identity clues only: event name, city/state, public contact name/title, venue, known date/season, and organization/event-family names.

- [ ] **Step 5: Run focused tests and commit**

```bash
git commit -m "feat: build profile research context"
```

---

### Task 2: Persist research runs, sources, and suggestions

**Files:**
- Create: `lib/db/migrations/061_profile_research_runs.sql` using the next actually-unused migration number if 061 is no longer free at execution time.
- Modify: existing migration registration/startup runner.
- Create: `artifacts/api-server/src/features/profile-research/profile-research-repository.ts`
- Create: `artifacts/api-server/src/features/profile-research/profile-research-repository.test.ts`

**Interfaces:**
- Consumes: research run creation/result data.
- Produces: create/load/update run APIs with stored bounded sources, suggestions, status, and review state.

- [ ] **Step 1: Write failing repository tests**

Require a run to persist `profileId`, `mode`, `status`, timestamps, sources, suggestions, deep summary, and per-suggestion `pending|accepted|dismissed` state. Require retrieval to be profile-scoped.

- [ ] **Step 2: Verify failure**

Run focused repository tests. Expected: schema/repository absent.

- [ ] **Step 3: Add migration and registration**

Use dedicated tables or JSONB columns following current repository conventions. Do not store fetched webpage bodies; store only normalized URL/title/publisher/retrievedAt/bounded excerpt plus structured suggestions.

- [ ] **Step 4: Implement repository**

Expose exact methods:

```ts
createRun(input): Promise<ProfileResearchRun>
setRunning(runId): Promise<void>
completeRun(runId, result): Promise<ProfileResearchRun>
failRun(runId, errorMessage): Promise<ProfileResearchRun>
getRun(profileId, runId): Promise<ProfileResearchRun | null>
setSuggestionState(profileId, runId, suggestionId, state): Promise<boolean>
```

- [ ] **Step 5: Run tests and commit**

```bash
git commit -m "feat: persist profile research runs"
```

---

### Task 3: Add provider abstraction, identity matching, and evidence normalization

**Files:**
- Create: `artifacts/api-server/src/features/profile-research/profile-research-provider.ts`
- Create: `artifacts/api-server/src/features/profile-research/profile-research-matching.ts`
- Create: `artifacts/api-server/src/features/profile-research/profile-research-provider.test.ts`
- Modify: existing AI/web provider configuration only where necessary to instantiate a provider.

**Interfaces:**
- Consumes: `ProfileResearchContext` and generated public search queries.
- Produces: normalized `ProfileResearchSource[]`, candidate facts, identity match confidence, and provider failure states.

- [ ] **Step 1: Write failing matching/provider tests**

Cover: official-domain result, official city/county supporting result, same-name event in wrong state rejected, matching contact/venue strengthening identity, inaccessible page not cited as verified, and search snippets alone not treated as strong evidence when page content is unavailable.

- [ ] **Step 2: Verify failure**

- [ ] **Step 3: Define provider contract**

```ts
export interface ProfileResearchProvider {
  research(input: {
    context: ProfileResearchContext;
    mode: ResearchMode;
  }): Promise<{
    identity: { confidence: ResearchConfidence; rationale: string };
    sources: ProfileResearchSource[];
    candidates: ProfileResearchCandidateFact[];
    deepSummary?: string | null;
  }>;
}
```

- [ ] **Step 4: Implement normalization and identity rules**

Prefer official event/organization and government/community sources. Strip HTML, cap excerpts, reject unsupported redirects/schemes, and treat external content only as data.

- [ ] **Step 5: Implement configured live provider adapter**

Use the project’s existing provider/configuration conventions. Provider failures return an explicit research error and must not be converted into “no information exists.”

- [ ] **Step 6: Run tests and commit**

```bash
git commit -m "feat: add profile web research provider"
```

---

### Task 4: Orchestrate Quick/Deep research and confidence/conflict rules

**Files:**
- Create: `artifacts/api-server/src/features/profile-research/profile-research-service.ts`
- Create: `artifacts/api-server/src/features/profile-research/profile-research-service.test.ts`
- Modify: `artifacts/api-server/src/routes/event-profiles.ts`

**Interfaces:**
- Consumes: context builder, provider, research repository.
- Produces: authenticated run creation/result retrieval and evidence-backed `ProfileResearchSuggestion[]`.

- [ ] **Step 1: Write failing service/API tests**

Require Quick/Deep run creation, source normalization, official source => high confidence when identity is strong, indirect corroboration => medium, weak clue => low, conflicting current CRM value => `conflict:true`, and no credible identity => complete run with no writable suggestions and explanatory status.

- [ ] **Step 2: Verify failure**

- [ ] **Step 3: Implement suggestion generation**

Every suggestion must include target, current value captured at research time, suggested value, confidence, rationale, source IDs, and conflict flag. Do not create mutation side effects.

- [ ] **Step 4: Add authenticated routes**

```text
POST /event-profiles/:id/research
GET  /event-profiles/:id/research/:runId
POST /event-profiles/:id/research/:runId/suggestions/:suggestionId/dismiss
```

Validate profile/run ownership and UUIDs.

- [ ] **Step 5: Run focused tests and commit**

```bash
git commit -m "feat: run evidence-backed profile research"
```

---

### Task 5: Apply only user-approved, non-stale suggestions

**Files:**
- Create: `artifacts/api-server/src/features/profile-research/profile-research-apply.ts`
- Create: `artifacts/api-server/src/features/profile-research/profile-research-apply.test.ts`
- Modify: `artifacts/api-server/src/routes/event-profiles.ts`
- Reuse: existing profile/contact/booking validators and write helpers.

**Interfaces:**
- Consumes: selected suggestion IDs from one persisted run.
- Produces: validated profile/contact/booking updates and accepted suggestion states.

- [ ] **Step 1: Write failing apply tests**

Cover selective apply; add-all-high-confidence excludes medium/low; stale current value rejection; conflicting value applies only when its suggestion ID was explicitly selected; invalid URL/email/phone/state/date rejected; another profile/run cannot be applied; no automatic contact creation; no booking status/probability/follow-up mutations.

- [ ] **Step 2: Verify failure**

- [ ] **Step 3: Implement current-value revalidation**

Before each write, compare the current stored field with `suggestion.currentValue`. Return a structured stale-conflict result rather than overwriting.

- [ ] **Step 4: Delegate approved writes to existing domain paths**

Update organization fields through existing profile validation/write logic; update existing contacts through existing contact logic; update supported booking fields only where the spec allows dates/location-like factual fields. Preserve audit/history semantics where available.

- [ ] **Step 5: Add apply route**

```text
POST /event-profiles/:id/research/:runId/apply
{ suggestionIds: string[] }
```

Return applied IDs, stale IDs, and validation failures independently so one bad suggestion does not silently hide another result.

- [ ] **Step 6: Run tests and commit**

```bash
git commit -m "feat: safely apply profile research suggestions"
```

---

### Task 6: Add Research Profile review UI

**Files:**
- Create: `artifacts/adventure-zone/src/components/profile-research/profile-research-sheet.tsx`
- Create: `artifacts/adventure-zone/src/components/profile-research/profile-research-sheet.test.tsx`
- Modify: full profile action/menu component.
- Modify: side profile Actions menu to expose Research without expanding the compact drawer.
- Modify: routing only if a dedicated full-page review route is cleaner than the established large sheet pattern.

**Interfaces:**
- Consumes: research create/get/dismiss/apply endpoints.
- Produces: Quick/Deep selector, run states, evidence review, per-suggestion selection, Add selected, Add all high-confidence, Dismiss, Research again.

- [ ] **Step 1: Write failing UI tests**

Require Research profile action, Quick/Deep choice, running/failure/no-match states, confidence labels, source links, old→new values, conflict warning, low confidence unselected, explicit selection, dismiss, refresh/research again, and selective apply refresh of profile data.

- [ ] **Step 2: Verify failure**

- [ ] **Step 3: Implement research launcher and review view**

Keep the side profile small. Open research in a large responsive sheet/page. Use concise cards; evidence links open separately. Do not render raw ACT HTML/history.

- [ ] **Step 4: Implement apply interaction**

`Add selected` is primary. `Add all high-confidence` selects only high-confidence non-dismissed suggestions and still requires the user to press the apply action. Show stale/conflict response inline and retain unresolved suggestions.

- [ ] **Step 5: Run tests and commit**

```bash
git commit -m "feat: review profile research suggestions"
```

---

### Task 7: Add missing-info hints and Booking Copilot link

**Files:**
- Create or modify: compact missing-info indicator helper/component.
- Modify: full/side profile high-level actions.
- Modify: `artifacts/adventure-zone/src/components/today/contact-brief-card.tsx`
- Test: profile action and Booking Copilot contact-brief tests.

**Interfaces:**
- Consumes: gap detector output or equivalent profile-shape helper.
- Produces: `Research profile · N gaps` and optional `Missing website/contact info — Research profile` prompt.

- [ ] **Step 1: Write failing UI tests**

Require hints only for meaningful gaps; no hint on sufficiently complete profiles; clicking opens research; opening Today/call workspace never automatically starts research.

- [ ] **Step 2: Verify failure**

- [ ] **Step 3: Implement passive hints**

Do not make network research calls until the user explicitly chooses Quick or Deep Research.

- [ ] **Step 4: Run tests and commit**

```bash
git commit -m "feat: surface profile research gaps"
```

---

### Task 8: Release verification

**Files:**
- Modify tests/docs only if integration reveals a mismatch.

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces: verified single-profile research workflow.

- [ ] **Step 1: Run focused API tests**

Run context, repository, provider/matching, service/routes, and apply tests. All must execute and pass.

- [ ] **Step 2: Run focused frontend tests**

Run research review, profile actions, side-profile compactness, and Booking Copilot research-link tests. All must execute and pass.

- [ ] **Step 3: Run repository typecheck/build commands used by CI**

Do not claim success if GitHub Actions again terminates before job steps; report infrastructure-blocked verification separately.

- [ ] **Step 4: Verify the core story**

```text
Open incomplete profile
→ Research profile
→ Quick Research
→ review evidence/confidence/current→suggested values
→ select two trusted fields
→ Add selected
→ profile refreshes with only those fields
→ run remains reviewable with unaccepted suggestions
```

Then verify Deep Research produces a concise source-grounded booking brief and outreach hooks without changing CRM data.

- [ ] **Step 5: Verify safety edge cases**

Provider unavailable, ambiguous same-name event, stale profile value, conflicting existing value, low-confidence suggestion, compact side profile, and normal manual profile editing must all remain usable.

- [ ] **Step 6: Commit integration fixes**

```bash
git commit -m "test: verify profile research enrichment"
```

## Self-Review

- Spec coverage: single-profile Quick/Deep research, internal-history-aware clues, public web research, identity matching, evidence/confidence, persisted runs, selective safe apply, missing-info hints, profile actions, and Booking Copilot linking all map to tasks above.
- Release boundary preserved: no bulk/autonomous/scheduled monitoring, no automatic overwrites, no automatic contact creation, no outreach sending, no merges/family grouping.
- Privacy boundary preserved: external queries use minimized public identity clues, not raw private ACT notes.
- Type consistency: ResearchMode, ResearchConfidence, ProfileResearchContext, ProfileResearchSource, ProfileResearchSuggestion, and run ownership are defined once and consumed throughout.
- No implementation placeholders are intentionally left in this plan.
