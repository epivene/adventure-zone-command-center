# Booking Master Work Queue Release 2 Design

**Status:** User-approved Release 2 scope; written design for review  
**Date:** 2026-08-27

## Goal

Extend the Release 1 Booking master work queue into the email execution side of the workflow so the Administrator can create, review, save, schedule, send, and batch-manage opportunity emails from inside the Adventure Zone app while Gmail remains the actual delivery system.

Release 2 begins from the merged Release 1 foundation:

- Event Profile is the permanent cross-year record.
- Opportunity is the event/year pursuit record.
- Today is the master Booking work queue.
- Needs Attention, Active Queue, Completed Today, queue overrides, full-profile navigation, and Current Opportunity are already established.
- Existing Gmail/Google Workspace and Google Calendar integrations remain authoritative infrastructure and are reused rather than replaced.

## Release 2 scope

Release 2 contains the complete email-draft and outbox workflow:

1. Create Draft from the current Opportunity on the Event Profile.
2. Gather relationship, history, current event/contact, Gmail, calendar/package, and booking context in the background.
3. Apply Adventure Zone booking-email rules before generation.
4. Stop on material ambiguity instead of guessing and surface a Needs Review blocker.
5. Open the generated draft directly in an editable composer.
6. Allow Save Draft, Schedule, and Send.
7. Support the approved quick AI editing actions in-place.
8. Add a functional Ready to Send / Outbox section to Today.
9. Support Send now, Tomorrow morning, Morning stagger, and Pick date & time.
10. Prompt for a future follow-up only after an email is actually sent or scheduled.
11. Preserve failed drafts and raise send/schedule failures into Needs Attention.
12. Keep Opportunity state and Today state synchronized with authoritative Gmail outcomes.

Release 2 does not replace the assisted-calling subsystem. Call workflow expansion belongs to a later release.

## Product principles

- Drafts are generated only after the user explicitly chooses **Create Draft**.
- Outgoing communication remains human-reviewable and editable before delivery.
- Gmail is the source of truth for draft/send state; the app coordinates workflow state around it.
- Google Calendar/current package availability remains the availability authority.
- Current verified event/contact information beats stale historical contact details for sending purposes.
- Historical ACT/Gmail/call/profile context still controls relationship tone.
- The app must never silently invent prior contact, event dates, package availability, recipient identity, or relationship history.
- Material ambiguity becomes **Needs Review** rather than a guessed draft.
- A saved draft alone does not create a follow-up because no outreach has occurred yet.
- A scheduled or sent email may create a future follow-up after the user chooses a follow-up option.
- Delivery failure never advances Opportunity state as though outreach succeeded.

## Architecture

### Draft orchestration

Create Draft is an Opportunity action, not a standalone email tool.

The draft service receives an `opportunityId` and resolves the authoritative context from existing systems:

- Event Profile and organization identity
- current Opportunity and event year
- selected/current contact
- ACT-imported history and profile notes
- Gmail conversation/draft history
- recent call/follow-up context when present
- current event dates
- package/calendar availability evidence
- territory and protected-record rules
- approved communication-template and Adventure Zone writing rules

The service returns one of two outcomes:

```ts
type CreateOpportunityDraftResult =
  | {
      ok: true;
      draft: OpportunityEmailDraft;
    }
  | {
      ok: false;
      blocker: DraftBlocker;
    };
```

A blocker is a first-class workflow outcome, not an exception used to hide ambiguity.

```ts
type DraftBlockerCode =
  | "missing_recipient"
  | "ambiguous_recipient"
  | "duplicate_outreach"
  | "current_year_decline"
  | "territory_hold"
  | "protected_record"
  | "availability_unknown"
  | "relationship_ambiguity"
  | "needs_review";
```

When a blocker is material and cannot be safely resolved, Opportunity becomes or remains `needs_review`, and Today receives a Needs Attention item explaining what must be resolved.

### Draft persistence

Release 2 should not invent a parallel mail system. Reuse the existing Google Workspace/Gmail draft infrastructure and extend it only where Opportunity linkage or scheduling metadata is missing.

Each app-managed draft must be traceable to:

- Gmail draft/message/thread identifiers when available
- Opportunity
- Event Profile/organization
- current contact/recipient
- event year
- draft purpose: `new_outreach | follow_up | reply`
- created/updated timestamps
- scheduled delivery metadata when applicable
- last failure metadata when applicable

If an existing draft already belongs to the same Opportunity and purpose, update/reopen it instead of blindly creating a duplicate.

## Create Draft behavior

### Entry point

The Current Opportunity card gains an active **Create Draft** action.

Selecting Create Draft:

1. validates that an Opportunity exists;
2. resolves the current recipient/contact;
3. checks same-year outreach history and existing drafts;
4. loads relationship context;
5. checks current event/date/package context;
6. applies territory/protected-record rules;
7. generates only when the evidence is sufficiently clear;
8. opens the composer directly.

There is no mandatory pre-draft research-summary screen.

### Duplicate-outreach behavior

Before creating a new Gmail draft, the service checks:

- an existing app-managed draft for the same Opportunity;
- a same-year introduction already sent;
- a same-year decline/current not-pursuing outcome;
- whether the correct message type is follow-up or reply rather than another introduction.

Expected behavior:

- existing draft -> reopen/update that draft;
- introduction already sent -> generate a follow-up/reply style message if appropriate;
- current-year decline/not-pursuing -> block routine new outreach and surface Needs Review if the user is trying to override it;
- genuine duplicate ambiguity -> block rather than create another introduction.

## Adventure Zone generation guardrails

### Territory holds

Routine new outreach must not actively pursue:

- New Mexico
- Oregon
- California — licensing restriction
- Kansas
- Oklahoma
- Texas

Previously booked relationships or explicit exceptions require human approval rather than silent rejection.

A territory hold preserves history and Opportunity context and should normally use `territory_hold`, not `declined`.

### Relationship-aware writing

Draft generation uses Event Profile + ACT history + Gmail history + calls/follow-ups together.

The most recent meaningful relationship event controls tone where possible.

The draft must not:

- introduce Adventure Zone as though the relationship is cold when prior outreach exists;
- invent a phone call, email reply, name, title, relationship, event date, or promise;
- contradict a known current-year decline;
- silently use stale contact information when a newer verified recipient exists.

### Current package and pricing rules

Normal inventory basis:

- Adventure Zone: 5
- Pirate's Rebellion: 3
- Warrior's Playground: 1
- restricted fourth Pirate excluded from normal availability

Google Calendar/current verified schedule remains the availability authority.

Normal outreach continues to describe all three packages even when one package is unavailable for the event dates. A fully unavailable package receives the explicit conflicting-date note rather than disappearing without explanation.

Current pricing:

- Adventure Zone — $9,000 / 1–4 days
- Pirate's Rebellion — $7,500 / 1–4 days
- Warrior's Playground — $7,500 / 1–4 days

Warrior's Playground keeps **(ammo extra)**.

Current insurance wording uses **$2M**.

Approved pay-for-play wording:

> In some instances, we may also be able to come at no up-front charge, charge the public to play, and pay your event a percentage of our ticket box sales.

The generator must not add:

- revenue guarantees
- attendance guarantees
- minimum-sales promises
- guarantee language
- "no guarantee" language

### Sponsorship wording

Routine Adventure Zone outreach must not imply that Adventure Zone is volunteering to purchase sponsorship or pay for placement.

Prefer:

- entertainment partnership
- event partnership
- separate staffed attraction area
- family-entertainment area

A sponsorship contact path may be used when the organizer routes vendors that way, while the message remains framed as entertainment participation unless the user explicitly chooses an actual sponsorship discussion.

### Adult-only events

Adult-only / 21+ is not an automatic rejection.

When otherwise appropriate, drafting may reference the special adult configuration where inflatables are combined into one large obstacle-course style experience, provided the profile/event evidence supports that fit.

### Protected records

The system must support explicit protected-contact/draft rules that prevent routine generation, modification, scheduling, or sending without human authorization.

Protected state must be visible in the composer and Today blocker copy.

## Draft editor

The generated draft opens directly in an editable composer tied to the Opportunity.

Minimum fields:

- From account
- To recipient
- subject
- body
- Opportunity/event context strip
- saved/scheduled/send state
- last failure when applicable

Primary actions:

- Save Draft
- Schedule
- Send

Quick AI actions:

- Shorter
- More casual
- More direct
- Rewrite opening
- More personal
- Stronger follow-up
- Fix wording
- Undo AI change

Quick AI edits modify the current draft in place and should preserve unrelated manual edits whenever possible.

`Rewrite opening` is relationship-aware and must not alter unrelated body content unless needed for grammatical continuity.

Undo restores the immediately previous draft content produced by an AI quick action; it does not undo arbitrary user typing history.

## Ready to Send / Outbox on Today

Release 1's placeholder becomes a functional section between Needs Attention and Active Queue.

Collapsed summary example:

```text
Ready to Send
14 drafts ready
3 follow-ups · 11 new outreach
[Review All] [Schedule] [Send Selected]
```

The section can expand to rows showing:

- checkbox/select state
- event name
- recipient
- message purpose
- Opportunity status
- scheduled time if any
- warning/blocker/failure indicator when applicable

Routine ready drafts stay in Ready to Send instead of flooding Active Queue.

Important reply/hot-lead drafts may also have a corresponding Needs Attention item.

## Scheduling

### Presets

Release 2 supports:

- Send now
- Tomorrow morning
- Morning stagger
- Pick date & time

### Booking send settings

Send-window defaults are configurable Booking settings rather than permanent constants.

Initial settings include:

- default morning start time
- default morning end time
- weekday-aware behavior
- recipient-local timing when recipient timezone can be determined safely
- user timezone fallback

### Tomorrow morning

Tomorrow morning chooses the next valid configured morning delivery time, respecting weekday rules.

### Morning stagger

Morning stagger distributes selected drafts through the configured morning window.

Before confirmation, show a concise scheduling preview such as:

```text
18 emails selected
12 recipients: 8:00–8:45 AM
6 later-zone recipients: 9:00–9:30 AM
```

The exact distribution may account for recipient timezone when known; uncertain timezone falls back to configured user/business timezone rather than guessing from weak evidence.

### Manual scheduling

Pick date & time allows an explicit timestamp override for one or multiple selected drafts.

## Send and schedule state transitions

### Successful send

After Gmail confirms send:

- record outbound email activity;
- mark the current draft sent;
- update Opportunity mechanically to `contacted` when this is the first successful outreach and current status permits it;
- move the corresponding work item to Completed Today;
- offer the follow-up prompt.

### Successful schedule

After scheduling is confirmed:

- preserve the scheduled Gmail/outbox state;
- record scheduled activity;
- mark the Opportunity/email task as scheduled, but do not falsely record the email as already sent;
- show the scheduled row in Ready to Send/Outbox until actual delivery or cancellation;
- offer the follow-up prompt using the scheduled-send timestamp as the reference point for the chosen interval.

### Failure

If Gmail create/update/send/schedule fails:

- preserve the latest draft content;
- do not mark the email sent;
- do not advance Opportunity to `contacted` because of the failed operation;
- preserve scheduled intent where useful for retry;
- write failure metadata;
- surface a Needs Attention item with a clear retry/fix action;
- keep the draft accessible from the composer and Ready to Send.

Retry uses the existing draft instead of generating a new message.

## Follow-up prompt after send/schedule

After a successful send or schedule operation, show:

```text
Follow up if no reply?
[3 days] [7 days] [Pick date] [No follow-up]
```

Rules:

- Save Draft does not trigger this prompt.
- Send uses the actual send time as the interval reference.
- Schedule uses the scheduled delivery time as the interval reference.
- Selecting a follow-up option reuses the Release 1 follow-up mechanism and links the future action to the same Opportunity.
- `No follow-up` leaves no automatic chase task.
- Reply conversations may use a waiting state instead of creating an unnecessary chase task when the conversation evidence indicates that the other party is expected to respond next.

## Opportunity integration

Release 2 extends Opportunity state with email-specific metadata while keeping the existing status model intact.

Recommended Opportunity-level metadata:

- current draft id
- current Gmail thread id when known
- current recipient/contact id
- draft purpose
- last email state: `none | draft | scheduled | sent | failed`
- last scheduled/send timestamp
- last email failure code/message

These fields may live in an additive email-state table if that keeps Opportunity persistence focused; the implementation plan should follow existing repository patterns rather than forcing every field onto `booking_opportunities`.

Subjective states remain manual/suggested. Sending an email does not automatically imply `interested`.

## Activity timeline integration

Email actions must be reflected in the Event Profile timeline using existing activity infrastructure where possible.

Release 2 records or exposes:

- draft created
- draft updated where meaningful
- email scheduled
- email sent
- send/schedule failure
- follow-up created after outreach

Routine keystroke-level edits are not timeline events.

## Needs Attention integration

Release 2 adds email-related Needs Attention sources:

- draft blocked by ambiguity
- protected-record approval required
- territory exception requiring review
- send failure
- schedule failure
- bounced/failed delivery when existing Gmail sync exposes it
- important reply draft requiring personal review

Each item opens the full Event Profile/current Opportunity or the associated composer context and preserves Back to Today behavior from Release 1.

## API surface

Exact route names should follow current route conventions, but Release 2 needs equivalent behavior for:

```text
POST /opportunities/:id/drafts
GET  /opportunities/:id/draft
PATCH /opportunities/:id/draft
POST /opportunities/:id/draft/rewrite
POST /opportunities/:id/draft/send
POST /opportunities/:id/draft/schedule
POST /opportunities/:id/draft/retry
GET  /today/ready-to-send
POST /today/ready-to-send/send
POST /today/ready-to-send/schedule
```

All mutation routes require authenticated owner/admin access and validate that the draft belongs to the requested Opportunity.

Bulk endpoints validate every selected draft before beginning delivery/scheduling and report per-item failures without falsely marking failed rows successful.

## Error handling and idempotency

- Create Draft is idempotent for an existing current Opportunity draft unless the user explicitly starts a new version after sending/cancelling the previous one.
- Send uses an idempotency/request key where the existing Gmail service supports one or adds one at the app orchestration layer.
- Scheduling a draft twice with the same request key does not create duplicate deliveries.
- Partial bulk failure returns item-level outcomes and preserves failed drafts.
- Network timeouts do not automatically mean send failure; when outcome is uncertain, reconcile against Gmail before retrying to avoid duplicate email.
- Malformed Opportunity/draft IDs return validation errors rather than falling through to generic 500 responses.

## Testing requirements

Release 2 uses TDD and focused CI.

Required coverage:

- Create Draft explicit-action requirement
- relationship-aware context selection
- missing/ambiguous recipient blocker
- territory hold blocker and exception path
- protected-record blocker
- duplicate draft/outreach prevention
- current-year decline behavior
- package/pricing/insurance/pay-for-play/sponsorship guardrail contract tests
- draft reopen/update behavior
- composer Save Draft
- each AI quick action and Undo AI change boundary
- Ready to Send counts and expansion
- individual and bulk selection behavior
- Tomorrow morning scheduling
- Morning stagger deterministic scheduling
- manual date/time scheduling
- successful send Opportunity/Completed Today integration
- successful schedule state integration
- follow-up prompt only after send/schedule
- failure preservation and Needs Attention promotion
- idempotent send/schedule retry behavior
- partial bulk failure
- Back to Today from composer/profile context
- regression coverage for Release 1 Today queue, Opportunity, follow-ups, Google Workspace, and Event Profile behavior

Global repository typecheck currently has pre-existing debt; Release 2 CI must still run focused package typechecks/builds and must not introduce new errors in files touched by Release 2. Existing informational global typecheck failures must not be disguised as new Release 2 failures.

## Acceptance flow

A Release 2 manual acceptance pass should prove this sequence:

1. Open a current Opportunity from Today.
2. Click Create Draft.
3. Confirm a clear opportunity generates a relationship-aware draft directly into the composer.
4. Edit the draft manually and use one AI quick action, then Undo.
5. Save it and confirm it appears in Ready to Send without creating a follow-up.
6. Schedule it for Tomorrow morning and confirm the scheduled state is visible.
7. Choose a future follow-up and confirm it is linked to the same Opportunity using Release 1 behavior.
8. Run a separate Send now path and confirm successful send moves the work to Completed Today and updates Opportunity mechanically.
9. Force a send/schedule failure and confirm the draft remains intact and a Needs Attention item appears.
10. Attempt a territory/protected/ambiguous/duplicate case and confirm drafting stops instead of guessing.
11. Use Ready to Send with multiple selected drafts and confirm a batch schedule preview plus per-item outcomes.
12. Return to Today and confirm queue/scroll context is preserved.

## Completion criteria

Release 2 is complete when:

- Create Draft works from Current Opportunity and never auto-generates without explicit user action.
- Draft generation uses authoritative relationship/current-event/calendar context and obeys the approved Adventure Zone wording rules.
- Material ambiguity blocks safely into Needs Review.
- Existing Opportunity drafts are reused instead of duplicated.
- The composer supports manual editing, the approved quick AI actions, Save Draft, Schedule, and Send.
- Ready to Send is a functional Today section with individual and bulk actions.
- scheduling presets behave deterministically and are configurable through Booking send settings.
- successful send/schedule updates workflow state only after authoritative confirmation.
- failed operations preserve the draft and rise to Needs Attention.
- follow-up creation happens only after successful send/schedule and only after the user chooses an option.
- Activity Timeline and Completed Today reflect email actions appropriately.
- Release 1 queue/navigation/follow-up behavior remains intact.
- focused tests and builds for the touched API/web/Google Workspace areas pass.

## Out of scope for Release 2

- replacing or redesigning the assisted-calling subsystem
- voice-to-text call notes
- automatic outbound email generation without Create Draft
- fully autonomous sending without user review/selection
- marketing campaign/mass-promo email replacement
- automatic subjective Opportunity transitions such as marking `interested`
- large-scale notification redesign
- retraining smart queue priority from manual ordering
