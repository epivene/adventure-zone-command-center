# Booking Master Work Queue Design

**Status:** User-approved product direction; implementation pending  
**Date:** 2026-08-26

## Goal

Turn the Booking workspace into the single day-to-day operating hub for Adventure Zone sales work.

The Administrator should be able to use the app for the full booking workflow that is currently split across Gmail, calls, notes, calendar checks, CRM history, research, follow-ups, and manual task tracking.

The design centers on four ideas:

1. **Today is the master work queue.**
2. **Each event profile remains the permanent long-term record.**
3. **Each year/event pursuit gets an Opportunity that tracks the current booking workflow.**
4. **Email, calls, notes, replies, follow-ups, research, and booking activity all feed one unified event history.**

This design belongs inside the existing **Booking** workspace and uses the shared Gmail/Google Calendar/CRM infrastructure already planned for the application.

## Product principles

1. The app should tell the user what needs attention today without requiring them to hunt through Gmail, call logs, profile notes, or separate task screens.
2. The app may suggest and automate obvious bookkeeping, but the user stays in control of subjective decisions and outgoing communication.
3. Research should happen in the background where possible. The user should not be forced through a summary screen before drafting unless something is unclear.
4. A finished task should move out of the active queue but remain visible under **Completed Today**.
5. Finishing an action that requires another touch should create the future follow-up automatically.
6. Calls and emails are communication methods on the same booking opportunity, not separate workflows.
7. Gmail remains the actual email system, Google Calendar remains the package/date availability authority, and the Adventure Zone app becomes the workflow command center coordinating them.
8. Existing profile history must be preserved. New opportunity state must not overwrite prior-year history.
9. The system must never silently guess through important ambiguity. Unclear leads become **Needs Review** items.
10. Outgoing email remains reviewable and editable before it is sent or scheduled.

## Relationship to the existing workspace design

The approved Admin Workspace design classifies Today, Profiles, Calls, Follow-ups, Research, Bookings, Schedule/Calendar, and the Booking Assistant as Booking tools.

This design deepens that Booking workspace rather than creating a new top-level workspace.

The existing Command Panel structure remains:

- Booking
- Marketing
- Legs & Operations

Marketing still handles promotional campaigns at scale. This feature handles one-event-at-a-time booking outreach and relationship management.

## Core architecture

### Event Profile

The Event Profile is the permanent record for an event, organization, or event family across years.

It owns or references long-term information such as:

- organization/event identity
- contacts
- historical notes
- ACT-imported history
- Gmail conversation history
- call history
- files/contracts
- bookings
- prior outcomes
- internal notes
- event family relationships

A new year does not create a duplicate Event Profile merely because a new booking cycle begins.

### Opportunity

An Opportunity represents the active attempt to book a specific event/year.

Examples:

- Fruita Fall Festival — 2026 opportunity
- Fruita Fall Festival — 2027 opportunity

Both belong to the same Event Profile but maintain separate current-cycle state.

Suggested Opportunity fields:

```ts
type OpportunityStatus =
  | "new_lead"
  | "researching"
  | "ready_to_contact"
  | "contacted"
  | "follow_up"
  | "interested"
  | "booking_in_progress"
  | "booked"
  | "not_pursuing"
  | "declined"
  | "no_response"
  | "territory_hold"
  | "needs_review"
  | "cancelled";
```

Core fields should include:

- profile/event id
- event year
- verified event dates
- current status
- priority
- assignee
- next action type
- next action due date/time
- outreach type
- current contact used
- package availability check state / latest snapshot metadata
- email draft state
- scheduled/sent state
- reply state
- latest call disposition
- final outcome
- hold/review reason when applicable
- timestamps

The Opportunity status describes the state of the booking pursuit, not the current task.

For example, **Call tomorrow** is a next action, not a status.

### Activity Timeline

Each Event Profile has a unified chronological activity timeline containing:

- inbound email
- outbound email
- Gmail draft/schedule/send activity
- calls
- voicemail outcomes
- notes
- follow-ups created/completed
- status changes
- booking progress
- contracts/files where appropriate
- bounced emails
- wrong-contact events
- research decisions
- important system actions

Timeline filters:

- All
- Email
- Calls
- Notes
- Tasks
- Booking

Activity records should link to the relevant Opportunity when one exists.

## Today becomes the master work queue

The existing Today experience becomes the Administrator's primary Booking work surface.

It should feel like a working desk rather than a statistics dashboard.

### Section 1: Needs Attention

This section appears at the top and is driven by meaningful events, not only due dates.

Examples:

- new email reply
- returned call / voicemail
- hot or interested lead
- callback due
- urgent follow-up
- bounced email
- wrong contact
- booking question requiring a decision
- send/schedule failure
- unresolved blocker

Needs Attention items automatically rise above routine work.

### Section 2: Ready to Send

Ready email drafts appear as a compact batch-oriented section instead of flooding the normal queue with dozens of individual email rows.

Example:

```text
Ready to Send
14 drafts ready
3 follow-ups · 11 new outreach
[Review All] [Schedule] [Send Selected]
```

The section can expand to individual drafts.

An especially important email, such as a hot lead or reply requiring a personal response, may also surface in Needs Attention.

### Section 3: Active Queue

The Active Queue contains routine work such as:

- calls
- callbacks
- follow-ups
- research
- create-draft tasks
- review holds
- contact verification
- booking tasks
- new outreach leads
- cleanup that blocks the booking workflow

Each row should show:

- event name
- city/state
- task type
- short reason/context
- due date/time when applicable
- Opportunity status
- priority indicator
- quick actions
- pin control
- snooze control
- drag/reorder affordance

### Smart order + manual control

The queue is smart-sorted by default, but the user can override it.

Default priority order:

1. new replies / needs answer
2. callbacks due today
3. hot/interested leads
4. follow-ups due today
5. drafts ready to send
6. research/review holds
7. new outreach leads
8. lower-priority cleanup

Manual controls:

- Pin to top
- Mark urgent
- Snooze
- Drag/reorder within the day
- Filter by work type
- Reset to smart order

Manual day ordering should normally apply to the current day only unless the user explicitly changes the underlying priority/status.

### Completed Today

Completed Today remains visible below the active work but is collapsed by default.

Examples of completed rows:

- Email sent
- Email scheduled
- Call completed — no answer
- Left voicemail
- Research finished — held
- Follow-up scheduled for Sept. 3
- Booked

When a completed action requires another touch, the current item moves to Completed Today and a new future action is created automatically.

Example:

```text
Call completed — left voicemail
→ Completed Today
→ Follow-up task created for +3 days
```

## Navigation behavior

Selecting a queue item opens the **full Event Profile**, not a side panel.

The profile receives enough context to highlight the current Opportunity/current task.

A visible **Back to Today** action restores:

- prior queue filters
- queue position
- selected view/state where practical

The user should not return to the top of Today after every profile visit.

On mobile, the profile remains full-screen and Back to Today is prominent.

## Event Profile working layout

The profile becomes the place where the user actually works the account, not merely a reference screen.

### Current Opportunity summary

Near the top:

```text
Current Opportunity
Status: Follow-Up
Next action: Call Sept. 2
2026 event dates: Sept. 26–27
Package availability: Checked
Last contact: Email sent Aug. 27

[Call] [Create Draft] [Add Note] [Schedule Follow-Up] [Mark Interested] [Booked]
```

### Supporting sections

- Contacts
- Unified Activity Timeline
- Emails & Drafts
- Calls
- Bookings / Calendar
- Files / Contracts
- Internal Notes

## Opportunity automation rules

Clear mechanical actions may update status automatically.

Examples:

- research started → Researching
- verified contact/history/date/package checks complete → Ready to Contact
- first email sent or completed outbound call → Contacted
- future follow-up created → Follow-Up
- booking workflow/contract work begins → Booking in Progress
- confirmed booking → Booked

Subjective transitions should be suggested rather than silently forced.

Example:

- positive reply/call outcome → suggest **Interested**

The user can always manually override Opportunity status.

## Create Draft flow

The user explicitly clicks **Create Draft**.

The app does not auto-generate drafts merely because a lead becomes ready.

When Create Draft is clicked, the app should gather the available context in the background:

- Event Profile history
- ACT-imported notes/history
- Gmail history
- current-year outreach state
- latest meaningful reply/call
- current verified event/contact data
- Google Calendar/package availability
- territory rules
- standing Adventure Zone outreach rules

If the evidence is clear, the app generates the finished draft directly into the editor.

There is no mandatory pre-draft research-summary screen.

If important evidence is ambiguous, drafting should stop and create or surface a Needs Review blocker rather than guessing.

## Draft editor

The draft opens directly in an editable composer.

The user can freely edit text and use quick AI actions.

Initial quick actions:

- Shorter
- More casual
- More direct
- Rewrite opening
- More personal
- Stronger follow-up
- Fix wording
- Undo AI change

AI actions should modify the current draft in place and preserve unrelated manual edits whenever possible.

**Rewrite opening** should be especially context-aware because relationship history is usually most important in the opening.

Primary actions:

- Save Draft
- Schedule
- Send

Creating a follow-up is secondary and should be prompted after scheduling/sending rather than cluttering the primary composer actions.

## Adventure Zone email guardrails

Draft generation must apply the established Booking workflow rules.

### Territory holds

Do not actively pursue normal new outreach in:

- New Mexico
- Oregon
- California — licensing restriction
- Kansas
- Oklahoma
- Texas

Previously booked or explicitly approved exceptions require human approval.

Territory holds preserve relationship history and should not be treated as permanent declines.

### Relationship-aware writing

Use Event Profile + ACT history + Gmail history + calls together.

The most recent meaningful relationship event should normally control the tone.

Do not write a cold introduction when the organization has already been contacted.

Do not invent phone calls, replies, contact relationships, dates, or prior interactions.

### Current information

Current verified event/contact information beats stale spreadsheet or ACT data for sending purposes while historical relationship context remains preserved.

### Duplicate outreach

Before saving a new draft, check for:

- existing draft for the same opportunity
- same-year introduction already sent
- a message that should be a follow-up rather than a new introduction
- current-year decline

Update an existing draft where appropriate rather than creating duplicates.

### Package rules

Normal inventory basis:

- Adventure Zone: 5
- Pirate's Rebellion: 3
- Warrior's Playground: 1
- restricted fourth Pirate excluded from normal availability

Google Calendar/current verified schedule remains the availability authority.

All three packages remain in normal outreach even if one is unavailable for the current dates. A fully unavailable package gets the explicit conflicting-date note.

Current pricing:

- Adventure Zone — $9,000 / 1–4 days
- Pirate's Rebellion — $7,500 / 1–4 days
- Warrior's Playground — $7,500 / 1–4 days

Warrior's Playground retains **(ammo extra)**.

Current insurance wording uses **$2M**.

Approved pay-for-play wording:

> In some instances, we may also be able to come at no up-front charge, charge the public to play, and pay your event a percentage of our ticket box sales.

Do not add revenue guarantees, attendance guarantees, minimum-sales promises, guarantee language, or "no guarantee" language.

### Sponsorship wording rule

Adventure Zone outreach must not imply that Adventure Zone is volunteering to purchase sponsorship or pay for placement.

Avoid **sponsor/sponsorship** language in normal outreach unless the user explicitly chooses to discuss a real sponsorship arrangement.

Acceptable wording includes:

- entertainment partnership
- event partnership
- separate staffed attraction area
- family-entertainment area

If an organizer routes commercial businesses through a sponsorship contact path, that contact path may still be used while the Adventure Zone email remains framed as entertainment participation rather than an offer to buy sponsorship.

### Adult-only events

Adult-only / 21+ is not an automatic rejection.

If otherwise appropriate, the app may consider the special adult configuration where inflatables are combined into one large obstacle-course style experience.

Fit, safety, space, organizer rules, and relationship context still control the decision.

### Protected/exception records

The system must support explicit protected-contact/draft rules that prevent routine automation from changing or sending designated records without human authorization.

## Scheduling and Outbox

The app should provide an in-app **Ready to Send / Outbox** capability rather than forcing one-by-one Gmail scheduling.

### Presets

Initial scheduling presets:

- Send now
- Tomorrow morning
- Morning stagger
- Pick date & time

### Send Window Rules

Booking settings should store configurable defaults rather than hardcoding them forever.

Initial conceptual defaults:

- morning business-hour send window
- recipient-local timing where possible
- weekday-aware behavior
- user timezone respected

**Tomorrow morning** uses the configured default morning time.

**Morning stagger** spreads selected messages through the configured morning window and may account for recipient time zones.

Before confirming a bulk schedule, show a concise preview of what will happen.

Example:

```text
18 emails selected
12 recipients: 8:00–8:45 AM
6 later-zone recipients: 9:00–9:30 AM
```

The user may override any preset with a manual date/time.

### Send/schedule failure

If Gmail scheduling/sending fails:

- do not mark the opportunity as sent
- preserve the draft
- surface the failure in Needs Attention
- show a clear retry/fix action

## Follow-up prompt after send/schedule

After an email is actually scheduled or sent, prompt:

```text
Follow up if no reply?
[3 days] [7 days] [Pick date] [No follow-up]
```

A plain saved draft does not create a follow-up yet because nothing has been sent.

For reply conversations, the app may use more appropriate states such as **Waiting on them** rather than blindly creating another chase task.

## Call workflow

The full Event Profile provides a **Call** action.

The call workspace uses the current selected contact and shows concise useful context rather than dumping the complete history into the call surface.

Suggested dispositions:

- No answer
- Left voicemail
- Spoke — not interested
- Spoke — interested
- Call back later
- Wrong contact
- Needs email
- Needs review

After a disposition, the app should handle the bookkeeping automatically where clear:

- add call activity to the timeline
- update Opportunity state when mechanical/obvious
- complete the current Today task
- create the next follow-up when required
- surface Create Draft after **Needs email**
- create a Needs Attention/contact-cleanup item after **Wrong contact**

Call notes should stay quick: a small text field first, with optional voice-to-text later.

## Suggested + manual follow-up timing for calls

For outcomes such as No answer or Left voicemail, the app should propose a sensible next date but let the user override it.

Example:

```text
Left voicemail
Suggested: Follow up in 3 days
[Use suggestion] [Tomorrow] [7 days] [Pick date]
```

Suggestions may become context-aware over time:

- first outreach → shorter standard interval
- later follow-up → longer interval
- explicit "call next Tuesday" → Tuesday
- event coming soon → shorter timing
- future-year prospect → longer timing

Suggestions never remove manual control.

## Incoming activity and Needs Attention

Meaningful inbound activity automatically promotes the relevant Opportunity into Needs Attention.

Examples:

- new email reply
- returned call
- voicemail
- interested response
- callback due
- bounced message
- wrong contact
- urgent booking action

Opening the item goes directly to the Event Profile/current Opportunity context.

## Notification policy

Today updates automatically for all queue changes, but device/in-app alerts remain selective.

Notify for:

- new email replies
- returned calls / voicemail
- hot/interested leads
- urgent due items
- bounced email / wrong contact when it blocks progress

Do not generate noisy alerts for:

- routine follow-ups becoming due
- normal research tasks
- ordinary draft-ready items

Those simply appear or rise in Today.

## Notes and permissions

Internal notes appear in the unified timeline but are visually distinct from customer communication.

Two note types:

### Internal Team Note

Visible/addable by:

- Administrator
- Office Coordinator

Never included in outgoing customer communication.

### Admin Only Note

Visible/addable only by authorized Administrator roles.

Leg Managers should only receive operational notes/context that their role is already permitted to access. They do not gain unrestricted access to Booking relationship history merely because one unified timeline exists server-side.

## Research and hold workflow

If the app cannot safely continue, it must never guess and never let the lead disappear into passive notes.

Create a **Needs Review** item with the explicit blocker.

Common blockers:

- conflicting event dates
- unclear current organizer
- multiple plausible contacts
- no verified email
- package availability uncertainty
- territory hold
- prior decline requiring judgment
- relationship/safety issue requiring review
- event fit unclear
- current event not verified
- uncertain duplicate profile match

Needs Review should show the shortest useful next action, such as:

- Research
- Choose Contact
- Check Calendar
- Review History
- Mark Not Pursuing
- Admin Override / Create Draft Anyway where permitted

When the blocker is resolved, the Opportunity returns to its appropriate normal state and the review task moves to Completed Today.

## Reply processing and CRM hygiene

Every meaningful inbound reply should trigger a lightweight CRM hygiene pass.

Check/update as supported:

- contact name
- role
- email
- phone
- website
- address/location
- opportunity status
- outcome
- next action
- stale contact data

Current verified reply information beats stale historical values while history remains preserved.

A reply should leave the profile cleaner than before.

## Data flow

Conceptually:

```text
Spreadsheet / Scout / Lead Discovery
        ↓
Event Profile search / match
        ↓
Opportunity for event year
        ↓
Research + history + Gmail + Calendar checks
        ↓
Today queue state
        ↓
Call / Create Draft / Review / Booking action
        ↓
Activity Timeline
        ↓
Status + next action automation
        ↓
Completed Today and/or future queue item
```

Incoming Gmail/call activity feeds the same flow from the side and can promote the Opportunity into Needs Attention.

## Error handling

- Missing Gmail connection: show connection issue; do not fabricate email state.
- Missing Calendar connection: package availability remains unverified; do not guess.
- Ambiguous profile match: Needs Review.
- Draft generation failure: preserve opportunity/task state and allow retry.
- Send/schedule failure: preserve draft; Needs Attention.
- Call logging failure: retain unsaved note/disposition locally where practical and make retry obvious.
- Invalid automated status transition: keep current status and surface a non-blocking correction path.

No integration failure should silently mark work complete.

## Mobile behavior

Today remains usable as the primary mobile work surface.

- Needs Attention stays first.
- Ready to Send is compact/collapsible.
- Active Queue rows are touch friendly.
- Event item opens the full profile.
- Back to Today restores queue context.
- Primary profile actions such as Call, Create Draft, Add Note, and Follow-Up remain reachable without desktop-only hover behavior.

## Testing strategy

### Opportunity tests

Prove:

- separate opportunities may exist for the same profile in different years;
- prior-year history is not overwritten;
- mechanical transitions occur correctly;
- subjective transitions are suggested rather than forced;
- manual override remains possible.

### Today queue tests

Prove:

- Needs Attention outranks routine work;
- smart ordering follows the expected rules;
- pin/snooze/manual reorder work;
- reset restores smart order;
- Completed Today retains completed items;
- completing an action can create a future task;
- queue filters/position survive Profile → Back to Today navigation.

### Draft tests

Prove:

- Create Draft requires an explicit user action;
- context is gathered before generation;
- ambiguous blockers prevent guessing;
- quick actions edit the current draft rather than destroying manual changes;
- duplicate drafts/current-year outreach are detected;
- sponsorship wording guardrail is enforced;
- territory rules are enforced;
- correct pricing, insurance, package wording, and pay-for-play language are preserved.

### Scheduling tests

Prove:

- send presets resolve correctly;
- recipient-local/morning-window rules behave correctly;
- bulk preview matches scheduled results;
- failure does not mark messages sent;
- protected records cannot be accidentally scheduled/sent.

### Call tests

Prove:

- disposition creates timeline activity;
- suggested follow-up timing is overridable;
- completed call moves to Completed Today;
- future action is created when appropriate;
- Wrong contact and Needs email create the appropriate next work.

### Reply/notification tests

Prove:

- meaningful replies enter Needs Attention;
- selective notifications fire only for configured important categories;
- routine tasks update Today without noisy alerts;
- reply processing can prompt profile/contact cleanup.

### Permissions tests

Prove:

- Internal Team Notes are available to Admin + Office Coordinator;
- Admin Only Notes remain restricted;
- Leg Manager access remains bounded to operationally permitted context.

## Non-goals for the first implementation

This feature does not initially require:

- a full enterprise sales CRM/HubSpot-style kanban system
- fully autonomous email drafting/sending
- auto-sending emails without review
- voice transcription for every call
- advanced predictive lead scoring
- complex campaign analytics
- moving one-to-one Booking outreach into the Marketing workspace
- replacing Gmail or Google Calendar as source systems
- duplicating profile/contact records for each year

## Recommended implementation shape

Build this as a **unified Opportunity/Booking workflow layer**, not as a collection of unrelated widgets.

Recommended subsystem boundaries:

1. **Opportunity model/service** — current-year booking pursuit state.
2. **Today queue service** — priority calculation, manual overrides, Completed Today.
3. **Activity timeline service** — normalized email/call/note/task/status history.
4. **Draft workflow service** — context gathering, guardrails, AI draft/edit actions.
5. **Outbox/scheduling service** — presets, send windows, Gmail state/error handling.
6. **Call workflow service** — dispositions, notes, suggested/manual follow-up.
7. **Inbound activity service** — replies/callbacks/bounces promoting Needs Attention.
8. **Research/review blocker service** — explicit holds and resolution.

These components should reuse existing Gmail, Calendar, profile, call, booking, and role/permission systems rather than duplicating them.

## Completion criteria

The design is successfully implemented when an Administrator can:

- open Booking → Today and see one prioritized master work queue;
- see new replies/callbacks/urgent blockers at the top;
- review and bulk schedule ready email drafts from Today;
- manually pin/reorder/snooze work while retaining smart defaults;
- complete work and still see it under Completed Today;
- automatically create future follow-ups from completed actions;
- open the full Event Profile and return to the same Today position;
- manage the current event-year Opportunity from the profile;
- click Create Draft and receive a history-aware/current-data-aware draft directly in an editable composer;
- use AI quick-edit actions plus normal text editing;
- schedule via Send now / Tomorrow morning / Morning stagger / custom time;
- choose a follow-up interval after send/schedule;
- place/log calls with quick dispositions and suggested/manual next dates;
- receive meaningful replies/returned calls automatically in Needs Attention;
- use a unified timeline for email/calls/notes/tasks/bookings;
- add Internal Team or Admin Only notes with correct permissions;
- resolve ambiguous leads through explicit Needs Review items;
- preserve territory, relationship, duplicate, availability, adult-event, protected-record, and outreach-wording guardrails;
- operate the normal Booking day primarily from the Adventure Zone app instead of manually coordinating separate Gmail, call, calendar, and CRM workflows.
