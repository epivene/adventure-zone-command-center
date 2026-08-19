# Staged Booking Assistant Lead Scout Design

## Goal

Turn General Command Center into a practical booking-discovery assistant that can understand requests such as:

> I need to find an event between Montana and Utah in September 2026.

The assistant should first search **existing Command Center records** and present realistic matches. If those are not useful enough, the user can explicitly choose **Find me new leads** to search the public web for events that may be good Adventure Zone prospects.

Web discoveries should appear as **unsaved profile previews** that can be researched, reviewed, dismissed, resumed later, or intentionally converted into real Command Center leads. Nothing discovered on the web becomes CRM data until the user approves it and chooses a first follow-up/action.

The experience must be transparent while research is running, preserve partial results, and allow the user to stop and later continue a search.

## Product principles

1. **CRM first, web second.** Existing relationships are more valuable than random internet discoveries and should always be checked first.
2. **Natural language in, structured criteria out.** The user should not need to fill a filter form for common discovery requests.
3. **Likely recurring is useful, but not confirmed.** Historical timing may surface a strong lead, but it must never be presented as a confirmed current-year date unless supported by current evidence.
4. **No blank researching screen.** Show operational stages, counts, and partial results as work progresses.
5. **Stop means stop.** The user can request cancellation; completed work remains available.
6. **Unsaved prospects are not CRM records.** They persist with the Scout run but do not pollute Profiles/Bookings until approved.
7. **Official evidence first.** Reviews and social evidence can enrich a lead but must not silently override official dates, contacts, or application information.
8. **Adventure Zone fit matters.** A generic event search result is not enough; the Scout should look for realistic opportunities for a family carnival/bounce-house operation.
9. **No silent writes.** Saving a lead always requires explicit approval and a first next action.

## Primary user flow

### 1. Natural-language request

The user asks General Command Center something like:

- `I need to find an event between Montana and Utah in September 2026.`
- `Find me something around eastern Wyoming in June 2027.`
- `What fairs do we already know about in Idaho in August?`
- `I need a family event near Leg 4 between June 10 and June 25.`
- `Find fall events on the route from Montana to Utah.`

The assistant creates a persistent discovery run and parses the request into a bounded structured search intent.

Example:

```ts
export type LeadDiscoveryCriteria = {
  originalQuestion: string;
  dateFrom: string | null;
  dateThrough: string | null;
  month: number | null;
  year: number | null;
  regions: string[];
  cities: string[];
  geoMode: "regions" | "corridor" | "route" | "radius" | "unspecified";
  routeId: string | null;
  legId: string | null;
  eventKeywords: string[];
  fitIntent: "bookable_event" | "vendor_opportunity" | "either";
};
```

The model may help interpret ambiguous wording, but it must return this bounded schema. It cannot generate SQL or arbitrary database filters.

For a phrase such as `between Montana and Utah`, the assistant should preserve that as **corridor intent** rather than pretending it knows an exact driving route. Search may include plausible corridor regions (for example Montana, Idaho, Wyoming, and Utah where geographically relevant), and result cards should explain why a location is considered a corridor match. If an actual Command Center route/trip/leg is selected, real route context should outrank generic corridor inference.

If the date/geography is too ambiguous to search responsibly, the assistant should show its interpretation and ask for a correction before any web search. It must not silently invent a year, route, or exact corridor.

### 2. Search Command Center first

The same persistent run searches existing:

- organizations/profiles,
- bookings/events,
- event families,
- organization locations,
- prior event dates,
- package history,
- follow-up/relationship history where relevant,
- route/leg location context where available.

No public-web provider is called during this CRM-first stage.

Results are ranked as **existing possibilities**, not just text matches.

The response should be grouped into:

#### Confirmed/current-date matches

Profiles with a saved event/booking date that directly satisfies the requested date/location criteria.

#### Likely recurring matches

Profiles with strong historical evidence of occurring in the requested seasonal window but without a confirmed requested-year date.

Example:

> **Likely recurring match** — This event occurred in mid-September in 2024 and 2025, but no September 2026 date is saved yet.

Likely recurring results must never be labeled as confirmed dates.

#### Broader relationship matches

Existing profiles with useful geographic/event-family/history fit but weaker date evidence.

After this stage the run is `crm_ready`. The assistant shows the CRM shortlist and waits. Web research does not begin until the user explicitly chooses **Find me new leads**.

### 3. Existing-match result cards

Each CRM match should explain the fit instead of only saying `Matched on booking`.

Suggested result shape:

```ts
export type AssistantLeadMatch = {
  organizationId: string;
  bookingId: string | null;
  label: string;
  city: string | null;
  region: string | null;
  dateFrom: string | null;
  dateThrough: string | null;
  dateConfidence: "confirmed" | "likely_recurring" | "unknown";
  status: string | null;
  relationshipSummary: string | null;
  reasons: string[];
  fitScore: number;
};
```

Cards may say:

- `Confirmed September date`
- `On requested corridor`
- `Past Adventure Zone customer`
- `Usually occurs in September`
- `Family/fair format fits Adventure Zone`
- `Previously booked Weekend Warriors`

Actions:

- **Open profile**
- **Use as context**

The assistant should show a bounded shortlist first, typically 5–10 strong results, with a way to show more.

### 4. Find me new leads

After CRM results are shown, a prominent **Find me new leads** action appears whether matches were found or not.

Pressing it starts the public-web stages of the **same run**, using the already normalized criteria. The user should not need to repeat `Montana to Utah / September 2026`.

If there are zero CRM matches, the assistant may emphasize this action, but must still wait for the user's click before starting web research.

## Staged Lead Scout

The new Lead Scout is broader than the current source-scoped Scout. It discovers useful sources and event prospects from criteria rather than requiring one starting URL.

It should reuse existing Profile Research / Source Scout normalization, URL safety, CRM matching, and lead-intake logic wherever possible.

### Stages

The persisted discovery run moves through explicit operational stages:

1. **Understanding request**
   - validate/normalize date and geographic criteria,
   - preserve original prompt,
   - display interpreted criteria.

2. **Searching Command Center**
   - collect existing confirmed, recurring, and broader relationship matches,
   - transition to `crm_ready`,
   - pause for the user's decision.

3. **Finding public sources** — only after **Find me new leads**
   - search official event sites,
   - tourism/community calendars,
   - city/county/parks/fair/chamber sources,
   - university/school/community sources where appropriate,
   - vendor/exhibitor directories,
   - credible seasonal event guides.

4. **Discovering candidate events**
   - identify plausible public events inside the requested date/geographic scope,
   - avoid obviously private, tiny, unrelated, or non-bookable listings,
   - create partial candidate records immediately.

5. **Checking event details**
   - official/current dates,
   - duration,
   - venue/location,
   - organizer/contact,
   - event format,
   - recurrence,
   - family/community focus,
   - vendor/exhibitor/sponsorship opportunity,
   - application deadlines,
   - public vendor fees/requirements where available,
   - attendance/crowd information when credibly published,
   - electricity/space/insurance/setup requirements when published,
   - whether another carnival/amusement/inflatables operator appears to be involved.

6. **Checking public history, reviews, and social evidence**
   - local news recaps,
   - tourism/community recaps,
   - publicly indexed social event pages/posts,
   - public videos/photos where useful,
   - public reviews/community discussions.

   This stage is enrichment, not authority. Review/social evidence should help answer questions like `does this appear well attended?`, `is it family oriented?`, `do vendors seem to participate?`, and `what complaints or logistics issues recur?`.

7. **Comparing with Command Center**
   - exact and conservative fuzzy matching against local CRM,
   - classify every candidate as:
     - `already_in_command_center`,
     - `possible_match`,
     - `new_prospect`.

8. **Ranking for Adventure Zone fit**
   - public/family attendance potential,
   - event duration,
   - outdoor/vendor suitability,
   - route/geographic fit,
   - contactability,
   - vendor/entertainment opportunity,
   - evidence strength,
   - timing/application deadline,
   - conflicts such as an existing carnival provider.

The UI should begin showing candidates before every web stage is finished.

## Source and evidence hierarchy

Facts should carry source references and confidence. The Scout should prefer:

1. official event/organizer website,
2. official city/county/fair/tourism/chamber source,
3. official vendor/exhibitor/application material or PDF,
4. venue/partner/sponsor source,
5. reputable local news or public recap,
6. public social/event pages,
7. public reviews/forums/community discussion.

Hard facts such as event date, organizer email, application deadline, vendor fee, or insurance requirement should use the strongest available source.

Reviews/social posts may support qualitative observations such as turnout, family appeal, parking issues, recurring complaints, or visible vendor activity. They should not silently become authoritative hard facts.

If only weak evidence exists, say so.

Examples:

- `Attendance: about 8,000 — local-news estimate, medium confidence.`
- `Family appeal: strong — official children's schedule + public event photos.`
- `Vendor applications: no current 2026 application found.`
- `Facebook event found, but details could not be verified without login.`

### Social-media coverage boundary

Lead Scout should search publicly accessible/indexed social evidence when the search provider can retrieve it, including public event pages/posts and public video/social results.

It must **not** claim exhaustive social-media coverage. Private groups, login-only pages, blocked pages, non-indexed posts, or content unavailable to the web-search provider may be inaccessible.

The UI should explicitly surface coverage gaps rather than imply `all social media was checked`.

## Adventure Zone fit model

The Scout is not looking for arbitrary public events. It should evaluate whether Adventure Zone could realistically:

- be booked as entertainment,
- become a vendor/exhibitor,
- provide a bounce/carnival package,
- participate in a public family area,
- fit into the event's scale and logistics.

Useful positive signals include:

- public fair/festival/community celebration,
- family/children programming,
- multiple-day format,
- outdoor grounds or flexible event space,
- vendor/exhibitor program,
- entertainment applications,
- substantial attendance,
- city/tourism/chamber involvement,
- recurring annual event,
- sponsor/vendor contact paths.

Potential caution signals include:

- explicitly exclusive amusement/carnival contract,
- event too small/private,
- no vendor/entertainment path,
- venue appears physically unsuitable,
- dates conflict with known Adventure Zone route commitments,
- application deadline already passed,
- weak/unverified event existence.

The fit score is a ranking aid, not an automatic booking decision.

## Persistent Scout runs

A Lead Scout run begins with the original General Command Center request, survives drawer closure/navigation, and preserves CRM matches plus any partial web results.

Suggested tables:

```text
lead_scout_runs
lead_scout_sources
lead_scout_candidates
lead_scout_candidate_facts
```

### lead_scout_runs

Fields should include:

- id,
- actor/user id,
- original question,
- normalized criteria JSON,
- CRM-match summary/result JSON or normalized linked result records,
- status: `interpreting | crm_search | crm_ready | running | stopping | stopped | complete | failed`,
- current stage,
- progress JSON/counts,
- cancel requested at,
- started/completed timestamps,
- failure summary.

### lead_scout_sources

Store only bounded source metadata/provenance:

- run id,
- URL,
- title,
- publisher/hostname,
- source category,
- retrieved/observed time,
- bounded evidence excerpt/marker where needed.

Do not persist complete scraped pages.

### lead_scout_candidates

These are the **unsaved profile previews**.

Suggested fields:

- run id,
- stable candidate id,
- name,
- city/region,
- venue,
- starts/ends,
- organizer/contact fields,
- website/source URL,
- event type,
- recurrence summary,
- attendance summary,
- vendor/application summary,
- deadline,
- fit score,
- fit rationale,
- CRM match status,
- matched organization/booking ids when applicable,
- review status: `unreviewed | shortlisted | dismissed | saved`,
- saved organization/booking ids after intake,
- timestamps.

### candidate facts

Structured evidence-backed facts can include:

- field/key,
- value,
- confidence,
- source ids,
- fact category,
- rationale.

This allows a candidate preview to explain where information came from without dumping raw web content into CRM notes.

## Unsaved prospect profile previews

A `new_prospect` should look and behave like a recognizable profile card while remaining clearly separate from real CRM data.

Example:

> **Silver Valley Days**
> 
> Kellogg, ID · Sep 11–13, 2026
> 
> **Unsaved prospect**
> 
> Three-day family community festival with outdoor vendors. Vendor application is published. Local recap estimates several thousand attendees. Strong Adventure Zone fit; power/space requirements still need confirmation.

Candidate preview sections may include:

- identity/location/date,
- organizer/contact,
- official website,
- vendor/application details,
- audience/attendance evidence,
- family/activity fit,
- route fit,
- public review/social observations,
- uncertainties/gaps,
- evidence sources.

Actions:

- **Open sources**
- **Research deeper**
- **Save as lead**
- **Not a fit**

`Research deeper` enriches that candidate only rather than restarting the whole broad search.

`Not a fit` dismisses it within the Scout run; it does not write a CRM status.

Unsaved candidate previews remain available if the drawer closes or the search is stopped.

## Progress UI

The Scout must show operational progress without exposing hidden model reasoning.

Example:

```text
Understanding your request                         Done
Searching Command Center                           7 matches
Waiting for web-search approval                    Ready
Finding public event sources                       18 sources checked
Checking candidate events                          9 of 16
Reviewing vendor/review/social evidence            5 of 9
Comparing with Command Center                      6 checked
```

Before **Find me new leads** is pressed, only the first two stages are complete and the run remains `crm_ready`.

Below the progress area, completed candidate cards appear immediately after web research begins.

The UI may show safe activity labels such as:

- `Checking Visit Idaho event listings`
- `Reviewing an official vendor application`
- `Comparing Silver Valley Days with Command Center`

It should not display private chain-of-thought or invented internal reasoning.

## Stop and continue

While a web run is active, show **Stop search**.

Stopping should:

1. set `cancelRequestedAt`,
2. prevent new work units from starting,
3. abort an in-flight provider request where the worker can safely do so,
4. preserve all completed sources/candidates/facts,
5. mark the run `stopped` when active work has unwound,
6. show `Search stopped — partial results`.

The worker should check cancellation before each provider call and periodically while a long fetch is active. A stop request may take a short moment if a remote request is already unwinding, but the UI should immediately switch to `Stopping…`.

A stopped run offers **Continue search**. Continuing resumes the remaining stage/work items using the same criteria and already collected evidence rather than deleting and recreating the run.

Closing the assistant drawer should **not** implicitly delete or cancel a run. When reopened, General Command Center should be able to restore the latest relevant Scout run and its CRM/partial/completed candidate results.

## Job execution architecture

Use a persistent DB-backed run/job model rather than keeping the whole search in one browser request.

Recommended flow:

```text
POST /assistant/lead-scout/runs
  body: { question }
  -> create run, normalize criteria, search CRM, return crm_ready run + matches

POST /assistant/lead-scout/runs/:id/start
  -> explicit Find me new leads; begin web stages

GET /assistant/lead-scout/runs/:id
  -> criteria, CRM matches, status, progress, candidates, sources

POST /assistant/lead-scout/runs/:id/stop
  -> request cancellation

POST /assistant/lead-scout/runs/:id/continue
  -> resume remaining web work

POST /assistant/lead-scout/runs/:id/candidates/:candidateId/deepen
  -> candidate-specific enrichment

POST /assistant/lead-scout/runs/:id/candidates/:candidateId/dismiss
  -> review-only state change

POST /assistant/lead-scout/runs/:id/candidates/:candidateId/save
  -> explicit CRM intake after final next-action confirmation
```

The initial POST may complete deterministic criteria parsing/CRM matching synchronously when fast, but the run is persisted before those results are returned. If interpretation/search becomes slow, the same status model supports polling without changing the product contract.

The frontend may poll the run endpoint on a short interval for durable progress. Streaming can be added where useful, but correctness must not depend on one long-lived browser connection.

The worker should use the existing app/database and existing worker conventions. Do not create a separate application/database solely for Lead Scout.

## Search provider architecture

The existing `OpenAiSourceScoutProvider` is source-scoped. Keep it for `Scout this source`.

Add a criteria-driven provider/orchestrator for broad discovery, for example:

```ts
interface LeadScoutProvider {
  discoverSources(criteria: LeadDiscoveryCriteria): Promise<LeadScoutSource[]>;
  discoverCandidates(criteria: LeadDiscoveryCriteria, sources: LeadScoutSource[]): Promise<LeadScoutCandidateInput[]>;
  enrichCandidate(candidate: LeadScoutCandidateInput, criteria: LeadDiscoveryCriteria): Promise<LeadScoutCandidateEvidence>;
}
```

Do not place the entire run into one enormous prompt. Smaller explicit stages improve:

- progress reporting,
- cancellation,
- partial-result persistence,
- source quality,
- retry behavior,
- cost control.

Each provider response must use cited public URLs and bounded structured JSON.

## CRM comparison

CRM matching stays local. Do not send the entire CRM to the web provider.

Reuse/extend the existing related-event matcher rules:

- exact same event/location/date identity -> existing,
- strong but uncertain same-location/name -> possible match,
- otherwise -> new prospect.

Before a candidate is saved as a lead, perform the duplicate comparison **again** server-side. This protects against records created/imported after the Scout result was generated.

If the duplicate recheck changes the classification, do not create another profile; return the existing/possible match for review.

## Saving an unsaved prospect

**Save as lead is never one-click silent creation.**

It opens a compact final confirmation with prefilled researched fields and requires:

- first action: `Call | Email | Prepare quote`,
- first follow-up date.

The user can review/edit core fields such as:

- event/profile name,
- city/state,
- current event dates,
- website/source,
- contact when available.

Saving must reuse the existing Add Event / Lead / Source Scout intake rules so the result is a normal Command Center record:

- canonical profile/organization,
- New Lead booking,
- appropriate initial probability/status,
- required open follow-up,
- researched website/date/contact fields only where accepted,
- candidate linked to the created CRM ids.

Do not dump the full web-research narrative into Notes.

Keep provenance as structured research metadata/source references where the existing research model supports it.

After save, the candidate card changes from **Unsaved prospect** to **In Command Center** and links to the created profile.

Bulk save may be supported after individual flow is proven, using the existing bulk Source Scout intake safety rules and a shared first action/date.

## Assistant drawer behavior

### CRM-first response

After a qualifying discovery request, General Command Center should render:

1. interpreted criteria,
2. existing confirmed matches,
3. likely recurring matches,
4. broader useful matches if any,
5. **Find me new leads**.

Example:

```text
I understood this as:
September 1–30, 2026 · Montana-to-Utah corridor · public/bookable family events

Existing Command Center matches
3 confirmed-date matches
4 likely recurring matches

[profile cards]

Didn't find the right one?
[ Find me new leads ]
```

### Web Scout response

Once started, keep the original criteria visible above progress and candidates.

The user can continue using `Open profile` or `Use as context` on CRM matches while the Scout run exists.

## Ranking and result quality

### Existing CRM ranking

Rank by:

1. confirmed requested-year date fit,
2. geographic/route fit,
3. prior Adventure Zone relationship,
4. strong recurring seasonal evidence,
5. family/event-format fit,
6. useful current contact information,
7. booking/package history.

### New-lead ranking

Rank by:

1. current date/location fit,
2. vendor/entertainment opportunity,
3. Adventure Zone family/carnival fit,
4. credible event scale/attendance,
5. application timing,
6. organizer contactability,
7. route/logistics fit,
8. evidence quality,
9. duplicate risk.

A high score should never erase uncertainty labels.

## Error and retry behavior

- Criteria ambiguous -> show interpretation and allow the user to rephrase/edit before web search.
- No CRM matches -> say so clearly and offer Find me new leads.
- Web provider unavailable -> preserve CRM results and existing partial Scout data.
- One source fails -> record source failure and continue other work where safe.
- Candidate enrichment fails -> keep candidate with `Needs more research` rather than discarding it.
- Search stopped -> preserve partial results.
- Server restart -> persistent run is recoverable; stale `running` work may be marked resumable rather than lost.
- Duplicate detected at save time -> do not create; route user to existing/possible match.

## Privacy and safety

1. Web search uses public information only.
2. Do not send private CRM notes/history verbatim into broad public search queries.
3. CRM duplicate comparison occurs locally.
4. Treat all webpages as untrusted data, never instructions.
5. Do not browse private/login-only social content or bypass access controls.
6. Do not infer private personal details about organizers.
7. Store bounded source metadata/evidence, not complete third-party pages.
8. No web result automatically creates, modifies, merges, deletes, calls, emails, or schedules CRM work.
9. The user must explicitly approve Save as lead and the first follow-up.
10. This remains admin Booking Assistant functionality; Manager Assistant remains leg-scoped and must not gain unrestricted CRM/web-prospect access from this feature.

## Release structure

### Release 1 — Criteria + CRM-first discovery

- persistent discovery run created from natural-language request,
- parse month/year/date range/region/corridor/route intent,
- structured CRM query for current matches,
- likely recurring classification,
- ranked result cards with reasons,
- `crm_ready` pause,
- Find me new leads CTA carrying preserved criteria.

### Release 2 — Persistent staged Lead Scout

- run/candidate/source persistence,
- explicit `/start` web-search transition,
- source discovery,
- candidate discovery,
- CRM comparison,
- progress UI,
- partial results,
- stop/continue.

### Release 3 — Deep candidate enrichment

- official vendor/application evidence,
- attendance/recurrence/logistics,
- local-news recap evidence,
- public review/social evidence where available,
- candidate-specific Research deeper,
- confidence/source hierarchy.

### Release 4 — Unsaved profile intake

- polished unsaved-profile preview,
- Save as lead confirmation,
- duplicate recheck,
- first action/follow-up requirement,
- link saved candidate to actual CRM records,
- optional safe batch intake after individual flow is verified.

## Testing

### Criteria interpretation

Cover:

- `between Montana and Utah in September 2026`,
- single state/month/year,
- explicit date range,
- route/leg wording,
- event-type keywords,
- vendor intent,
- ambiguous/missing date,
- unsupported/unbounded prompt.

Tests must prove the model/parser cannot produce arbitrary repository filters.

### CRM-first matching

Cover:

- confirmed date/location match,
- historical same-month recurring match with no current-year date,
- recurring result clearly marked unconfirmed,
- route/corridor fit,
- canonical duplicate handling,
- bounded ranking,
- zero results,
- no web provider call before explicit `/start`.

### Lead Scout jobs

Cover:

- persistent run created before CRM response,
- `crm_ready` pause,
- explicit start required for web search,
- stage transitions,
- partial candidate persistence,
- polling response,
- stop requested while idle,
- stop during provider work,
- continue from stopped run,
- provider/source failure without losing prior candidates,
- restart/recovery behavior,
- user/run ownership.

### Evidence

Cover:

- official evidence outranks review/social evidence,
- uncited candidates/facts rejected,
- inaccessible/social-only facts clearly lower-confidence,
- no private/login bypass,
- bounded stored excerpts.

### CRM matching and intake

Cover:

- existing/possible/new classifications,
- duplicate recheck immediately before save,
- unsaved candidate creates no organization/booking/follow-up rows,
- dismiss creates no CRM mutation,
- Save as lead requires action + date,
- saved candidate creates normal CRM shape through existing intake rules,
- existing manual values are not overwritten by stale research.

### UI

Cover:

- CRM matches appear before web search,
- likely recurring is visually distinct,
- Find me new leads preserves criteria,
- progress stages/counters render,
- partial candidate cards render while running,
- Stop -> Stopping -> Stopped,
- Continue resumes,
- unsaved candidate badge,
- sources/research deeper/save/not-fit actions,
- Save as lead final confirmation,
- saved candidate becomes In Command Center.

## Success criteria

A request like:

> I need to find an event between Montana and Utah in September 2026.

should result in this experience:

1. the assistant creates a persistent discovery run and understands the date/geographic intent,
2. it searches Command Center first without invoking public web research,
3. it returns existing confirmed matches and clearly labeled likely recurring matches,
4. it pauses at `crm_ready`,
5. the user can choose **Find me new leads** without retyping the request,
6. the Scout visibly shows what stage it is performing,
7. partial web discoveries appear as persistent **Unsaved prospect** profile previews,
8. candidates contain useful official/vendor/contact/fit evidence plus public review/social context when available,
9. the user can stop and later continue the search without losing completed work,
10. every candidate is compared against Command Center,
11. nothing becomes a real lead until the user chooses **Save as lead**, reviews it, and sets the first action/follow-up.

## Non-goals

This design does not add:

- automatic lead creation,
- automatic calling/emailing,
- autonomous recurring web crawling,
- guaranteed access to every social-media post/review,
- private/login-bypassing scraping,
- unrestricted SQL/model access to the CRM,
- automatic booking decisions,
- route changes without approval,
- a second app or database.
