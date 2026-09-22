# Event Date Coverage and Research Design

## Goal

Make every real event profile show the best trustworthy next-event date available without changing historical bookings, creating false bookings, or flooding the working calendar with tentative events.

The system must recover dates from existing Command Center records first, research only unresolved profiles, distinguish confirmed dates from expected dates, preserve evidence, and provide an administrator workflow for reviewing coverage across the full profile directory.

## User Outcome

On profile cards and the profile “At a glance” section, the booking team can immediately see one of:

- **Confirmed · Sep 4–6, 2027**
- **Expected · Sep 4–6, 2027**
- **Needs review**
- **Date not found**

A confirmed future booking remains the strongest source and always wins. A researched or calculated date improves outreach planning but does not imply that Adventure Zone is booked for the event.

## Scope

Initial coverage includes profiles representing actual fairs, festivals, celebrations, school events, tribal events, and other recurring public events.

The bulk workflow should prioritize:

1. profiles with historical bookings;
2. profiles with active outreach or follow-ups;
3. fair and festival/event profiles;
4. profiles with recognizable event history in emails, notes, calendar records, ACT imports, or attendance history.

Plain companies, associations, venues, and government organizations are excluded unless they have a linked recurring event or dated event history. Administrators may widen the filter when needed.

## Non-Goals

This feature does not:

- mark an event booked;
- change a booking status or probability;
- put expected dates on the operations calendar, route map, or leg schedule;
- overwrite or re-date a historical booking;
- send outreach;
- create follow-ups;
- merge profiles;
- silently accept conflicting evidence;
- run public internet research without an administrator starting a batch or a user starting profile research.

## Date Sources and Precedence

The effective next-event date uses the first available source in this order:

1. earliest non-cancelled future booking;
2. active confirmed researched date;
3. active expected date;
4. no trustworthy date.

A booking is displayed using its existing booking state and is not copied into the researched-date store.

### Confirmed

A date is **Confirmed** when an authoritative source publishes the exact future date or range for the matching event.

Preferred evidence:

- official event website;
- official organizer, city, county, parks, tribe, school, or fair page;
- official association calendar when it is the publishing authority;
- a verified email, contract, calendar record, or booking document already linked in Command Center.

A third-party directory alone cannot produce a confirmed date.

### Expected

A date is **Expected** when exact future dates are not officially published but the next occurrence can be supported by a clear recurrence rule or consistent history.

Acceptable evidence includes:

- an official statement that the event occurs on a named holiday weekend, numbered weekday, or other computable annual rule;
- at least two trustworthy prior occurrences showing the same computable recurrence pattern;
- multiple credible sources agreeing on a customary annual pattern.

Expected dates must retain the recurrence explanation, evidence, and calculation year. A simple one-year rollover is not enough when the event depends on weekdays or holidays.

Examples:

- “Labor Day weekend” is calculated from the 2027 Labor Day calendar.
- “Second full weekend in July” is calculated as that rule.
- A single 2026 date copied to 2027 without supporting recurrence evidence remains unresolved.

### Needs Review

A result is **Needs review** when:

- sources disagree;
- identity matching is uncertain;
- only low-quality directories support the date;
- the recurrence rule is ambiguous;
- an incoming result conflicts with an existing active date;
- the date range is incomplete.

Needs-review results do not become the effective profile date until approved.

## Data Model

Add a dedicated researched date-fact table rather than creating potential bookings or storing only one mutable date on the organization.

Conceptual fields:

```ts
type EventDateFact = {
  id: string;
  organizationId: string;
  startsOn: string;
  endsOn: string | null;
  status: "confirmed" | "expected" | "needs_review";
  recurrenceRule: string | null;
  rationale: string;
  sourceKind: "internal" | "web" | "derived";
  sourceTitle: string;
  sourceUrl: string | null;
  sourceRecordType: string | null;
  sourceRecordId: string | null;
  researchedAt: string;
  verifiedAt: string | null;
  active: boolean;
  supersededById: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};
```

The implementation may normalize sources into the existing profile-research source tables, but it must preserve these semantics:

- exact date range;
- confirmed/expected/review status;
- evidence;
- derivation or recurrence rule;
- audit history;
- ability to supersede without deleting prior evidence.

Only one researched fact may be active as the effective date for a profile at a time. Conflicting candidates remain review items.

## Effective Date Resolver

Create one shared resolver used by profile lists, profile details, exports, Assistant context, and future coverage reporting.

Input:

- current date;
- non-cancelled bookings;
- active researched date facts.

Output:

```ts
type EffectiveNextEventDate = {
  startsOn: string;
  endsOn: string | null;
  displayStatus: "booked" | "confirmed" | "expected";
  sourceId: string;
} | null;
```

Rules:

- ignore cancelled or declined bookings;
- ignore past date facts;
- prefer the earliest future booking;
- otherwise prefer a confirmed fact over an expected fact;
- never expose needs-review facts as the effective date;
- use date-only values to avoid timezone day shifts.

## Profile Display

### Profile cards

Replace the current bare date with a compact labeled range:

- **Booked Sep 4–6, 2027**
- **Confirmed Sep 4–6, 2027**
- **Expected Sep 4–6, 2027**
- **Date not found**

The existing next-action, deal recommendation, and status remain separate.

### At a glance

Show:

- full date range;
- Booked, Confirmed, or Expected badge;
- “View source” or “View evidence” for researched dates;
- last researched/verified date;
- a warning when a newer unresolved conflict exists.

Expected dates must never visually resemble confirmed bookings.

### Profile research

When “Next event dates” is a detected gap, the research provider may return a new event-date candidate instead of targeting the newest historical booking.

Applying an approved result creates or supersedes an event date fact. It never edits an old booking’s `startsAt` or `endsAt`.

## Event Date Coverage Admin Tool

Add **Event Date Coverage** under Admin Tools.

### Summary counts

- Booked
- Confirmed
- Expected
- Missing
- Stale
- Needs review

### Filters

- travel leg;
- profile type;
- historical booking present;
- active outreach/follow-up;
- date status;
- last researched range;
- priority.

### Profile rows

Each row shows:

- profile name and location;
- last known event date;
- effective next date and status;
- next action;
- evidence/source state;
- research status;
- actions to research, review, approve, or dismiss.

### Bulk actions

- **Build coverage list** performs a read-only audit.
- **Research selected** or **Research next batch** runs controlled public research.
- **Approve selected confirmed**
- **Approve selected expected**
- **Dismiss selected**
- **Export coverage CSV**

There is no “accept all low-confidence” action.

## Bulk Research Processing

Research uses a persisted queue so closing the browser does not lose progress.

Default batch size is 25 profiles. Processing must be rate-limited and resumable.

Job states:

- queued;
- researching;
- complete;
- needs_review;
- failed;
- skipped.

The worker must:

1. rebuild current profile context before research;
2. search internal evidence first;
3. skip public research when internal evidence resolves the date;
4. use the existing profile-research provider for unresolved profiles;
5. validate identity before accepting evidence;
6. store candidates and sources;
7. avoid duplicate jobs and duplicate active facts;
8. retry transient failures with bounded backoff;
9. stop cleanly on provider quota or configuration errors;
10. expose progress and individual failure reasons.

A completed research result is not automatically accepted unless it meets the configured safe-apply rule. Initial release should require review for expected dates and conflicts. Exact future dates from authoritative internal or official sources may be bulk-approved from the coverage screen.

## Internal Evidence Recovery

Before web research, inspect:

- future and historical bookings;
- linked emails and subject lines;
- profile notes and activities;
- Google Calendar records;
- ACT-imported opportunities and activities;
- contracts, proposals, invoices, and source documents;
- attendance history;
- existing research runs and saved sources.

The recovery layer must parse only bounded date clues and retain the source record link. It must not treat arbitrary prose as a confirmed future date without identity and year validation.

## Research Provider Contract

Extend the existing provider result with a first-class event-date candidate:

```ts
type EventDateCandidate = {
  startsOn: string;
  endsOn: string | null;
  status: "confirmed" | "expected" | "needs_review";
  recurrenceRule: string | null;
  rationale: string;
  sourceUrls: string[];
};
```

The provider prompt must request:

- exact future dates when published;
- recurrence rules when exact dates are not published;
- no rollover guesses without recurrence evidence;
- date-only ISO values;
- source URLs actually used;
- identity confidence for the matched event.

The service, not the language model, calculates recognized recurrence rules into calendar dates whenever possible.

## Date Lifecycle

When an effective researched date passes:

- it remains in history;
- it is no longer returned as the effective next date;
- the profile becomes stale/missing for coverage purposes;
- it can be queued for the next research cycle.

When a booking is created for the same occurrence:

- the booking becomes the effective source;
- the researched fact remains as evidence;
- no calendar duplication is created.

When a confirmed fact replaces an expected fact:

- the expected fact is superseded, not deleted;
- the profile displays Confirmed;
- the source history remains reviewable.

## Permissions and Safety

- Booking and administrator roles may view effective dates and evidence.
- Only authorized booking/admin users may start research or approve date facts.
- Manager/leg views may see confirmed operational bookings through their existing permissions; researched expected dates remain out of operational views.
- URLs must pass the existing safe-research URL validation.
- External pages are evidence only and cannot supply executable instructions.
- All accepts, dismissals, supersessions, and bulk actions are audited.

## Migration and Backfill

The schema migration creates the date-fact and bulk-job structures without modifying existing bookings.

Initial backfill:

1. mark future bookings as covered through the resolver;
2. inspect internal records for evidence-backed future dates;
3. populate the coverage queue for remaining event profiles;
4. do not synthesize expected dates during migration itself;
5. research and apply dates through the reviewed workflow.

The migration must be idempotent and safe on empty, partially migrated, and live databases.

## Failure Handling

- A failed profile does not stop the rest of a batch.
- Quota/configuration failures pause the batch and explain the reason.
- Stale suggestions are rejected when the profile changed after research.
- Conflicts remain reviewable and never silently replace active facts.
- Invalid or past dates are rejected.
- Start dates after end dates are rejected.
- Duplicate source/date candidates are consolidated.
- UI progress survives refresh.

## Testing

Use test-driven development.

Required automated coverage:

- effective-date precedence and date-only handling;
- cancelled/declined booking exclusion;
- expected dates never entering schedule/map queries;
- historical bookings never being re-dated by research apply;
- recurrence calculations for holiday and numbered-weekday rules;
- insufficient-history cases remain unresolved;
- official published date classification;
- conflicting-source review behavior;
- stale suggestion protection;
- batch resume, deduplication, retry, and partial failure;
- permissions;
- migration idempotency;
- profile-card and At-a-glance labels/ranges;
- coverage counts and filters;
- CSV export;
- empty database behavior.

Verification must include the affected test suites, full repository test command, build, and a live browser check after deployment.

## Success Criteria

- Historical bookings remain unchanged.
- Every qualifying profile appears in exactly one coverage bucket.
- Profiles with future bookings display Booked.
- Official future dates display Confirmed with evidence.
- Supported recurrence dates display Expected with the calculation rule.
- Weak or conflicting evidence remains Needs review.
- Expected dates do not appear on operational calendars, maps, or routes.
- The administrator can research missing profiles in resumable batches and see failures.
- The profile directory, detail page, exports, and Assistant context use the same effective-date resolver.
