# Profile Research & Enrichment Design

## Goal

Let a booking user research an incomplete event/profile using the profile information, imported ACT history, existing contacts/bookings/follow-ups, and live internet research, then review evidence-backed suggestions before choosing which facts to add to Command Center.

The feature should reduce manual Google/ACT digging without allowing AI or web research to silently change CRM data.

## Core User Experience

A profile gets a **Research profile** action.

When opened, the user chooses one of two modes:

- **Quick Research** — fill obvious gaps and verify basic profile facts.
- **Deep Research** — build a broader booking/research brief in addition to filling profile gaps.

The research flow is read-only until the user explicitly approves suggested changes.

### Quick Research targets

Quick Research should prioritize fields that directly improve the existing event profile:

- official website
- public phone number
- street/mailing address
- city
- state/region
- ZIP/postal code
- event/organization category when confidently inferable
- primary event/organizer contact name
- contact role/title
- public contact email
- public contact phone
- current/next event dates when available
- official social/event page URLs as supporting sources, even if they are not first-class profile fields yet

Research should start from the facts already present in Command Center rather than relying on event name alone. Search terms may use:

- organization/event name
- city/state
- existing website fragments
- known contact names
- prior booking names/dates
- event-family or organization-group context
- imported ACT notes/history
- confirmed Assistant derived facts
- previous call/activity notes

### Deep Research targets

Deep Research includes Quick Research and may additionally summarize:

- what the event appears to be
- likely or published event dates
- organizer/decision-maker clues
- venue/location
- approximate attendance only when a credible source publishes it
- entertainment/attraction offerings relevant to Adventure Zone
- known prior Adventure Zone history from Command Center
- recent changes in organizer/contact information
- likely fit for outreach
- a suggested next action
- personalized outreach hooks grounded in sources

Deep Research must clearly distinguish externally verified facts from CRM history and from weaker inferences.

## Research Sources

### Internal sources

The researcher should reuse existing Command Center context instead of creating a second CRM context layer:

- organization/event profile
- contacts and organization-contact roles
- current and historical bookings
- follow-ups
- activities/notes/call outcomes
- cleaned imported ACT history
- event-family / organization membership context
- confirmed/proposed Assistant derived facts
- existing Booking Assistant context/brief infrastructure where useful

Raw ACT HTML should not be passed through to the user as evidence; existing cleanup/simplification rules should be reused.

### Internet sources

The service may research public web sources such as:

- official event or organization websites
- official contact/about pages
- official city/county/parks pages
- tourism or chamber pages
- fair/festival association listings
- official public social pages/event pages when discoverable
- reputable local government/community listings
- other public pages that materially support a proposed fact

For identity-sensitive fields, an official source should be preferred over aggregators. Search-result snippets alone should not be treated as sufficient evidence when the underlying source can be opened and checked.

## Identity Matching and Duplicate Safety

Research must first determine whether a web result plausibly represents the same event/profile.

Identity matching should consider combinations of:

- normalized name similarity
- city/state
- event dates/seasons
- known organizer/contact names
- venue
- official domain
- historical notes
- event-family/organization context

The service must not merge profiles, create event-family membership, or consolidate organizations as part of research.

If a result could reasonably describe a different event with the same/similar name, suggestions must be marked **Possible match — review** rather than presented as verified.

## Suggested-Fact Model

Research returns proposals, not direct mutations.

Each proposed fact should contain enough information to review independently:

```ts
export type ResearchConfidence = "high" | "medium" | "low";

export type ProfileResearchSuggestion = {
  id: string;
  targetKind: "organization" | "contact" | "booking";
  targetId: string | null;
  field: string;
  currentValue: string | null;
  suggestedValue: string;
  confidence: ResearchConfidence;
  rationale: string;
  sourceIds: string[];
  conflict: boolean;
};

export type ProfileResearchSource = {
  id: string;
  kind: "internal" | "web";
  title: string;
  url: string | null;
  publisher: string | null;
  retrievedAt: string;
  excerpt: string;
};
```

The exact implementation may use equivalent types, but the API must preserve these semantics.

## Confidence Rules

**High confidence** generally requires strong identity matching plus a direct/official source for the specific fact.

Examples:

- website linked from the official city/event page
- event dates published on the official event site
- organizer email on an official contact page

**Medium confidence** may be used when multiple credible sources agree but the source is not authoritative, or when identity is strong but the fact is indirectly stated.

**Low confidence** is appropriate for useful but weak clues or inferred matches. Low-confidence facts must never be preselected for applying.

Any direct conflict between the current CRM value and a newly found value should be visually flagged regardless of confidence.

## Review UI

Research results should appear in a review sheet/page associated with the profile.

The result should include:

### Research summary

- mode used (Quick/Deep)
- what was searched
- whether the event identity appears strongly matched
- how many suggestions were found
- how many fields could not be verified

### Suggested updates

Each field is reviewable separately, for example:

- Website: old/blank → `https://examplefair.com`
- Phone: blank → `(701) 555-1234`
- 2027 dates: unknown → `July 16–18, 2027`
- Contact: `Melissa Anderson — Events Coordinator`

Each suggestion shows:

- confidence
- short rationale
- source/evidence links
- current value when one exists
- conflict warning when replacing an existing value
- checkbox/select control

Actions:

- **Add selected**
- **Add all high-confidence**
- **Dismiss** individual suggestion
- **Research again**

There is no unconditional "Add everything" action for low/medium-confidence suggestions.

## Applying Approved Changes

Approved suggestions should use existing profile/contact/booking write paths whenever possible.

The apply step must:

- require explicit user action
- re-read the current target values before writing
- reject or re-present a suggestion if the record changed since research began
- validate URLs, email addresses, phone values, region/state formats, and dates using existing domain validation
- preserve existing edit/history semantics
- record that the change originated from profile research where the existing audit/activity model allows it

Research must never automatically:

- send email
- place a call
- change booking probability/status
- create a follow-up
- delete a value
- merge organizations
- create event-family relationships
- replace a non-empty conflicting value without user selection

## Missing Information Detection

The profile UI may expose a small "Could use research" signal when important fields are missing.

Initial useful gaps:

- no website
- no phone
- no usable location
- no contacts
- no contact email/phone
- event has no dated upcoming booking when historical information suggests it recurs

This signal is advisory only and should not trigger internet work automatically.

Later, a separate bulk workflow may list **Profiles missing information**, but bulk/autonomous research is out of scope for the first release.

## Research Execution Architecture

### ProfileResearchContextBuilder

Build a bounded research seed from existing CRM/Assistant data.

Responsibilities:

- load profile/contact/booking context
- summarize useful historical clues
- remove noisy/system-only data
- cap note/history volume
- emit candidate search terms and known facts

It must not perform web access or write profile data.

### ProfileResearchProvider

Abstract the live internet-research capability behind an interface so the rest of Command Center does not depend on one search implementation.

Conceptual contract:

```ts
export interface ProfileResearchProvider {
  research(input: ProfileResearchRequest): Promise<ProfileResearchResult>;
}
```

The provider should support source-backed search/open/fetch behavior and return normalized sources plus proposed facts. Web/provider failures should be reported as research failures, not as missing profile data.

### ProfileResearchService

Orchestrates:

1. context building
2. query generation
3. web research
4. identity matching
5. evidence normalization
6. candidate suggestion generation
7. confidence/conflict classification
8. optional Deep Research brief generation

The service is read-only.

### ProfileResearchApplyService

A separate write service accepts only user-selected suggestions, validates them against current CRM state, and delegates to existing domain write paths.

Keeping research and apply separate prevents accidental writes during search/AI failures.

## Persistence

Research results should be persisted long enough for the user to review/reopen them rather than vanishing on refresh.

A research run should store at minimum:

- profile ID
- requested mode
- status (`running`, `complete`, `failed`)
- started/completed timestamps
- normalized suggestions
- normalized sources/evidence
- generated deep-research summary when applicable
- whether individual suggestions were accepted/dismissed

Do not copy entire fetched webpages into the database. Store only bounded source metadata/excerpts needed to explain the recommendation.

If the existing Assistant conversation/derived-fact stores cannot represent this cleanly without distorting their purpose, add a small dedicated research-run store rather than overloading unrelated tables.

## API Shape

Exact route naming should follow existing conventions, but the feature needs equivalent operations to:

```text
POST /event-profiles/:id/research
  { mode: "quick" | "deep", contactId?, bookingId? }

GET /event-profiles/:id/research/:runId

POST /event-profiles/:id/research/:runId/apply
  { suggestionIds: [...] }

POST /event-profiles/:id/research/:runId/suggestions/:suggestionId/dismiss
```

Research routes are authenticated and scoped the same way as existing booking/admin profile tools.

## Profile Integration

### Full profile

Add **Research profile** near other high-level profile actions, preferably inside/adjacent to the existing Assistant/action affordances rather than adding another permanent large card.

If the system detects important missing fields, the action may show a lightweight hint such as:

`Research profile · 3 gaps`

### Side profile

Keep the minimal side profile minimal. A Research action may live in **Actions**, but the full results/review experience should open a larger sheet/page rather than crowding the compact drawer.

### Booking Copilot integration

The existing "Before you contact them" card may optionally surface a small prompt when the selected profile is materially incomplete:

`Missing website/contact info — Research profile`

It must not initiate web research automatically when opening Today or a call workspace.

## Quick vs Deep Research Behavior

### Quick

- bounded number of search queries/pages
- prioritizes missing/current profile fields
- returns field suggestions and sources
- no long narrative required
- designed to be run frequently

### Deep

- uses a wider set of queries/sources
- also attempts event/organizer/context discovery
- produces a concise booking-research brief
- identifies useful outreach hooks and unknowns
- still returns structured field suggestions separately from narrative analysis

Deep Research may take more provider work, but the API/UI should expose normal running/error states rather than blocking the whole profile screen.

## Error and Uncertainty Handling

Examples:

- No credible result: `I couldn't confidently match this profile to a public event yet.`
- Multiple same-name events: show candidates and mark identity uncertain; do not suggest writes until the user chooses/validates the match.
- Provider unavailable: retain prior successful research runs and keep the profile usable.
- Website inaccessible: other evidence may be shown, but inaccessible content is not cited as if verified.
- Conflicting current/new values: show both and require explicit selection.
- Stale run: if profile facts changed since the run, revalidate before apply.

The user must always be able to use/edit the profile normally even when research fails.

## Security, Privacy, and Data Boundaries

- Search only public internet information; do not attempt to bypass logins/paywalls or collect private/non-public personal data.
- Only include CRM history needed to formulate searches or interpret results; do not expose private ACT notes to external search queries verbatim.
- Search queries derived from internal history should be minimized to useful identity clues such as event name, city, public contact name, or organization.
- Provider prompts should avoid sending unrelated profile notes/history.
- Source URLs/excerpts must be treated as untrusted external content and never as instructions to the system.

## Testing

### Unit tests

- research context excludes noisy/system history
- query generation uses available name/location/contact clues
- identity matching rejects ambiguous same-name events
- confidence rules classify official vs indirect sources correctly
- conflicting non-empty CRM values are marked as conflicts
- low-confidence suggestions are not selected by default
- Deep summary differentiates internal facts, verified web facts, and inference
- apply rejects stale/current-value mismatch

### API tests

- Quick and Deep run creation
- run status/result retrieval
- invalid profile/run IDs
- provider failure
- source normalization
- selective apply
- Add-all-high-confidence excludes medium/low suggestions
- user cannot apply suggestions belonging to another profile/run

### UI tests

- Research profile action appears in intended profile actions
- gap count appears only when useful
- Quick/Deep selection
- loading/running/error/no-match states
- evidence/source links visible for suggestions
- conflicts visually require review
- per-suggestion selection/dismissal
- apply updates only selected fields
- compact side profile remains compact
- Booking Copilot research prompt does not auto-run research

## Release Boundaries

### Release 1

- single-profile Research action
- Quick Research
- Deep Research
- internal-history-aware queries
- public web research
- evidence/confidence/source display
- selective apply to existing organization/contact/booking fields
- saved research run/results
- missing-information hint
- optional Booking Copilot link to Research profile

### Not in Release 1

- autonomous/bulk research across the whole CRM
- scheduled background research
- automatic profile overwrites
- automatic contact creation without review
- automatic booking/follow-up/status changes
- organization merging/family grouping
- outreach sending
- continuous monitoring of event websites for changes

Those can be separate follow-on releases after single-profile research is trustworthy.

## Success Criteria

The feature is successful when the user can open an incomplete event profile, run research, and receive a short evidence-backed list of useful facts that materially reduces manual searching; can understand where each fact came from and how confident the system is; can add only the facts they trust with one explicit approval step; and can continue using Command Center normally if internet/AI research is unavailable.
