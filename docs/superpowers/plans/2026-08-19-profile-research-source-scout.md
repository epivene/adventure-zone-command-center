# Profile Research Source Scout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user deliberately mine one useful public event/calendar source over a chosen date range, persist the discoveries on the originating research run, and compare each discovery against Command Center before any prospect is created.

**Architecture:** Extend the existing profile-research run rather than creating a second research database. A source-scout provider receives one cited public URL plus a date window and returns evidence-backed event candidates. The service filters/normalizes them, compares them locally against CRM records, and merges a `sourceScouts` entry into the existing research-run JSON summary. The UI launches scouting from a source/result and renders persisted prospects with CRM match labels. Prospect creation remains Release 3.

**Tech Stack:** TypeScript, Express, React, Vitest, OpenAI Responses API web search, PostgreSQL JSONB.

**Spec:** `docs/superpowers/specs/2026-08-18-profile-research-enrichment-design.md` plus the approved Source Scout Release 2 conversation direction.

## Global Constraints

- Never create bookings/profiles automatically from scouting.
- Only public HTTP(S) sources may be scouted.
- Results must be tied to evidence actually used in the scout response.
- CRM duplicate/match comparison happens locally; CRM contents are not sent to the web provider.
- Date window is required and bounded to at most 366 days.
- Persist scouting output on the originating research run so refresh does not lose it.

---

### Task 1: Source Scout domain/provider

**Files:**
- Create: `artifacts/api-server/src/features/profile-research/profile-research-source-scout.ts`
- Create: `artifacts/api-server/src/features/profile-research/profile-research-source-scout.test.ts`

**Interfaces:**
- Consumes: source URL, `startDate`, `endDate`, optional source title.
- Produces: normalized `{ sourceUrl, startDate, endDate, events[] }` with evidence-backed event candidates.

- [ ] Write failing tests for safe URL, bounded date window, evidence URL requirement, duplicate event removal, and max-result bound.
- [ ] Run the focused test and verify it fails for missing implementation.
- [ ] Implement normalization/validation and the OpenAI web-search provider prompt.
- [ ] Run the focused test and verify it passes.

---

### Task 2: Persist scout results on research runs

**Files:**
- Modify: `artifacts/api-server/src/features/profile-research/profile-research-repository.ts`
- Create: `artifacts/api-server/src/features/profile-research/profile-research-source-scout-service.ts`
- Create: `artifacts/api-server/src/features/profile-research/profile-research-source-scout-service.test.ts`

**Interfaces:**
- Consumes: profile ID, run ID, safe source scout request.
- Produces: updated research run with `summary.sourceScouts[]` including CRM match labels.

- [ ] Write failing service/repository tests for run ownership, complete-run requirement, local CRM matching, summary merge, and replacement of the same source/date-window scout rather than duplicate append.
- [ ] Add repository `updateSummary(profileId, runId, summary)` guarded by run ownership.
- [ ] Implement service using existing `matchRelatedEventsAgainstCrm`.
- [ ] Verify focused tests.

---

### Task 3: Add authenticated scout route

**Files:**
- Modify: `artifacts/api-server/src/routes/profile-research.ts`
- Create: `artifacts/api-server/src/routes/profile-research-source-scout.test.ts`

**Interfaces:**
- `POST /event-profiles/:id/research/:runId/scout-source`
- Body: `{ sourceUrl, sourceTitle?, startDate, endDate }`
- Response: `{ run }`

- [ ] Write route contract tests for invalid URL/date window and successful service handoff.
- [ ] Add strict Zod request schema.
- [ ] Map not-found/not-ready errors to 404/409 and provider failure to a safe 500 message.
- [ ] Verify route tests.

---

### Task 4: Source Scout UI

**Files:**
- Modify: `artifacts/adventure-zone/src/components/profiles/profile-research-panel.tsx`
- Create: `artifacts/adventure-zone/src/components/profiles/profile-research-source-scout-release2.test.ts`

**Interfaces:**
- Consumes: existing research sources and persisted `summary.sourceScouts`.
- Produces: `Scout this source` launcher, date-window form, persisted results list, CRM status labels, source links.

- [ ] Write failing UI contract for source launcher, required from/to dates, Scout action, busy/error state, persisted scout heading, and no Add/Create Lead button.
- [ ] Add launcher to cited research sources and related-event source actions.
- [ ] Add date-window form defaulting to a practical upcoming range but editable before the request.
- [ ] Render scout results grouped by source/date window with `Already in Command Center`, `Possible match`, and `New prospect`.
- [ ] Verify focused frontend tests.

---

### Task 5: Release verification

- [ ] Run focused API Source Scout tests.
- [ ] Run focused frontend Source Scout tests.
- [ ] Run frontend/API builds used by CI.
- [ ] Confirm no prospect/bookings are created by any Source Scout endpoint.
- [ ] Keep PR draft if GitHub Actions again executes zero steps; report infrastructure-blocked verification separately.

## Self-Review

- Spec coverage: one-source deliberate scouting, date-window control, evidence-backed discovery, persisted results, local CRM comparison, and no automatic writes are covered.
- Release boundary: prospect intake/creation is intentionally deferred to Release 3.
- Type consistency: Source Scout result objects reuse the existing related-event shape and CRM match union where possible.
- No schema migration required: results live inside existing research-run `summary` JSONB.
