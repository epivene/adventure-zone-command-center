# Scout Route Radius Search Design

## Summary

Add a visible, explicit Scout workflow to the Adventure Zone Booking Assistant and extend Lead Scout with geographic radius searching around an existing event, booking, or manually entered location. The goal is to make event scouting discoverable, predictable, and geographically complete enough that worthwhile opportunities are less likely to be missed simply because a town was not named in advance.

This design combines two related fixes:

1. Make Scout a first-class assistant mode instead of a hidden natural-language trigger.
2. Add Radius Scout so staff can search around a known event/location in the same way a marketplace app searches around a selected location.

Route-corridor scouting between two anchors remains a follow-on stage, but this design keeps the data model and UI extensible for it.

## Problem

Lead Scout already exists in the codebase, but it is hard to discover and easy to bypass accidentally:

- General Assistant only enters lead discovery when `isLeadDiscoveryQuestion()` recognizes a narrow wording pattern.
- The Assistant Drawer does not expose a visible Scout mode/button before a scout run exists.
- Lead Scout currently appears only in general mode, so opening the assistant from a booking or event does not offer an obvious "Scout around this event" action.
- Users can reasonably ask for nearby events and receive ordinary CRM/profile search behavior instead of Scout behavior.
- Current discovery is phrase-driven rather than explicitly geographic, which makes coverage dependent on which cities or route names are mentioned.

## Goals

- Make Scout visible without requiring special wording.
- Let a user start scouting from an existing booking/event or a manually entered place.
- Let the user choose a radius of 25, 50, 100, 150, 200, or 300 miles.
- Let the user choose an explicit date window.
- Let the user filter event categories.
- Search the geographic area broadly enough that discovery is not limited to towns the user already knows to name.
- Reuse existing Lead Scout candidate review, deeper research, not-a-fit, and save-to-CRM behavior.
- Preserve natural-language Scout activation for users who prefer typing.
- Keep saved prospects in the existing CRM/lead workflow rather than creating a separate scouting database.

## Non-Goals

- Full turn-by-turn route optimization.
- Automatic booking or outreach.
- A fake percentage-based "coverage score" that cannot be objectively calculated.
- Replacing the existing Lead Scout candidate/save workflow.
- Building a new standalone application outside Adventure Zone Command Center.

## User Experience

### 1. General Assistant entry point

When the Booking Assistant opens with no selected context, the top of General Command Terminal exposes two explicit modes:

- **Ask Assistant**
- **Scout Events**

`Ask Assistant` preserves current profile/event-family/general search behavior.

`Scout Events` opens the Scout form directly. No natural-language trigger is required.

### 2. Contextual entry point

When the assistant opens from an event or booking with usable location data, show a prominent action:

**Scout Around This Event**

Selecting it switches the drawer into Scout Events mode and pre-fills the anchor from the current record.

If the contextual record has no usable location, keep the action available but open the Scout form with the anchor field empty and a short explanation that a location is required.

### 3. Scout form

The initial Radius Scout form contains:

- **Anchor**
  - Existing booking/event selected from current context, or
  - Search/select an existing CRM event, or
  - Manually enter city/state or address.
- **Radius**
  - 25, 50, 100, 150, 200, or 300 miles.
  - Default: 100 miles unless launched from a contextual event with a remembered prior choice in the current drawer session.
- **Dates**
  - Explicit start and end date.
  - When launched from an existing event, default to seven days before through seven days after that event's date range.
- **Event categories**
  - Fair
  - Festival
  - Rodeo
  - Powwow
  - Community celebration
  - Car show
  - Expo/show
  - Parade
  - Other family/community event
- **History filter**
  - Show all
  - Hide already booked
  - Hide booked and previously dismissed

Primary action: **Scout Area**.

### 4. Results

Reuse the current Lead Scout result/candidate system and add geographic context to each candidate:

- Candidate/event name
- City/state
- Event dates
- Straight-line distance from the selected anchor
- Existing CRM relationship/status when known
- Existing Lead Scout fit/research indicators

Actions continue to include:

- Research deeper
- Save as lead
- Mark not a fit
- Use/open existing CRM match

Add:

- **Scout Around This Event** on a candidate with usable location. This replaces the current anchor with that candidate and opens a new radius search without losing the ability to return to the prior run.

### 5. Search summary

Do not display an invented percentage such as "84% coverage".

Instead show concrete search accounting when available, for example:

- 38 cities/counties considered
- 63 event candidates reviewed
- 11 results surfaced
- 4 source/area checks incomplete

If the system cannot know one of these numbers reliably, omit that number rather than estimate it.

## Natural-Language Behavior

Natural-language Scout activation remains supported, but it becomes more forgiving.

Examples that should route to Scout:

- "Find events around Miles City"
- "Find fairs within 200 miles of Miles City around Labor Day"
- "Scout around the Miles City event"
- "Look for festivals near this booking"
- "Find events between Miles City and Twin Falls" (future route mode, or an explicit message that route mode is not yet available)

A geographic event-discovery request should prefer Scout over ordinary profile search when the user is asking for new event opportunities rather than an existing CRM record.

The Scout UI remains the source of truth for missing parameters: if radius or dates are absent, open Scout with reasonable defaults and let the user edit them rather than rejecting the request.

## Geographic Search Model

### Anchor normalization

Normalize the anchor into:

```ts
interface ScoutAnchor {
  kind: "booking" | "event_family" | "manual" | "candidate";
  recordId?: string;
  label: string;
  city?: string;
  region?: string;
  address?: string;
  latitude: number;
  longitude: number;
}
```

An anchor is valid only after latitude and longitude are resolved.

### Radius request

```ts
interface RadiusScoutRequest {
  anchor: ScoutAnchor;
  radiusMiles: 25 | 50 | 100 | 150 | 200 | 300;
  dateStart: string;
  dateEnd: string;
  categories: ScoutEventCategory[];
  historyFilter: "all" | "hide_booked" | "hide_booked_and_dismissed";
}
```

### Search strategy

Use a hybrid search strategy rather than a single free-text web query:

1. Resolve the geographic anchor.
2. Build a set of municipalities/counties intersecting the radius.
3. Search configured event sources using the requested date/category filters and geographic subdivisions.
4. Normalize discovered event candidates.
5. Compute candidate distance from anchor.
6. Drop candidates outside the selected radius.
7. Match normalized candidates against existing CRM/event-family history.
8. Rank and surface candidates through the existing Lead Scout run model.

The backend should keep source adapters separate from CRM matching and geographic filtering so future sources can be added without rewriting the Scout UI.

## Architecture

### Frontend

Keep the existing Assistant Drawer as the entry surface but split its general-mode content into explicit assistant/scout modes instead of relying on whether a `leadScoutRun` happens to exist.

Expected responsibilities:

- `assistant-drawer.tsx`
  - Mode switching
  - Contextual "Scout Around This Event" entry
  - Passing prefilled Scout anchor
- New `scout-launch-form.tsx`
  - Radius/date/category/history fields
  - Anchor selection/manual entry
  - Validation
- Existing Lead Scout components
  - Candidate rendering and existing save/research/dismiss actions
- `lead-scout-api.ts`
  - New radius-scout request endpoint/client method

Do not overload `assistant-drawer.tsx` with geographic form logic; keep the form self-contained.

### Backend

Keep current Lead Scout orchestration but add a geographic discovery entry path.

Expected responsibilities:

- Assistant route
  - Continue natural-language routing into Scout.
- Lead Scout route/service
  - Accept `RadiusScoutRequest`.
  - Create/start a Lead Scout run using an explicit geographic scope.
- New geographic service
  - Resolve anchor coordinates.
  - Enumerate geographic subdivisions inside/intersecting radius.
  - Compute candidate distance/filtering.
- Source adapters
  - Search event sources by subdivision/date/category.
- Existing CRM search/repository
  - Reuse for duplicate/history matching and save behavior.

## Data Persistence

Radius parameters should be stored with the Lead Scout run so a run is reproducible and understandable later.

Persist at least:

- anchor label and coordinates
- anchor record reference when applicable
- radius miles
- date range
- categories
- history filter
- search accounting metadata that is objectively known

Do not create a separate persistent "Scout Route" entity in this stage.

## Error Handling

- Invalid/unresolvable anchor: keep the form open and show "Choose a valid event or location."
- Missing date range: prevent submission and identify the date fields.
- No events found: return a completed Scout run with zero candidates and a useful summary, not an API error.
- Partial source failure: keep successful results, mark the run/search accounting as incomplete, and state which checks could not complete.
- Complete backend failure: preserve the entered form values and surface the current Lead Scout error UI.
- Contextual event lacks location: open Scout form with dates prefilled when possible, but require a location before searching.

## Security and Permissions

Use the same authenticated assistant/Lead Scout access rules already used by the current assistant endpoints. Saving a candidate must continue through the existing Lead Scout save path so current CRM authorization and duplicate handling are preserved.

Do not expose third-party API credentials to the browser.

## Testing

### Frontend

Cover:

- Scout Events mode is visible in General Command Terminal.
- Ask Assistant behavior still works.
- Contextual event/booking shows Scout Around This Event.
- Contextual launch pre-fills anchor and date window.
- Manual anchor/radius/date/category form validation.
- Radius search creates a Lead Scout run and renders existing candidate UI.
- Candidate "Scout Around This Event" starts a new search with the candidate as anchor.
- Natural-language Scout responses still switch to Scout results.

### Backend

Cover:

- Geographic discovery intent recognizes simple wording such as "Find events around Miles City."
- Radius request schema accepts only supported radii and valid date ranges.
- Anchor resolution success/failure.
- Distance filtering excludes candidates outside the selected radius.
- CRM history matching remains intact.
- Partial source failure preserves successful candidates and marks the run incomplete.
- Zero candidates is a successful completed run.

### Regression

Run existing Assistant, Lead Scout, profile-search, and Booking Assistant tests to ensure the explicit Scout mode does not break current assistant behavior.

## Rollout Order

1. Add explicit Scout mode and contextual Scout entry point using the existing Lead Scout behavior.
2. Add Radius Scout request/data model and geographic filtering.
3. Add hybrid geographic source expansion and concrete search accounting.
4. Add candidate "Scout Around This Event" chaining.
5. Follow-on design: Route Scout corridor between two anchors.

## Success Criteria

The feature is successful when:

- A user can open the assistant and clearly see how to start Scout without knowing a trigger phrase.
- A user on an existing booking/event can start scouting around it in one action.
- A user can search a 200-mile radius around an anchor with a date window and event-type filters.
- Results are geographically filtered and CRM-matched before being presented.
- Existing candidate save/research/dismiss behavior continues to work.
- Simple natural-language requests such as "Find events around Miles City" enter Scout instead of falling into ordinary profile search.
- The UI never presents an unsupported/fabricated completeness percentage.
