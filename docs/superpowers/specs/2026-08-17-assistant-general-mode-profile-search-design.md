# General Assistant Mode and Profile Search Design

## Goal

Make the Command Center Booking Assistant useful everywhere in the admin app, not only after a full profile or booking page has been opened. The assistant must support a valid general mode, treat side-profile/detail-sheet previews as real assistant context, search for profiles conversationally, and let the user switch assistant context from search results without leaving the drawer.

## User experience

### Assistant is always available

The persistent Booking Assistant launcher remains available throughout the authenticated admin Command Center even when there is no active customer/profile/booking context.

`activeContext = null` no longer means the assistant is unusable. It means the assistant is in **General Command Center mode**.

General mode should visibly identify itself with language such as:

- `General Command Center`
- `No profile selected`

The input remains enabled.

### Context priority

Assistant context follows this priority while the user navigates:

1. An explicitly selected assistant context, such as choosing `Use as context` from an assistant search result.
2. An open transient side profile/detail sheet/preview.
3. The canonical context of the current page, such as a full profile, booking, event family, call workspace, or route.
4. General Command Center mode.

Transient context must be reversible. Opening a side profile temporarily changes assistant context to that profile. Closing that side profile restores the context that was active immediately before the side profile opened rather than clearing context blindly.

An explicitly chosen profile from assistant search should remain selected until the user navigates into a new canonical context or explicitly clears/switches it.

### Side profiles count as profiles

Any existing side-profile, profile-preview, responsive detail sheet, preview drawer, or equivalent UI that represents a real organization/contact/profile must register the same canonical record ID that a full profile page would use.

When the side profile is open, the assistant should behave as though the user opened that profile fully for contextual questions such as:

- What happened last year?
- What do they normally book?
- What should I say when I call?
- What follow-up is due?

Closing the side profile restores the prior/page/general context.

### General-mode profile search

The assistant should understand common search/discovery requests without requiring cloud AI for basic matching, including questions equivalent to:

- Find Morton County Fair.
- Find the profile for Lisa in Dickinson.
- Find Water Lantern Festival.
- Find profiles in Minnesota.
- Find the customer I talked to last week.
- Who has overdue follow-ups?
- Who usually books Pirate's Rebellion?

The first release should implement deterministic search intents for profile lookup and filtering. Cloud AI may help interpret ambiguous natural-language requests, but actual result retrieval must use explicit server-side search tools/repositories and existing authorization.

The assistant must not let a model generate arbitrary SQL or unrestricted database filters.

## Search result model

Profile search returns structured result cards rather than only prose.

Suggested contract:

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
```

Each result card offers:

- **Open profile** — navigate to the existing full canonical profile/contact/family route.
- **Use as context** — keep the assistant drawer open and switch assistant context to that result.

Using a result as context should immediately allow follow-up questions without restating the customer name.

## General-mode capabilities

General mode is not an unrestricted autonomous agent. It is a thin orchestration layer over explicit Command Center capabilities.

Initial general-mode capabilities:

1. Search profiles/contacts/event families.
2. Find records by name, city/region, contact identity, status, package history, and open/overdue follow-up where supported by existing structured data.
3. Surface a small ranked result set with reasons/matched fields.
4. Switch assistant context to a selected search result.
5. Answer safe high-level workflow questions using existing Command Center data, such as overdue follow-up counts or likely next work, when a deterministic repository already supports the query.

General mode must not silently edit records, send emails, complete follow-ups, or mutate bookings.

## Search ranking

Search should prefer existing canonical records and deterministic matching.

Recommended ranking signals, in order:

1. exact normalized organization/event/contact name,
2. strong prefix/name token match,
3. matching contact name/email/phone where explicitly searched,
4. city/region match,
5. event-family/member-name match,
6. relevant structured status/follow-up/package signal,
7. fuzzy text match as a final ranking aid.

Deduplicate consolidated/redirected profiles using existing canonical profile behavior. The assistant should return the surviving/canonical record instead of presenting known duplicates as separate first-class results where current profile APIs already resolve them.

Search results should be bounded; initial maximum should be 8 results unless the user asks to see more.

## Context architecture

The existing `AssistantContextProvider` should distinguish three concepts rather than storing one fragile nullable value:

```ts
pageContext: ActiveAssistantContext | null
transientContext: ActiveAssistantContext | null
explicitContext: ActiveAssistantContext | null
```

Effective context is resolved by priority:

```ts
explicitContext ?? transientContext ?? pageContext ?? null
```

`null` effective context is valid General mode.

Pages register `pageContext`.
Side profiles/detail sheets register `transientContext` only while open.
Assistant search `Use as context` sets `explicitContext`.

Navigating to a new canonical page context should clear an old explicit context when that explicit selection no longer matches the navigation intent. Opening/closing a transient preview must not erase page or explicit state underneath it.

Provide intentional APIs rather than direct setter reuse:

```ts
setPageContext(context)
setTransientContext(context)
clearTransientContext()
selectExplicitContext(context)
clearExplicitContext()
```

The UI consumes only the computed effective context.

## Backend general assistant routes

Keep context-specific `/assistant/context`, `/assistant/brief`, and `/assistant/ask` behavior for concrete records.

Add explicit general-mode/search capability rather than inventing a fake CRM UUID for `general`.

Recommended routes:

```text
POST /api/assistant/general/ask
GET  /api/assistant/profile-search?q=...
```

or an equivalent thin route structure following current route conventions.

General ask may return one of:

```ts
export type GeneralAssistantResponse =
  | { kind: "profile_results"; text: string; results: AssistantProfileSearchResult[] }
  | { kind: "answer"; answer: AssistantAnswer }
  | { kind: "needs_context"; text: string };
```

Profile search remains server-authenticated with the current owner/admin authorization layer.

## Intent routing

The assistant should attempt deterministic general intents before cloud AI.

Examples:

- `find/search/show profile/contact/customer/event` -> profile search
- explicit city/region terms -> profile search filter
- `overdue follow-ups`, `who needs called`, `what should I work on` -> structured workflow query if supported
- package-history discovery -> structured profile search using package booking history

Unknown general questions may use cloud AI only with a compact set of permitted general tools/results. The model must not receive the entire CRM or unrestricted raw ACT history merely because no profile is selected.

## Side-profile integration

All profile preview surfaces should use a small reusable registration component/hook such as:

```ts
useAssistantTransientContext({
  open,
  context: { kind: "organization", recordId: profileId, label: profileName },
});
```

The implementation should identify existing side-profile/detail-sheet surfaces and attach the canonical organization/contact/event-family ID they already render.

If a preview is only a booking/event preview but contains a canonical booking ID, it may register booking context instead.

Do not infer a profile by label text in the browser; use canonical IDs already supplied to the preview component.

## Drawer behavior

### General mode

When no effective context exists:

- drawer opens normally,
- title/subtitle show General Command Center mode,
- input is enabled,
- Booking Brief is omitted,
- suggested prompts focus on search/workflow discovery,
- search results render as interactive cards.

Suggested prompts:

- Find a profile
- Who needs follow-up?
- Find an event by city
- Who usually books Pirate's Rebellion?

### Context mode

When a concrete effective context exists, retain existing Booking Brief, sourced Q&A, conversation, and offline behavior.

### Switching from results

`Use as context` should:

1. set explicit context,
2. clear the result list or collapse it,
3. load the new Booking Brief/context bundle,
4. keep the drawer open,
5. display a visible context chip/header with the selected profile,
6. allow a `Clear`/`Back to general` action.

`Open profile` navigates to the canonical record and lets normal page registration take over.

## Offline behavior

General profile search requires cached searchable data to work offline and should not silently imply it searched the full CRM when disconnected.

First release behavior:

- concrete previously opened contexts continue using the existing offline assistant cache,
- General mode itself remains usable for basic help text,
- if no local search index has been deliberately cached, profile search while offline says that profile search requires a connection,
- selecting a previously cached context may still work offline if it is available through existing cached context data.

Do not cache the entire CRM solely to support offline profile search in this expansion.

## Privacy and authorization

1. General mode is admin/owner only, just like the current Booking Assistant.
2. All search is performed server-side through explicit repositories/routes.
3. A cloud model cannot widen database access or execute arbitrary filters.
4. Side-profile context uses canonical IDs already authorized by the admin UI.
5. Search result cards expose only fields already appropriate to the admin CRM.
6. Existing Manager Assistant remains separate and leg-scoped; this change must not turn manager general mode into admin CRM search.

## Error handling

- Zero search results: say no matching profiles were found and offer a broader search.
- Ambiguous query: show ranked candidates rather than guessing one profile.
- Failed general AI provider: deterministic search/general tools continue to work.
- Side profile closes: restore prior effective context deterministically.
- Selected profile disappears/consolidates: backend canonical resolution should return the surviving record or a clean not-found result.

## Testing

### Context priority

Tests must prove:

- no context -> General mode and input enabled,
- page profile -> page context,
- side profile opens -> transient profile wins,
- side profile closes -> previous page/explicit context restored,
- explicit search selection -> explicit context wins,
- explicit context clear -> underlying transient/page/general context returns,
- navigation to a new canonical page clears stale explicit selection according to implementation rule.

### Search

Tests must cover:

- exact organization name,
- partial name,
- contact name,
- city/region,
- event family/member,
- package-history filter,
- overdue follow-up query where supported,
- canonical/deduplicated result behavior,
- zero results,
- result bound/ranking,
- auth required.

### Drawer

Tests must cover:

- launcher works with no profile open,
- General mode input remains enabled,
- result cards render,
- Use as context keeps drawer open and loads concrete context,
- Open profile navigates correctly,
- side preview automatically updates assistant label/context,
- closing preview restores previous context.

### Safety

Tests must prove:

- general search cannot pass arbitrary SQL/filter expressions,
- cloud AI receives only permitted tool/search results,
- general-mode request never performs record mutation,
- manager portal cannot access admin general profile search.

## Release boundary

This expansion does not add autonomous CRM writes, bulk messaging, full offline CRM search, or a universal SQL agent. It makes the existing Booking Assistant useful as the starting point for work by adding General mode, explicit profile discovery, structured result cards, and correct transient side-profile context.