# General Assistant Mode and Profile Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin Booking Assistant usable with no open profile, treat side-profile/detail-sheet previews as temporary real context, and let the assistant find/select CRM profiles conversationally.

**Architecture:** Refactor the admin `AssistantContextProvider` from one nullable context into page, transient, and explicit context layers with a computed effective context. Add an authenticated server-side profile-search/general-assistant capability that uses explicit repositories and deterministic intent routing, then extend the existing drawer with General Command Center mode and structured profile result cards. Existing concrete Booking Assistant context/brief/offline behavior remains unchanged once a concrete context is selected.

**Tech Stack:** TypeScript, React, Vite, Wouter, Express, PostgreSQL/Drizzle where existing repositories use it, Zod, Vitest/Testing Library, existing owner/admin auth, existing Booking Assistant service and offline cache.

**Spec:** `docs/superpowers/specs/2026-08-17-assistant-general-mode-profile-search-design.md`

## Global Constraints

- General mode is owner/admin-only and must not be exposed through Manager Assistant routes.
- `null` effective context is a valid **General Command Center** mode; it is not an error state.
- Context priority is `transientContext ?? explicitContext ?? pageContext ?? null` while a transient side profile is open; closing it restores the explicit/page/general context underneath.
- Pages register canonical IDs only; browser code must not infer a profile ID from display text.
- Profile retrieval/search stays server-side through explicit repositories. Never allow model-generated SQL or arbitrary query filters.
- Search results are bounded to 8 by default.
- General mode must not mutate CRM records, send messages, complete follow-ups, or change bookings.
- Concrete-context Booking Brief, sourced Q&A, conversation persistence, and existing offline cache continue to work as they do now.
- Do not cache the entire CRM solely to make General profile search work offline.
- Manager Assistant remains leg-scoped and separate from admin-wide profile search.

---

### Task 1: Refactor Assistant context layering and make General mode valid

**Files:**
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-context.tsx`
- Modify: `artifacts/adventure-zone/src/components/assistant/assistant-context-registration.tsx`
- Modify: `artifacts/adventure-zone/src/components/assistant/assistant-launcher.tsx`
- Create: `artifacts/adventure-zone/src/features/assistant/assistant-context.test.tsx`

**Interfaces:**
- Produces:

```ts
type AssistantContextValue = {
  pageContext: ActiveAssistantContext;
  transientContext: ActiveAssistantContext;
  explicitContext: ActiveAssistantContext;
  activeContext: ActiveAssistantContext;
  setPageContext(context: ActiveAssistantContext): void;
  setTransientContext(context: ActiveAssistantContext): void;
  clearTransientContext(): void;
  selectExplicitContext(context: Exclude<ActiveAssistantContext, null>): void;
  clearExplicitContext(): void;
  isOpen: boolean;
  prefill: string;
  openAssistant(prefill?: string): void;
  closeAssistant(): void;
};
```

- Effective context rule:

```ts
const activeContext = transientContext ?? explicitContext ?? pageContext ?? null;
```

- Page navigation registration clears a stale explicit context when a different canonical page context becomes active.

- [ ] **Step 1: Write failing context-priority tests**

Test these exact cases:

```ts
expect(active()).toBeNull();
setPage(profileA);
expect(active()).toEqual(profileA);
selectExplicit(profileB);
expect(active()).toEqual(profileB);
setTransient(profileC);
expect(active()).toEqual(profileC);
clearTransient();
expect(active()).toEqual(profileB);
clearExplicit();
expect(active()).toEqual(profileA);
```

Also test that registering a different page context clears a stale explicit search selection, while opening/closing transient context never destroys the underlying explicit/page state.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm exec vitest run artifacts/adventure-zone/src/features/assistant/assistant-context.test.tsx
```

Expected: fail because the provider exposes only `activeContext/setActiveContext` today.

- [ ] **Step 3: Implement the layered provider**

Replace the single `useState<ActiveAssistantContext>` with three states and expose the methods above. Preserve `openAssistant`, `closeAssistant`, `prefill`, and `isOpen`.

- [ ] **Step 4: Convert `AssistantContextRegistration` to page registration**

It should call `setPageContext(...)` on mount and clear only its own page registration on unmount. It must not directly erase transient/explicit state.

- [ ] **Step 5: Keep launcher enabled in General mode**

`AssistantLauncher` should still show the active label when one exists; otherwise it simply shows `Assistant`. No disabled/null-context behavior.

- [ ] **Step 6: Run focused tests and commit**

```bash
pnpm exec vitest run artifacts/adventure-zone/src/features/assistant/assistant-context.test.tsx
git add artifacts/adventure-zone/src/features/assistant/assistant-context.tsx artifacts/adventure-zone/src/components/assistant/assistant-context-registration.tsx artifacts/adventure-zone/src/components/assistant/assistant-launcher.tsx artifacts/adventure-zone/src/features/assistant/assistant-context.test.tsx
git commit -m "feat: add layered assistant context"
```

### Task 2: Add deterministic profile-search contracts and repository

**Files:**
- Create: `artifacts/api-server/src/features/assistant/profile-search-types.ts`
- Create: `artifacts/api-server/src/features/assistant/profile-search-input.ts`
- Create: `artifacts/api-server/src/features/assistant/profile-search-repository.ts`
- Create: `artifacts/api-server/src/features/assistant/profile-search-repository.test.ts`

**Interfaces:**

```ts
export type AssistantProfileSearchResult = {
  id: string;
  kind: "organization" | "contact" | "event_family";
  label: string;
  secondaryLabel: string | null;
  city: string | null;
  region: string | null;
  status: string | null;
  lastContactAt: string | null;
  bookingCount: number | null;
  matchedOn: string[];
};

export type ProfileSearchRequest = {
  query: string;
  city?: string;
  region?: string;
  packageName?: string;
  overdueFollowUp?: boolean;
  limit: number;
};

export interface ProfileSearchRepository {
  search(input: ProfileSearchRequest): Promise<AssistantProfileSearchResult[]>;
}
```

- [ ] **Step 1: Write failing repository tests** for:
  - exact organization name,
  - partial organization name,
  - contact first/last name,
  - city/region,
  - event family name/member organization,
  - package-history filtering through `booking_package_selections`,
  - overdue open follow-up filtering,
  - canonical/consolidated organization dedupe,
  - result order and `limit <= 8` default.

Use a fake/search-row adapter if direct database integration would make the unit test brittle; ranking/deduplication must still be exercised as real code.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/profile-search-repository.test.ts
```

- [ ] **Step 3: Implement strict Zod input parsing**

```ts
export const profileSearchInputSchema = z.object({
  q: z.string().trim().min(1).max(240),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(80).optional(),
  packageName: z.string().trim().max(160).optional(),
  overdueFollowUp: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
}).strict();
```

Do not accept SQL fragments, field names, operators, or arbitrary filter objects.

- [ ] **Step 4: Implement bounded server-side search/ranking**

Use parameterized SQL/repository queries only. Ranking order:
1. exact normalized label,
2. prefix/token name match,
3. contact identity match,
4. city/region,
5. event-family/member match,
6. structured status/follow-up/package signals,
7. fuzzy similarity only as a final aid if current database extensions already support it.

Canonicalize consolidated organizations using the existing surviving-profile relationship instead of returning retired duplicates.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/profile-search-repository.test.ts
git add artifacts/api-server/src/features/assistant/profile-search-*
git commit -m "feat: add assistant profile search"
```

### Task 3: Add General Assistant deterministic intent routing and API routes

**Files:**
- Create: `artifacts/api-server/src/features/assistant/general-assistant.ts`
- Create: `artifacts/api-server/src/features/assistant/general-assistant.test.ts`
- Modify: `artifacts/api-server/src/routes/assistant.ts`
- Modify: `artifacts/api-server/src/features/assistant/assistant-types.ts`

**Interfaces:**

```ts
export type GeneralAssistantResponse =
  | { kind: "profile_results"; text: string; results: AssistantProfileSearchResult[] }
  | { kind: "answer"; answer: AssistantAnswer }
  | { kind: "needs_context"; text: string };

export async function answerGeneralAssistant(input: {
  question: string;
  profileSearch: ProfileSearchRepository;
}): Promise<GeneralAssistantResponse>;
```

Routes:

```text
GET  /assistant/profile-search?q=...
POST /assistant/general/ask
```

They remain after `requireOwnerMiddleware` in the current router arrangement.

- [ ] **Step 1: Write failing intent tests** for:
  - `Find Morton County Fair` -> profile results,
  - `Find the profile for Lisa in Dickinson` -> name/city profile search,
  - `Find profiles in Minnesota` -> region filter,
  - `Who has overdue follow-ups?` -> structured search,
  - `Who usually books Pirate's Rebellion?` -> package-history search,
  - unknown request -> `needs_context` or safe general answer, never arbitrary database access.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/general-assistant.test.ts
```

- [ ] **Step 3: Implement a compact deterministic matcher**

Normalize question text and map only supported patterns into a `ProfileSearchRequest`. Do not build a generic natural-language-to-SQL layer.

- [ ] **Step 4: Add thin authenticated routes**

`GET /assistant/profile-search` validates `profileSearchInputSchema` and calls the repository directly.

`POST /assistant/general/ask` validates:

```ts
z.object({ question: z.string().trim().min(1).max(4000) }).strict()
```

then calls `answerGeneralAssistant`.

- [ ] **Step 5: Add route tests for auth/validation/result bounds**

Verify malformed filter objects, `legId`, arbitrary `where`, and SQL-looking payload fields are rejected because the schemas are strict.

- [ ] **Step 6: Run tests and commit**

```bash
pnpm exec vitest run artifacts/api-server/src/features/assistant/general-assistant.test.ts
git add artifacts/api-server/src/features/assistant/general-assistant* artifacts/api-server/src/routes/assistant.ts artifacts/api-server/src/features/assistant/assistant-types.ts
git commit -m "feat: add general assistant search routes"
```

### Task 4: Add General-mode frontend API and structured result cards

**Files:**
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-api.ts`
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-types.ts`
- Create: `artifacts/adventure-zone/src/components/assistant/profile-search-results.tsx`
- Create: `artifacts/adventure-zone/src/components/assistant/profile-search-results.test.tsx`

**Interfaces:**

```ts
export async function askGeneralAssistant(question: string): Promise<GeneralAssistantResponse>;

export async function searchAssistantProfiles(query: string): Promise<AssistantProfileSearchResult[]>;
```

Result card callbacks:

```ts
type ProfileSearchResultsProps = {
  results: AssistantProfileSearchResult[];
  onUseContext(result: AssistantProfileSearchResult): void;
  onOpenProfile(result: AssistantProfileSearchResult): void;
};
```

- [ ] **Step 1: Write failing result-card tests**

Verify label, location/secondary label, matched reasons, `Open profile`, and `Use as context` render and invoke the correct result.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm exec vitest run artifacts/adventure-zone/src/components/assistant/profile-search-results.test.tsx
```

- [ ] **Step 3: Implement frontend types/API methods**

General mode must not call `loadAssistantSnapshot(null)` or concrete `/assistant/ask`; it calls `/assistant/general/ask`.

- [ ] **Step 4: Implement result cards without raw HTML injection**

Route mapping:
- organization -> `/profiles/:id`
- contact -> `/contacts/:id`
- event_family -> existing canonical event-family route used by `EventFamilyPage`.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm exec vitest run artifacts/adventure-zone/src/components/assistant/profile-search-results.test.tsx
git add artifacts/adventure-zone/src/features/assistant/assistant-api.ts artifacts/adventure-zone/src/features/assistant/assistant-types.ts artifacts/adventure-zone/src/components/assistant/profile-search-results*
git commit -m "feat: render assistant profile search results"
```

### Task 5: Make the Booking Assistant drawer work in General mode

**Files:**
- Modify: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.tsx`
- Test: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx`

**Interfaces:**
- Consumes `activeContext`, `selectExplicitContext`, `clearExplicitContext` from Task 1.
- Consumes `askGeneralAssistant` and `GeneralAssistantResponse` from Task 4.

- [ ] **Step 1: Write failing drawer tests** proving:
  - no context shows `General Command Center`,
  - textarea and Ask button can be used with no profile open,
  - concrete mode still loads Booking Brief,
  - General search result cards render,
  - `Use as context` keeps drawer open and switches active context,
  - `Back to general` clears explicit selection,
  - zero results show a normal no-match message.

- [ ] **Step 2: Run the drawer tests and verify RED**

```bash
pnpm exec vitest run artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx
```

- [ ] **Step 3: Split submit handling by effective context**

```ts
if (activeContext) {
  // existing concrete-context ask flow
} else {
  // askGeneralAssistant(submitted)
}
```

Do not clear concrete conversation/brief behavior unnecessarily.

- [ ] **Step 4: Implement General-mode empty state and prompts**

Show:
- `General Command Center`
- `No profile selected`
- prompt buttons: `Find a profile`, `Who needs follow-up?`, `Find an event by city`, `Who usually books Pirate's Rebellion?`

Do not render `BookingBriefCard` in General mode.

- [ ] **Step 5: Implement `Use as context`**

Map result kinds to concrete assistant context kinds and call `selectExplicitContext`. Keep drawer open; clear/collapse results; immediately let the existing context-loading effect load the concrete brief/conversation.

- [ ] **Step 6: Implement `Open profile` navigation**

Use Wouter navigation to canonical record route, and clear explicit selection before navigation so the destination page registration becomes authoritative.

- [ ] **Step 7: Run tests and commit**

```bash
pnpm exec vitest run artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx
git add artifacts/adventure-zone/src/components/assistant/assistant-drawer.tsx artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx
git commit -m "feat: enable general booking assistant mode"
```

### Task 6: Add reusable transient-context registration for side profiles/detail sheets

**Files:**
- Create: `artifacts/adventure-zone/src/components/assistant/assistant-transient-context.tsx`
- Create: `artifacts/adventure-zone/src/components/assistant/assistant-transient-context.test.tsx`
- Modify: existing admin side-profile/detail-sheet/preview components identified below during implementation.

**Interfaces:**

```ts
export function AssistantTransientContext({
  open,
  context,
}: {
  open: boolean;
  context: Exclude<ActiveAssistantContext, null> | null;
})
```

Behavior:
- `open && context` -> `setTransientContext(context)`
- close/unmount -> `clearTransientContext()`
- must never clear explicit/page context.

- [ ] **Step 1: Write failing transient registration tests**

Test page A -> open side profile B -> active B -> close -> active A. Also test explicit C underneath -> open B -> active B -> close -> active C.

- [ ] **Step 2: Run focused test and verify RED**

```bash
pnpm exec vitest run artifacts/adventure-zone/src/components/assistant/assistant-transient-context.test.tsx
```

- [ ] **Step 3: Implement the reusable registration component**

Keep it renderless, like `AssistantContextRegistration`.

- [ ] **Step 4: Inventory current admin preview surfaces before editing**

Search the current implementation branch for:

```bash
rg "ResponsiveDetailSheet|DetailSheet|profile preview|side profile|detailBookingId|selected.*Profile|selected.*Contact" artifacts/adventure-zone/src
```

For each admin preview that has a canonical organization/contact/event-family/booking ID, register that ID while its sheet is open. Do **not** modify Manager portal preview surfaces to use the admin Booking Assistant.

- [ ] **Step 5: Add at least one integration test for the actual profile side-preview surface**

Open the preview, assert the Assistant header/context label changes to that profile, close the preview, assert the previous page/general context returns.

- [ ] **Step 6: Run tests and commit**

```bash
pnpm exec vitest run artifacts/adventure-zone/src/components/assistant/assistant-transient-context.test.tsx
git add artifacts/adventure-zone/src/components/assistant/assistant-transient-context* artifacts/adventure-zone/src
# Stage only the actual side-preview files changed.
git commit -m "feat: use side profiles as assistant context"
```

### Task 7: Preserve offline truthfulness and cached-context selection

**Files:**
- Modify: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.tsx`
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-api.ts`
- Test: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx`
- Test: existing `artifacts/adventure-zone/src/features/assistant/assistant-offline-cache.test.ts`

**Interfaces:**
- General profile search is online-only in this release unless a specific concrete context is already in existing cache.

- [ ] **Step 1: Add failing offline tests**

Verify:
- General mode remains open offline,
- searching profiles offline returns `Profile search needs a connection` (or equivalent),
- it never says it searched all profiles while offline,
- selecting/using an already concrete cached context still uses existing offline behavior.

- [ ] **Step 2: Implement the general-mode network failure message**

Do not add a whole-CRM IndexedDB index.

- [ ] **Step 3: Run offline tests and commit**

```bash
pnpm exec vitest run artifacts/adventure-zone/src/features/assistant/assistant-offline-cache.test.ts artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx
git add artifacts/adventure-zone/src/features/assistant/assistant-api.ts artifacts/adventure-zone/src/components/assistant/assistant-drawer.tsx artifacts/adventure-zone/src/features/assistant/assistant-offline-cache.test.ts artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx
git commit -m "test: protect general assistant offline behavior"
```

### Task 8: Add focused CI and release verification

**Files:**
- Create: `.github/workflows/assistant-general-mode-ci.yml`

- [ ] **Step 1: Add a focused PR workflow** that runs when these areas change:
  - `artifacts/api-server/src/features/assistant/**`
  - `artifacts/api-server/src/routes/assistant.ts`
  - `artifacts/adventure-zone/src/features/assistant/**`
  - `artifacts/adventure-zone/src/components/assistant/**`
  - admin side-profile/detail-sheet files changed in Task 6
  - the new spec/plan only if desired for docs review.

Workflow commands:

```bash
pnpm install --frozen-lockfile
pnpm exec vitest run \
  artifacts/api-server/src/features/assistant/profile-search-repository.test.ts \
  artifacts/api-server/src/features/assistant/general-assistant.test.ts \
  artifacts/adventure-zone/src/features/assistant/assistant-context.test.tsx \
  artifacts/adventure-zone/src/components/assistant/profile-search-results.test.tsx \
  artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx \
  artifacts/adventure-zone/src/components/assistant/assistant-transient-context.test.tsx \
  artifacts/adventure-zone/src/features/assistant/assistant-offline-cache.test.ts
pnpm run typecheck
pnpm run build
```

- [ ] **Step 2: Run/inspect focused CI**

Do not call the release verified unless tests, typecheck, and build actually execute and pass. If GitHub still blocks Actions before runner startup, record that as an external blocker and keep the PR draft.

- [ ] **Step 3: Manual verification checklist**

Verify all of these in the app:
1. Open Assistant from Today/Home with no profile -> input works.
2. Ask `Find Morton County Fair` -> ranked profile cards appear.
3. `Use as context` -> drawer stays open and Booking Brief loads.
4. Ask `What happened last year?` -> answer uses selected customer without restating the name.
5. `Back to general` -> General mode returns.
6. Open a side profile -> Assistant immediately changes to that profile.
7. Close side profile -> previous explicit/page/general context returns.
8. Open a full profile -> page context becomes active and stale explicit search selection is cleared.
9. Search by contact/city/region/package/overdue follow-up works.
10. General search while offline clearly says connection is required.
11. Manager portal does not gain admin general CRM search.
12. No general assistant action mutates CRM records.

- [ ] **Step 4: Review branch diff against latest `main`**

```bash
git diff --stat main...HEAD
git diff main...HEAD -- artifacts/api-server/src/features/assistant artifacts/api-server/src/routes/assistant.ts artifacts/adventure-zone/src/features/assistant artifacts/adventure-zone/src/components/assistant
```

Sync latest `main` before final review if it moved; inspect overlap before merging.

- [ ] **Step 5: Open draft PR and update it with exact verification status**

Suggested title:

`Booking Assistant: general mode, side profiles, and profile search`

Keep draft until verification passes.
