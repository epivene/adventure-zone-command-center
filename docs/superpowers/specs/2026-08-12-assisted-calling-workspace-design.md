# Assisted Calling Workspace Design

**Date:** 2026-08-12  
**Status:** Design approved; pending written-spec review

## Summary

Adventure Zone Command Center will gain a Five9-style assisted calling workflow without depending on Five9 or a cloud phone provider. The first version uses the user's normal phone service through Windows Phone Link for calls, and an external direct-to-voicemail service for individually recorded voicemail. The CRM remains responsible for prioritizing work, presenting contact context and a flexible script, finding incoming callers, recording outcomes, and scheduling follow-ups.

The experience must use plain labels such as **Call**, **Call office**, and **Leave voicemail**. Vendor names are configuration details and must not appear in the daily workflow.

## Goals

- Turn the existing Today page into the primary outbound call queue.
- Keep the selected caller, useful context, script, notes, outcome, and next action visible beside the queue on desktop.
- Provide the same call action from contact and event profiles.
- Support multiple labeled numbers per contact, including mobile, office, alternate, unknown, and extensions.
- Find incoming callers by exact number and make likely profiles quick to select using area code and existing CRM context.
- Let the user find a caller by name, organization, event, email, location, route leg, status, or note text.
- Create a new caller quickly without creating obvious duplicates.
- Save call history and follow-ups consistently from desktop and mobile.
- Preserve unfinished call notes if the page closes or reloads.
- Keep the telephony boundary replaceable so a future business-phone provider can add automatic screen-pop and transcription.

## Non-goals for the first version

- Call recording, transcription, or AI summaries.
- Automatic access to Phone Link call events or audio.
- Automatic incoming caller screen-pop.
- Bulk or prerecorded voicemail campaigns.
- Automatic phone-type or carrier lookup.
- Automatic confirmation that a call or voicemail was delivered.
- Selecting a permanent Adventure Zone phone provider.

## Existing foundation

The current repository already contains the main building blocks:

- `TodayPage` loads prioritized follow-ups and displays `NextCallCard`.
- `CallWorkspace` records notes, disposition, next action, timing, and recent history.
- Call completion is idempotent through a request key and is backed by the existing call service and call session/activity persistence.
- `QuickAddCaller` supports exact phone matching, multiple exact matches, and fast contact creation.
- North American phone normalization already produces canonical E.164 values for exact matching.
- Contact search already covers name, organization, email, phone, city, region, and postal code.

The implementation should extend these units and their API-server equivalents rather than create a second calling subsystem.

## User experience

### Desktop Today layout

On large screens, the call portion of Today uses a two-column workspace:

- The left column is the prioritized call/follow-up queue.
- The right column is the selected contact's call workspace.
- Other Today sections remain below the calling workspace.

Selecting a queue item loads the workspace without leaving Today. The right panel shows:

1. Contact name, organization or event, and selected phone number.
2. Actions: **Call**, **Call office**, or **Leave voicemail**, depending on the number type.
3. A compact context row containing booking status, route leg, and last-contacted date.
4. A flexible script selected from the call context.
5. Call notes.
6. Outcome buttons and next-follow-up controls.
7. Recent history, initially collapsed when vertical space is limited.

The existing standalone Call Workspace remains available as a full-page fallback and for direct links. It reuses the same workspace component and behavior.

### Mobile layout

On narrow screens, the queue appears first and the selected workspace opens below it or as a full-height panel. Controls must remain comfortably tappable. The mobile flow includes a **Log call** action for calls answered away from the computer. Mobile logging supports contact lookup, typed or dictated notes through the device keyboard, outcome selection, and follow-up creation. It does not attempt to capture cellular-call audio.

### Contact and event profiles

Contact and event profiles expose the same call actions and open the shared workspace with the relevant IDs. Behavior and saved results must be identical whether a call begins from Today or a profile.

## Outgoing call flow

1. The user selects a queue item or opens a contact/event profile.
2. The workspace loads the linked organization, contact, booking, follow-up, phone numbers, context row, history, and appropriate script.
3. The user selects a phone number when more than one is available.
4. **Call** uses a `tel:` link so Windows can route the number to its configured handler. If no handler opens, the UI provides **Copy number** and keeps the workspace usable.
5. **Call office** exposes the extension beside the number and offers separate copy controls. Automatic extension entry is not assumed because behavior differs across operating systems and phone menus.
6. **Leave voicemail** copies the selected mobile number and opens the configured external voicemail launcher when available. The application does not name the vendor in the daily interface and does not automatically mark the voicemail as delivered.
7. The user records notes, chooses an outcome, and sets a next action when appropriate.
8. A successful save records the call activity/session, completes the originating follow-up when present, creates the next follow-up when requested, and clears the local draft.

The application must not claim that Phone Link is connected or ready because the browser cannot reliably inspect its state.

## Incoming caller flow

### Exact matches

The user enters or pastes the number displayed by Phone Link into **Find caller**.

- One exact normalized match opens that profile immediately.
- Multiple exact matches show selectable cards for every matching contact and their organizations.
- No exact match immediately shows **Possible callers** and retains a visible **Create contact** action.

### Possible callers before typing a name

For an unknown incoming number, the system may use the area code as a weak hint. It shows a short, deterministic list of possible profiles using:

- Same area code.
- Presence in today's queue.
- Recent contact activity.
- Matching route leg or stored event location when other known context supports it.
- Organizations that contain another number with the same area code.

Each card shows the person's name, organization/event, city and state, booking status, route leg, last-contacted date, and a short explanation such as **Same area code · due today**. Area code alone never opens or merges a profile automatically.

### Live narrowing

As the caller states identifying details, the user can type any fragment into the same finder. Search covers:

- Person name.
- Organization or event name.
- Full or partial phone number.
- Email address.
- City, state, ZIP code, or county when stored.
- Route leg.
- Booking/contact status.
- Note text for queries of at least three characters.

Results show the reason for the match. Exact phone and email matches rank above exact names, organizations, and locations. Note matches rank below structured fields and include only a short relevant snippet. Passive area-code suggestions must not search or expose note text.

### Quick create and duplicate prevention

If the caller is new, the quick-create form pre-fills the incoming number. Before creation, the API checks normalized phone, normalized email, similar name plus organization, and similar name plus location. Exact conflicts block creation and require the user to open a match. Likely non-exact duplicates show choices to open the existing profile or explicitly continue creating a new contact. Possible matches are never merged automatically from this workflow.

## Flexible scripts

The first version provides built-in scripts for:

- First outreach.
- Follow-up.
- Contract/proposal follow-up.
- Incoming inquiry.

The script is selected from the originating follow-up and booking state, with a simple selector available when the automatic choice is wrong. Scripts include prompts rather than rigid paragraphs: event date, event location, expected attendance, package interest, decision-maker, concerns, and next step. Script administration is not part of the first version.

## Phone-number model

The current single `contacts.phone` field is not enough for office, mobile, alternate, and extension handling. Add a contact phone-number entity with:

- Stable ID and contact ID.
- Display/raw number.
- Normalized E.164 number when normalization succeeds.
- Type: `mobile`, `office`, `alternate`, or `unknown`.
- Optional extension.
- Primary flag.
- Optional label for unusual cases.
- Source/provenance sufficient to preserve imported ACT values.
- Number-level do-not-call timestamp and optional reason.
- Created and updated timestamps.

Migration backfills every existing `contacts.phone` value as the primary `unknown` number. During a compatibility period, the selected primary number is mirrored into the legacy `contacts.phone` and `contacts.normalizedPhone` columns so existing views and ACT import behavior continue to work. Reads prefer the phone-number entity and fall back to the legacy columns until all consumers migrate.

Only mobile and unknown numbers display **Leave voicemail**. Office numbers display **Call office** and extension controls. Unknown numbers may display both **Call** and **Leave voicemail** with a short warning that direct voicemail may not work.

## Call persistence

Extend the existing call completion contract/session rather than introduce a parallel history table. Persist:

- Direction: incoming or outgoing.
- Method: standard call, office call, individual voicemail, or mobile log.
- Selected phone-number ID when available.
- Immutable phone-number and extension snapshot for historical accuracy.
- Script kind.
- Existing note, timestamps, disposition, linked entities, and next follow-up.

Add or map the user-facing outcomes:

- Spoke with contact.
- Left voicemail.
- No answer.
- Call back later/follow-up needed.
- Wrong number.
- Do not call.
- Existing business outcomes such as interested, proposal sent, booked, declined, and Last Resort.

Choosing **Do not call** requires confirmation and suppresses future call/voicemail actions for that phone number. Last Resort remains a separate organization-level business decision.

## Caller suggestion service

Create a bounded caller-suggestion query in the API server. It returns a small list with match reasons rather than exposing arbitrary database search behavior. Ranking must be deterministic and tested. Suggested priority is:

1. Exact normalized phone.
2. Exact normalized email.
3. Exact or strong name/organization match from typed input.
4. Today's queue membership.
5. Recent activity.
6. Stored location/route context.
7. Area-code-only similarity.
8. Note-text similarity.

An exact normalized phone match is the only condition that may automatically open a single profile. Every weaker result requires a user click.

## Draft recovery and error handling

- Save unsent notes, selected outcome, next action, script selection, and selected phone locally under a context-specific key.
- Restore the draft after reload and identify when it was saved.
- Clear it only after the server confirms call completion or the user explicitly discards it.
- Expire abandoned drafts after seven days.
- Do not store recordings, transcripts, or unnecessary contact data in the draft.
- If call context fails to load, preserve the queue and show a retry action.
- If a `tel:` handler does not open, keep **Copy number** available.
- If the external voicemail service does not open or complete, do not record **Left voicemail** automatically.
- If saving fails, retain the draft and allow an idempotent retry with the same request key.
- Invalid and duplicate phone data must show actionable corrections without discarding notes.

## Compliance boundary

The first version supports individually initiated, personally recorded voicemail only. It does not expose bulk campaigns or prerecorded-message uploads. Do-not-call requests must be immediately recordable and must suppress future call and voicemail actions for the affected number. Any future bulk or prerecorded feature requires a separate reviewed design covering consent evidence, suppression lists, hours, identity/callback disclosures, opt-out handling, audit records, and applicable federal and state requirements.

## Testing

### Unit tests

- Phone normalization, extensions, phone type behavior, and primary-number compatibility.
- Caller suggestion ranking and stable tie-breaking.
- Area-code suggestions never becoming automatic matches.
- Search match reasons and note-search minimum length.
- Script selection.
- Draft serialization, expiry, restore, and clear-on-success.
- Disposition mapping, including wrong number and do-not-call behavior.

### API/service tests

- Exact one, exact many, possible, and no-match caller results.
- Multi-field search and bounded result count.
- Duplicate prevention for phone, email, name/organization, and name/location.
- Idempotent call completion with method, direction, and phone snapshot.
- Follow-up completion and next-follow-up creation.
- Number-level do-not-call suppression.
- Backfill and legacy primary-phone compatibility.

### Component and workflow tests

- Today queue selection loads the correct workspace without navigation.
- Desktop side-by-side and mobile stacked layouts.
- Multi-number selection and extension presentation.
- Call, office, voicemail, and copy fallbacks.
- Incoming caller exact match, possible-match selection, and quick create.
- Draft recovery after refresh and retention after save failure.
- Contact/event profile entry into the same workspace.

### Manual verification

- Windows Phone Link call initiation through the installed `tel:` handler.
- Copy-number fallback when no handler is configured.
- Individual voicemail workflow with a mobile, office, and unknown number.
- Mobile Log Call flow on an actual phone-sized viewport.
- Keyboard-only navigation, visible focus, screen-reader labels, and touch targets.

## Rollout

Implement behind a server-configured feature flag. Apply and verify the phone-number migration before enabling the new Today workspace. Initially enable for the owner account, confirm call saving and follow-up behavior in production, then make it the default. The standalone Call Workspace remains available throughout rollout as a fallback.

## Acceptance criteria

- The user can work through today's calls without repeatedly leaving Today.
- Contact context includes booking status, route leg, and last contacted date.
- Multiple phone numbers and extensions are clear and selectable.
- Daily UI uses no external voicemail vendor name.
- Exact incoming-number matches are fast; weaker area-code/location matches require a click and explain why they appeared.
- New callers can be captured without obvious duplicate creation.
- Every completed interaction records its direction, method, number snapshot, notes, outcome, and next step.
- Unfinished notes survive reload and save failures.
- Mobile calls can be logged quickly without claiming to capture call audio.
- Existing call history, follow-up logic, ACT-import compatibility, and Last Resort behavior continue to work.
