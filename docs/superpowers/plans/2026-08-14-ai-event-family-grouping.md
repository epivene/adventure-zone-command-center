# AI Event Family Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group similar recurring or holiday events such as Fourth of July, Independence Day, Oktoberfest, and Christmas festivals into editable family pages without merging, retiring, or deleting their individual CRM profiles.

**Architecture:** Add independent `event_families`, `event_family_members`, and `event_family_suggestions` tables. A deterministic classifier handles obvious holiday aliases first; the configured AI provider reviews only unresolved profile names and limited location metadata. Suggestions require user approval before memberships are created, and existing organization records remain authoritative for contacts, notes, bookings, follow-ups, status, and travel legs.

**Tech Stack:** TypeScript 5.9, React, Express, Drizzle ORM, PostgreSQL, Zod, Vitest, existing provider-agnostic AI completion client, Wouter.

## Global Constraints

- Event-family grouping is non-destructive: never populate `organizations.consolidated_into_id`, delete an organization, or move its CRM records.
- Send only organization ID, name, place type, city, and region to the AI provider; never send notes, call history, contact details, bookings, or follow-up text.
- Obvious aliases use deterministic rules before AI so Fourth/4th of July, Independence Day, Oktoberfest/Octoberfest, and defined seasonal aliases behave consistently.
- AI output is a suggestion only and must be validated against the submitted candidate IDs.
- Membership changes require explicit owner approval and must be reversible.
- A profile may belong to at most one event family in the first release.
- An AI outage or malformed response leaves profiles ungrouped and returns a recoverable error.
- Build this from the latest `main` after profile-filter PR #86 is merged, or rebase the implementation branch onto the merge commit before opening its PR.

---

## File Structure

**Create**

- `lib/db/migrations/034_event_families.sql` — tables, constraints, indexes, and timestamps.
- `artifacts/api-server/src/features/event-families/event-family-classifier.ts` — deterministic alias normalization and grouping.
- `artifacts/api-server/src/features/event-families/event-family-classifier.test.ts` — alias and false-positive tests.
- `artifacts/api-server/src/features/event-families/event-family-ai.ts` — prompt construction, JSON parsing, validation, and confidence handling.
- `artifacts/api-server/src/features/event-families/event-family-ai.test.ts` — privacy, malformed-output, and membership validation tests.
- `artifacts/api-server/src/features/event-families/event-family-repository.ts` — persistence and transactional approval/removal operations.
- `artifacts/api-server/src/features/event-families/event-family-repository.pglite.test.ts` — database behavior tests.
- `artifacts/api-server/src/routes/event-families.ts` — list, detail, analyze, approve, dismiss, edit, and remove-member endpoints.
- `artifacts/api-server/src/routes/event-families.test.ts` — authenticated route tests.
- `artifacts/adventure-zone/src/features/event-families/event-family-types.ts` — frontend API types.
- `artifacts/adventure-zone/src/components/event-families/event-family-suggestions.tsx` — review/approve/dismiss interface.
- `artifacts/adventure-zone/src/components/event-families/event-family-suggestions.test.tsx` — suggestion workflow UI tests.
- `artifacts/adventure-zone/src/components/event-families/event-family-card.tsx` — compact family search card.
- `artifacts/adventure-zone/src/pages/EventFamilyPage.tsx` — family detail and member management page.
- `artifacts/adventure-zone/src/pages/EventFamilyPage.test.tsx` — detail-page behavior tests.

**Modify**

- `lib/db/src/schema/index.ts` — export family, membership, and suggestion schemas.
- `lib/db/src/migrations.ts` — register migration 034.
- `artifacts/api-server/src/routes/index.ts` — mount authenticated family routes.
- `artifacts/api-server/src/features/organizations/organization-repository.ts` — return family summaries alongside ungrouped profiles without hiding family members from direct access.
- `artifacts/api-server/src/routes/organizations.ts` — include family cards and family IDs in profile-list responses.
- `artifacts/adventure-zone/src/pages/OrganizationsPage.tsx` — fetch and render families and suggestion review.
- `artifacts/adventure-zone/src/components/organizations/organization-list.tsx` — place family cards before individual ungrouped profile cards and preserve filter behavior.
- `artifacts/adventure-zone/src/App.tsx` — register `/event-families/:familyId`.

---

### Task 1: Persistent Event-Family Model

**Files:**
- Create: `lib/db/migrations/034_event_families.sql`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `lib/db/src/migrations.ts`
- Test: `artifacts/api-server/src/features/event-families/event-family-repository.pglite.test.ts`

**Interfaces:**
- Produces: `eventFamilies`, `eventFamilyMembers`, and `eventFamilySuggestions` Drizzle tables.
- Invariant: `event_family_members.organization_id` is unique, enforcing one family per profile.

- [ ] **Step 1: Write the failing schema contract test**

Create the PGlite test and assert that one family accepts multiple organizations, the same organization cannot join two families, and deleting a family cascades only membership/suggestion rows—not organizations.

```ts
await db.insert(eventFamilies).values({ id: familyId, name: "Fourth of July", normalizedName: "fourth of july" });
await db.insert(eventFamilyMembers).values({ familyId, organizationId: firstOrgId, source: "approved_rule" });
await expect(db.insert(eventFamilyMembers).values({ familyId: secondFamilyId, organizationId: firstOrgId, source: "approved_ai" })).rejects.toThrow();
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run: `pnpm --filter @workspace/api-server exec vitest run src/features/event-families/event-family-repository.pglite.test.ts`

Expected: FAIL because the event-family tables and migration do not exist.

- [ ] **Step 3: Add migration 034 and Drizzle schemas**

The migration must create:

```sql
CREATE TABLE event_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE event_family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES event_families(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE RESTRICT,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_family_members_source_valid CHECK (source IN ('approved_rule','approved_ai','manual')),
  UNIQUE (family_id, organization_id)
);

CREATE TABLE event_family_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_name text NOT NULL,
  normalized_name text NOT NULL,
  candidate_ids jsonb NOT NULL,
  source text NOT NULL,
  confidence numeric(4,3) NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_family_suggestions_candidate_ids_array CHECK (jsonb_typeof(candidate_ids) = 'array'),
  CONSTRAINT event_family_suggestions_source_valid CHECK (source IN ('rule','ai')),
  CONSTRAINT event_family_suggestions_status_valid CHECK (status IN ('pending','approved','dismissed')),
  CONSTRAINT event_family_suggestions_confidence_valid CHECK (confidence >= 0 AND confidence <= 1)
);
```

- [ ] **Step 4: Register the migration and export schemas**

Follow the existing migration registry order in `lib/db/src/migrations.ts`; define indexes for family name, membership family ID, and pending suggestions.

- [ ] **Step 5: Run the schema test and typecheck**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/event-families/event-family-repository.pglite.test.ts
pnpm run typecheck:libs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db/migrations/034_event_families.sql lib/db/src/schema/index.ts lib/db/src/migrations.ts artifacts/api-server/src/features/event-families/event-family-repository.pglite.test.ts
git commit -m "feat: add event family data model"
```

---

### Task 2: Deterministic Holiday and Event Classifier

**Files:**
- Create: `artifacts/api-server/src/features/event-families/event-family-classifier.ts`
- Create: `artifacts/api-server/src/features/event-families/event-family-classifier.test.ts`

**Interfaces:**
- Consumes: `{ id, name, placeType, city, region }[]`.
- Produces: `classifyObviousEventFamilies(records): EventFamilyProposal[]`.
- Produces: `EventFamilyProposal = { proposedName: string; normalizedName: string; candidateIds: string[]; source: "rule" | "ai"; confidence: number; reason: string }`.

- [ ] **Step 1: Write failing alias tests**

Cover these exact expectations:

```ts
expect(classifyName("Bismarck 4th of July Celebration")?.normalizedName).toBe("fourth of july");
expect(classifyName("Mandan Independence Day Parade")?.normalizedName).toBe("fourth of july");
expect(classifyName("Dickinson Fourth of July Festival")?.normalizedName).toBe("fourth of july");
expect(classifyName("Downtown Octoberfest")?.normalizedName).toBe("oktoberfest");
expect(classifyName("Oktoberfest USA")?.normalizedName).toBe("oktoberfest");
expect(classifyName("Christmas Hardware Store")).toBeNull();
```

Also assert that a proposal requires at least two distinct candidate IDs and does not include profiles already assigned to a family.

- [ ] **Step 2: Run the classifier test and verify it fails**

Run: `pnpm --filter @workspace/api-server exec vitest run src/features/event-families/event-family-classifier.test.ts`

Expected: FAIL because the classifier is missing.

- [ ] **Step 3: Implement explicit alias rules**

Define a small reviewed rule table rather than a generic keyword merger:

```ts
const EVENT_FAMILY_RULES = [
  { name: "Fourth of July", aliases: [/\b(?:4th|fourth)\s+of\s+july\b/i, /\bindependence\s+day\b/i] },
  { name: "Oktoberfest", aliases: [/\boktoberfest\b/i, /\boctoberfest\b/i] },
  { name: "Christmas & Holiday Events", aliases: [/\bchristmas\s+(?:festival|parade|celebration|market)\b/i, /\bholiday\s+(?:festival|parade|celebration|market)\b/i] },
  { name: "Fall & Harvest Festivals", aliases: [/\bfall\s+festival\b/i, /\bharvest\s+festival\b/i] },
] as const;
```

Require event-like context in the alias itself. Do not classify a profile from a bare word such as “Christmas,” “Holiday,” “Fall,” or “July.”

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/event-families/event-family-classifier.test.ts
git add artifacts/api-server/src/features/event-families/event-family-classifier.ts artifacts/api-server/src/features/event-families/event-family-classifier.test.ts
git commit -m "feat: classify obvious event families"
```

---

### Task 3: Privacy-Safe AI Classifier

**Files:**
- Create: `artifacts/api-server/src/features/event-families/event-family-ai.ts`
- Create: `artifacts/api-server/src/features/event-families/event-family-ai.test.ts`
- Reuse: `artifacts/api-server/src/features/ai-suggestions/ai-client.ts`

**Interfaces:**
- Consumes: `AiCompletionClient` and unresolved `EventFamilyCandidate[]`.
- Produces: `suggestEventFamiliesWithAi(client, candidates): Promise<EventFamilyProposal[]>`.

- [ ] **Step 1: Write failing privacy and validation tests**

Use a fake client that captures the prompt. Assert the prompt contains only `id`, `name`, `placeType`, `city`, and `region`; assert it never contains fixture contact emails, phone numbers, notes, booking names, call outcomes, or follow-up text.

Test valid JSON, fenced JSON, malformed JSON, unknown candidate IDs, duplicate IDs, singleton groups, duplicate groups, and confidence outside `0..1`.

- [ ] **Step 2: Run the AI tests and verify they fail**

Run: `pnpm --filter @workspace/api-server exec vitest run src/features/event-families/event-family-ai.test.ts`

Expected: FAIL because the parser and prompt do not exist.

- [ ] **Step 3: Implement strict structured parsing**

The prompt must instruct the model to return only:

```json
[
  {
    "proposedName": "Fourth of July",
    "candidateIds": ["uuid-1", "uuid-2"],
    "confidence": 0.94,
    "reason": "Names describe the same recurring holiday event type"
  }
]
```

Parse with Zod, strip at most one Markdown code fence, normalize names, reject IDs not in the input set, require at least two unique IDs, and discard overlapping proposals by keeping the higher-confidence proposal. Return `[]` for malformed model output and log the parse failure at the route/service boundary without storing raw model text.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/event-families/event-family-ai.test.ts
git add artifacts/api-server/src/features/event-families/event-family-ai.ts artifacts/api-server/src/features/event-families/event-family-ai.test.ts
git commit -m "feat: add AI event family suggestions"
```

---

### Task 4: Repository and Transactional Approval Workflow

**Files:**
- Create: `artifacts/api-server/src/features/event-families/event-family-repository.ts`
- Expand test: `artifacts/api-server/src/features/event-families/event-family-repository.pglite.test.ts`

**Interfaces:**
- Produces: `listFamilies()`, `getFamily(id)`, `listPendingSuggestions()`, `replacePendingSuggestions(proposals)`, `approveSuggestion(id)`, `dismissSuggestion(id)`, `renameFamily(id, name)`, `removeMember(familyId, organizationId)`, and `addMember(familyId, organizationId)`.

- [ ] **Step 1: Add failing repository behavior tests**

Verify:

- approval creates or reuses a family by `normalized_name`;
- approval inserts every candidate exactly once and marks the suggestion approved;
- approval fails atomically when any candidate is missing, retired, or already belongs to another family;
- dismissing does not create memberships;
- removing a member leaves the organization and all related CRM rows unchanged;
- renaming updates both `name` and `normalized_name` and rejects a collision;
- replacing suggestions does not recreate a previously dismissed identical candidate group.

- [ ] **Step 2: Run repository tests and verify they fail**

Run: `pnpm --filter @workspace/api-server exec vitest run src/features/event-families/event-family-repository.pglite.test.ts`

- [ ] **Step 3: Implement transaction boundaries**

Use `database.transaction`. Lock the suggestion and candidate organization rows during approval. Sort and fingerprint candidate IDs for deduplication. Never update `organizations`, `contacts`, `activities`, `bookings`, or `follow_ups` during membership changes.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/event-families/event-family-repository.pglite.test.ts
git add artifacts/api-server/src/features/event-families/event-family-repository.ts artifacts/api-server/src/features/event-families/event-family-repository.pglite.test.ts
git commit -m "feat: add event family approval workflow"
```

---

### Task 5: Authenticated Event-Family API

**Files:**
- Create: `artifacts/api-server/src/routes/event-families.ts`
- Create: `artifacts/api-server/src/routes/event-families.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Interfaces:**
- `GET /api/event-families`
- `GET /api/event-families/:id`
- `GET /api/event-family-suggestions`
- `POST /api/event-family-suggestions/analyze`
- `POST /api/event-family-suggestions/:id/approve`
- `POST /api/event-family-suggestions/:id/dismiss`
- `PATCH /api/event-families/:id`
- `POST /api/event-families/:id/members`
- `DELETE /api/event-families/:id/members/:organizationId`

- [ ] **Step 1: Write failing authenticated route tests**

Test `401` without the owner token, `503` with `code: "NO_AI_PROVIDER_CONFIGURED"` when no AI provider exists, `400` for invalid UUIDs or empty names, `404` for missing resources, `409` for membership conflicts, and successful analyze/approve/dismiss/edit/remove flows.

- [ ] **Step 2: Run route tests and verify they fail**

Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/event-families.test.ts`

- [ ] **Step 3: Implement analyze orchestration**

The analyze endpoint must:

1. load active, non-retired, unassigned event-like profiles;
2. generate deterministic proposals;
3. exclude their candidate IDs from the AI request;
4. call `createAiClient()` only when unresolved candidates remain;
5. store validated proposals;
6. return counts for rule, AI, skipped, and pending suggestions.

- [ ] **Step 4: Mount routes and run tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/event-families.test.ts
pnpm --filter @workspace/api-server run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/event-families.ts artifacts/api-server/src/routes/event-families.test.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat: expose event family API"
```

---

### Task 6: Suggestion Review Interface

**Files:**
- Create: `artifacts/adventure-zone/src/features/event-families/event-family-types.ts`
- Create: `artifacts/adventure-zone/src/components/event-families/event-family-suggestions.tsx`
- Create: `artifacts/adventure-zone/src/components/event-families/event-family-suggestions.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/OrganizationsPage.tsx`

**Interfaces:**
- Consumes the suggestion and analyze endpoints from Task 5.
- Emits refresh callbacks after approve/dismiss so profile and family lists reload.

- [ ] **Step 1: Write failing UI tests**

Render proposals with family name, confidence label, reason, and candidate profile names/locations. Test Analyze, Approve, Dismiss, retry after API failure, disabled controls while saving, and preservation of a loaded list during background refresh.

- [ ] **Step 2: Run UI tests and verify they fail**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/components/event-families/event-family-suggestions.test.tsx`

- [ ] **Step 3: Implement the review card**

Use plain-language labels:

- `Exact name match` for rule suggestions;
- `AI suggestion · High confidence` for confidence `>= 0.85`;
- `AI suggestion · Review carefully` below `0.85`;
- buttons: `Group these events` and `Not related`.

Do not display raw prompts or provider responses.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/event-families/event-family-suggestions.test.tsx
git add artifacts/adventure-zone/src/features/event-families/event-family-types.ts artifacts/adventure-zone/src/components/event-families/event-family-suggestions.tsx artifacts/adventure-zone/src/components/event-families/event-family-suggestions.test.tsx artifacts/adventure-zone/src/pages/OrganizationsPage.tsx
git commit -m "feat: review event family suggestions"
```

---

### Task 7: Family Cards, Search Results, and Detail Page

**Files:**
- Create: `artifacts/adventure-zone/src/components/event-families/event-family-card.tsx`
- Create: `artifacts/adventure-zone/src/pages/EventFamilyPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/EventFamilyPage.test.tsx`
- Modify: `artifacts/api-server/src/features/organizations/organization-repository.ts`
- Modify: `artifacts/api-server/src/routes/organizations.ts`
- Modify: `artifacts/adventure-zone/src/components/organizations/organization-list.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`

**Interfaces:**
- Profile-list response adds `families: EventFamilyListRecord[]` and each organization record adds `eventFamilyId: string | null`.
- Family detail returns family metadata and member summaries containing organization ID, name, city, region, status, travel-leg names, contact count, booking count, and next follow-up date.

- [ ] **Step 1: Write failing list and detail tests**

Verify one family card appears for grouped search results, child profiles remain directly reachable, filters narrow family members using the same AND semantics as profile search, and a family disappears from results when none of its children match.

On the detail page, test rename, remove member with confirmation, add an unassigned profile, and links to each original profile.

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/event-families.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/EventFamilyPage.test.tsx
```

- [ ] **Step 3: Implement family-aware list aggregation**

Apply the existing profile condition first, then group matched organizations by `event_family_members.family_id`. Return family counts calculated from matched children while retaining total member counts for the card subtitle. Ungrouped profiles continue through the existing record list.

- [ ] **Step 4: Implement the family page and route**

Register:

```tsx
<Route path="/event-families/:familyId" component={EventFamilyPage} />
```

The page must never combine member timelines into one editable timeline. It shows roll-up counts and links; edits still occur on the individual profile.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/event-families.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/EventFamilyPage.test.tsx src/components/organizations/organization-list.test.tsx
git add artifacts/api-server/src/features/organizations/organization-repository.ts artifacts/api-server/src/routes/organizations.ts artifacts/adventure-zone/src/components/event-families/event-family-card.tsx artifacts/adventure-zone/src/pages/EventFamilyPage.tsx artifacts/adventure-zone/src/pages/EventFamilyPage.test.tsx artifacts/adventure-zone/src/components/organizations/organization-list.tsx artifacts/adventure-zone/src/App.tsx
git commit -m "feat: show event family profiles"
```

---

### Task 8: Full Verification and GitHub Handoff

**Files:**
- Review all files changed in Tasks 1–7.

- [ ] **Step 1: Run targeted suites**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/event-families src/routes/event-families.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/event-families src/pages/EventFamilyPage.test.tsx src/components/organizations/organization-list.test.tsx src/pages/OrganizationsPage.test.tsx
```

- [ ] **Step 2: Run full project checks**

```bash
pnpm run typecheck
pnpm --filter @workspace/api-server run test
pnpm run build
```

Expected: all commands exit `0` with no failed tests.

- [ ] **Step 3: Verify the privacy boundary manually**

Search the event-family prompt builder and confirm it references only `id`, `name`, `placeType`, `city`, and `region`:

```bash
rg -n "email|phone|note|activity|booking|follow.?up|call" artifacts/api-server/src/features/event-families/event-family-ai.ts
```

Expected: no private profile-field access; any matches occur only inside explicit prohibition text in the model instructions.

- [ ] **Step 4: Verify the non-destructive boundary**

```bash
rg -n "consolidatedIntoId|consolidated_into_id|delete\(organizations\)|update\(organizations\)" artifacts/api-server/src/features/event-families artifacts/api-server/src/routes/event-families.ts
```

Expected: no organization consolidation/deletion logic. A rename operation updates `event_families`, not `organizations`.

- [ ] **Step 5: Review the final Git diff**

Confirm the branch contains only event-family files and the intended profile-list/App integrations. Ensure no ACT importer, calling, calendar, or unrelated organization-consolidation changes are included.

- [ ] **Step 6: Push and open a draft PR**

Use branch `agent/ai-event-family-grouping`, target `main`, and include test results plus the privacy/non-destructive guarantees in the PR body.

