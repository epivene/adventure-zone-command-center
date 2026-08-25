# Scout Alerts Design

## Goal

Extend the approved Scout workflow so profiles created from Scout Results continue to be monitored for meaningful public changes after they enter Command Center.

Scout Alerts must keep the user informed without silently changing CRM records. Alerts live inside the app, appear on the owner Today screen, and preserve source evidence. Calls and overdue follow-ups remain the highest-priority Today work.

## Approved user experience

When a Scout Result becomes a real Command Center profile, Scout monitoring starts automatically for that saved result.

The owner Today screen gains a **Scout Alerts** section under **My Work**, after Calls/Contracts and before general “Needs a decision” items. The section shows only active alerts whose snooze period has ended.

Each alert shows:

- the profile/event name,
- a plain-language explanation of what changed or became urgent,
- severity,
- when Scout detected it,
- relevant old and new values when applicable,
- bounded source links and confidence,
- **Open profile**,
- **Snooze 1 week**,
- **Dismiss**.

Dismissal closes that specific alert; it does not disable monitoring. Snoozing hides only that alert until its snooze date. Opening a profile does not automatically mark the alert complete.

No alert action automatically changes event dates, contacts, booking status, notes, or follow-ups. The profile and Scout Notes remain the review surface for deciding what to do next.

## Scope

### In scope

Scout monitors only profiles created from saved Scout Results. It evaluates:

1. **Application opened**
   - A reliable official/vendor source now exposes a vendor, exhibitor, entertainment, or attraction application path when none was previously known.

2. **Application deadline approaching**
   - A known deadline crosses the 30-day, 14-day, 7-day, or 1-day threshold.
   - Each threshold is separately deduplicated.

3. **Dates announced**
   - Previously unknown event dates become available from reliable sources.

4. **Dates changed**
   - Reliable current dates differ from the last monitored snapshot.

5. **Organizer contact changed**
   - A reliable organizer name, email, or phone changes.

6. **Important information still needs verification**
   - On initial monitoring setup, Scout creates one grouped alert when critical gaps remain, such as missing dates, no organizer contact, no participation path, or unresolved power/space/insurance requirements.
   - Ordinary low-value research gaps do not each create their own alert.

7. **Monitoring problem**
   - Three consecutive external recheck failures create one low-severity alert.
   - A later successful check resolves the monitoring-problem alert automatically.

### Out of scope for this release

- Email, text-message, browser-push, or mobile-push delivery.
- Monitoring every existing CRM profile.
- Automatic edits to CRM fields.
- Automatic follow-up creation.
- Exhaustive private/login-only social-media monitoring.
- A general-purpose notification center separate from Today.
- User-configurable alert thresholds.

## Architecture

### Chosen approach: durable watches plus persistent alerts

Scout Alerts use two new database tables and a dedicated background worker loop.

This is preferred over deriving alerts only when Today loads because changes must be detected even when nobody has the page open. It is preferred over reusing ordinary follow-ups because alerts are evidence-backed observations, not promised customer actions. It is preferred over storing alert state in activities because alerts need independent open/snoozed/dismissed/resolved lifecycle state.

The implementation reuses:

- saved `lead_scout_candidates` as the monitored Scout identity,
- the existing Lead Scout provider’s bounded candidate-enrichment API,
- existing source/evidence reliability rules,
- the server’s established durable worker-loop pattern,
- the Today route’s existing aggregation model,
- the Today UI’s existing snooze/dismiss interaction style.

## Data model

### `scout_alert_watches`

One watch exists per saved Scout candidate.

Fields:

- `id uuid primary key`
- `candidate_id uuid unique not null references lead_scout_candidates(id)`
- `actor_id text not null`
- `organization_id uuid not null references organizations(id)`
- `booking_id uuid references bookings(id)`
- `status text not null`: `active | paused | complete`
- `snapshot jsonb`
- `next_evaluation_at timestamptz not null`
- `next_research_at timestamptz not null`
- `last_evaluated_at timestamptz`
- `last_researched_at timestamptz`
- `last_error text`
- `failure_count integer not null default 0`
- `worker_id text`
- `lease_expires_at timestamptz`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

A watch is created atomically when the saved candidate is linked to its new Command Center organization and booking.

### `scout_alerts`

Fields:

- `id uuid primary key`
- `watch_id uuid not null references scout_alert_watches(id) on delete cascade`
- `organization_id uuid not null references organizations(id)`
- `booking_id uuid references bookings(id)`
- `kind text not null`
- `severity text not null`: `info | attention | urgent`
- `title text not null`
- `body text not null`
- `before_value jsonb`
- `after_value jsonb`
- `sources jsonb not null default '[]'`
- `confidence text`: `high | medium | low`
- `fingerprint text not null unique`
- `status text not null`: `open | snoozed | dismissed | resolved`
- `due_at timestamptz`
- `snoozed_until timestamptz`
- `detected_at timestamptz not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Fingerprints make alert generation idempotent. Repeated worker runs cannot produce duplicate alerts for the same change or deadline threshold.

## Monitored snapshot

The watch snapshot stores only normalized structured values needed for comparison:

```ts
type ScoutAlertSnapshot = {
  startsAt: string | null;
  endsAt: string | null;
  applicationAvailable: boolean;
  applicationUrl: string | null;
  applicationDeadline: string | null;
  organizerName: string | null;
  organizerEmail: string | null;
  organizerPhone: string | null;
  coverageGaps: string[];
  sources: ScoutAlertSource[];
  capturedAt: string;
};
```

The snapshot does not store complete scraped pages, hidden model reasoning, or social-media content dumps.

## Evidence rules

Hard-field change alerts require operationally reliable evidence. Official event pages, organizer/vendor materials, government, tourism/chamber, venue, and similarly strong sources may support these changes.

Public social/review evidence may support qualitative context but cannot by itself trigger date, deadline, organizer-contact, or application-open alerts.

Source references are limited to URL, title, publisher, category, retrieval time, and confidence. Only HTTP/HTTPS links are returned to the UI.

## Monitoring schedule and cost controls

The worker performs two kinds of work:

### Daily local evaluation

Every active watch is evaluated once per business day using its last snapshot. This creates deadline-threshold alerts and initial critical-gap alerts without calling the external provider.

### External research refresh

- Normal cadence: once every 7 days.
- Near-term cadence: once every 24 hours when a known deadline is within 30 days or the event starts within 60 days.
- First refresh after profile creation: 7 days after the original Scout research, because the saved candidate was just researched.
- One watch is processed per worker step.
- One bounded provider enrichment call is allowed per due watch.
- Known source references are capped before provider calls.

The watch automatically becomes `complete` when the linked booking is completed, cancelled, or declined, or when the event ended more than 14 days ago. Open alerts are resolved when the watch completes.

## Worker flow

1. Claim one due active watch using `FOR UPDATE SKIP LOCKED` and a lease.
2. Load the linked candidate, run criteria, facts, sources, organization, booking, and primary organizer contact.
3. Build or load the previous normalized snapshot.
4. Run daily local alert evaluation.
5. If external research is due, call `LeadScoutProvider.enrichCandidate` with bounded known sources.
6. Select reliable evidence using the existing Lead Scout evidence hierarchy.
7. Build the new snapshot.
8. Compare snapshots and generate idempotent alert drafts.
9. Persist alerts and the new snapshot transactionally.
10. Reset failure state and schedule the next evaluation/research.

On provider failure, the watch stores a bounded safe error summary and uses exponential backoff: 6 hours, 12 hours, 24 hours, then a maximum of 7 days. Three consecutive failures create one monitoring-problem alert.

## API

### Today load

`GET /today` includes:

```ts
scoutAlerts: ScoutAlertView[];
scoutAlertTotal: number;
scoutUrgentAlertTotal: number;
```

Only `open` alerts and `snoozed` alerts whose snooze time has elapsed are included.

### Alert actions

- `POST /today/scout-alerts/:alertId/snooze`
  - body: `{ until: string }`
  - validates the timestamp and sets `status='snoozed'`.

- `POST /today/scout-alerts/:alertId/dismiss`
  - sets `status='dismissed'`.

Both endpoints are owner-authenticated through the existing Today route protection and return a safe not-found response for unknown alert IDs.

## Today UI

A focused `ScoutAlertsSection` component keeps TodayPage from growing further.

Behavior:

- Hidden when there are no visible alerts.
- Summary: `Scout Alerts (N)` plus urgent count when present.
- Automatically expanded when an urgent alert exists; otherwise collapsed.
- Alerts ordered by severity, due date, then detection time.
- Deadline alerts show the due date.
- Change alerts show concise old/new values.
- Source links open in a new tab.
- Successful Snooze or Dismiss removes the alert from the current Today view immediately.
- Failure leaves the alert visible and shows an inline error.

Scout Alerts do not outrank overdue calls in the Start Here focus calculation in this release.

## Error handling and safety

- Provider failures never block `/today`.
- Alert loading failure is logged and returns an empty Scout alert collection, preserving the rest of Today.
- Invalid/malformed snapshot fields fail closed and do not trigger hard-field changes.
- Alert text and source metadata are bounded before persistence.
- No background operation writes to organization, booking, contact, follow-up, or Scout Notes fields.
- Duplicate and stale worker execution is controlled through leases and unique fingerprints.

## Testing

Tests are written first for each behavior:

1. Alert classifier:
   - dates announced,
   - dates changed,
   - application opened,
   - organizer contact changed,
   - 30/14/7/1-day deadline thresholds,
   - critical-gap grouping,
   - weak social evidence ignored,
   - stable snapshots produce no alert.

2. Watch lifecycle:
   - saved candidate activates one watch,
   - duplicate saves do not create duplicate watches,
   - final booking status completes the watch,
   - failed research backoff and recovery.

3. Worker:
   - lease claim,
   - local-only daily evaluation,
   - bounded provider refresh,
   - idempotent alert persistence,
   - failure alert after three attempts.

4. Today API:
   - visible alert filtering,
   - expired snoozes reappear,
   - snooze and dismiss actions.

5. Today UI:
   - Scout Alerts section placement and counts,
   - urgent expansion,
   - Open profile/source links,
   - immediate Snooze/Dismiss removal,
   - inline action failure.

6. Startup and shutdown:
   - additive schema guard,
   - worker loop starts once and closes cleanly.

## Release boundary

This release is complete when a newly created Scout profile automatically receives a watch, meaningful change/deadline alerts are durably generated, and the owner can review, snooze, dismiss, and open them from Today without any automatic CRM edits.