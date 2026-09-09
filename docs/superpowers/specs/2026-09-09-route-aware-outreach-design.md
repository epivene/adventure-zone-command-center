# Route-aware outreach and lead discovery

Date: 2026-09-09
Status: Overall product direction approved in conversation; detailed design ready for review. No application behavior changed by this document.

## Goal

Extend Booking → Today so Desiree knows which convention lead, follow-up, strong prospect, or filler to work next, based on the route and real package capacity. Research should target gaps that can actually be filled. Every action remains linked to the event profile and event-year opportunity.

## Existing code reviewed

- artifacts/api-server/src/features/today/master-work-queue.ts: existing replies, callbacks, urgency, manual ordering, snooze, and completed-today behavior.
- lib/db/src/booking-opportunity-schema.ts: opportunity status, priority, next action, protected email and territory rules; unique organization/year constraint.
- artifacts/api-server/src/features/lead-intake/package-availability.ts: configured capacity, temporary unavailable quantities, ambiguous reservations, restricted package options.
- artifacts/api-server/src/features/opportunity-email/opportunity-email-availability.ts: Google Calendar evidence and package availability for email context.
- artifacts/api-server/src/features/bookings/booking-repository.ts: bookings, legs, package selections, physical resource assignments, follow-ups, and audit history.
- artifacts/api-server/src/features/boss-work-requests/convention-apply-service.ts: convention submissions applied to profiles, notes, and optional follow-ups.
- docs/superpowers/specs/2026-08-26-booking-master-work-queue-design.md: established single-workspace architecture. Its historical inventory/pricing examples are not a fresh inventory verification.

The inspected queue ranks task urgency but does not encode the proposed competition between prospects for route openings. Package availability alone does not establish that a leg can travel to an event.

## Approach

Extend the existing opportunity and Today systems with route-opening candidates, a deterministic outreach policy, and a shared availability evaluation. A separate sales CRM would duplicate history and work queues. Merely adding priority labels would not control competing offers or shared equipment.

Deliver as three integrated increments:
1. Ranked outreach, timing, and gap research using existing profile/opportunity history.
2. Shared capacity checks and expiring holds enforced at every booking/offer entry point.
3. Calendar, email, convention, and booking refresh integration with actionable conflict alerts.

Increment 1 must label capacity as unverified until increment 2 is fully enforced. It must not claim to prevent overbooking by itself.

## Route openings and capacity

A route opening describes a leg, season/year, available operational window, adjacent route stops, and candidate events. It is a planning object, not a second booking calendar.

Evaluate candidate event dates with setup, teardown, configured buffers, travel from the prior stop, and travel to the next stop. Use the app's existing operational window rules; do not hardcode a new buffer that disagrees with the schedule.

Read active legs and package quantities from configuration. The user reports nine legs; do not invent their assignments or infer package quantities from leg count. Include maintenance/unavailable resources and shared equipment transfers.

Return one of: fits, conflict, or needs review, with reason and source timestamps. Missing dates, location, package demand, or schedule evidence is needs review, never available.

Reconcile canonical CRM bookings and mirrored calendar events without double-counting. Calendar-only commitments must still count. Ambiguous duplicate evidence requires review. Candidate bookings must not count against themselves on reevaluation.

Candidates in different openings can still compete for the same physical resources. Capacity is checked across overlapping operational windows globally, not independently per opening. Package quantity calculations must preserve the date intervals; nonoverlapping reservations must not be summed as if simultaneous.

## Priority and eligibility

Protected bookings remain committed. Dedicated returning events receive a renewal/decision task and explicit review date. Historic attendance alone must not reserve capacity forever. A dedicated planning reservation needs specific dates and capacity; uncertain dates remain visible as a planning concern.

For each feasible opening, the pursuit order is:
1. Convention leads.
2. Strong prospects.
3. Fillers.

Tier is separate from urgent/high/normal task priority. Use explicit convention attribution, source submission, or manual classification, not a name keyword. Keep existing do-not-contact, decline, territory, and protected-record checks. Convention priority does not bypass those rules.

Within a tier, use recorded interest, verified route fit, decision deadline, and manual rank. Show the reason. Do not manufacture revenue or attendance scores. An event with other inflatables may qualify as a replacement opportunity; record that adjacent competing inflatables are not acceptable.

Default to one active first-choice pursuit per actually allocatable opening. Independent openings may proceed together only when they do not double-use scarce resources. Existing concurrent conversations remain visible for review; do not silently cancel them. Deferred candidates show what they are waiting for.

## Outreach timing

Configurable initial defaults:
- First contact: day 0.
- First no-response follow-up: day 7.
- Second attempt: day 14, with phone suggested where suitable.
- Advance to the next candidate: day 21, if attempts were actually completed and no meaningful reply or explicit decision date intervened.
- Convention first follow-up: within two business days after the convention ends, unless an earlier promise was recorded.

Days 7/14/21 are elapsed calendar days from the actual first successful send or logged outreach attempt. Schedule routine actions using existing business-time rules and the configured business timezone. A draft, scheduled-but-unsent message, or failed send does not start the sequence.

Never advance solely because an unworked task became overdue. If the latest attempt was delayed, allow at least seven calendar days after that attempt before advancing. Show overdue work in Today.

A meaningful reply or logged conversation pauses the generic no-response sequence and creates a specific next action. An out-of-office reply can suggest a later date; a bounce creates contact-repair work. Neither counts as expressed interest.

Explicit callback/board-meeting dates and manually scheduled follow-ups are respected. No duplicate follow-ups for the same opportunity and action. Interested leads without a decision date get a task to agree on one.

For events within 45 days of the operational start, show an urgent timeline-review task; an owner can choose shorter intervals. Do not silently compress a waiting period or promote fillers because a date was guessed.

Advancing means the next candidate becomes ready for the user's next action. It sends no email and deletes no prior lead. Late replies reopen attention with a fresh availability check.

## Contact versus commitments

Contacted and interested are conversation states; neither reserves equipment.

Temporary holds require exact operational dates, leg, package quantities, applicable shared resources, owner, and explicit expiration. They consume capacity until released, expired, or converted to a booking. There is no implicit permanent hold.

Confirmed booking uses existing authoritative contract/deposit rules, not an email sentiment guess. Conversion from hold to booking must not double-count capacity.

Creating/extending a hold or confirming a booking must check and allocate atomically under database locking/transaction rules for the relevant overlapping capacity. Two simultaneous requests for the last unit cannot both succeed.

A customer-specific availability offer must be linked to a valid allocation/hold and its expiry; otherwise wording remains exploratory and subject to availability. Recheck before send, including scheduled dispatch. General introductions remain possible when clearly exploratory. Changed evidence pauses a stale specific offer and surfaces the conflict.

Do not depend on free-text phrase detection as the sole enforcement mechanism. Store whether a draft makes a specific availability offer and the reservation it relies on. External/manual promises can be recorded for review; the app cannot prevent promises made outside it.

## Lead discovery

Each route gap has a Find leads action using year, dates, available packages, adjacent stops, geography, and fit requirements. Initially, a research task contains those criteria and accepts verified results; unattended web research is not implied.

Check existing profiles, current-year opportunities, notes, and outreach before creating anything. Save source URL, verification date, event date confidence, contact evidence, route fit, tier, and next action.

Suggested initial research target: three qualified backups per open allocation, configurable. Missing facts do not count as qualified. Filling or closing an opening pauses new research for that gap while preserving results.

Past events can become next-year prospects, with future dates explicitly unverified until checked. Match to permanent profiles. The current organization/year uniqueness constraint means multiple separate same-year events under one organization require identity review; do not collapse them into a single pursuit or silently invent duplicate organizations.

## Today and profile experience

Keep existing Needs Attention first: replies, promised callbacks, active booking decisions, expiring holds, and conflicts. Convention priority governs eligible outreach work, not neglect of an existing promise.

Add compact views within Booking:
- Contact next.
- Waiting / follow-ups.
- Route openings and backups.
- Find more leads.
- Needs review.

Rows show event/year, tier, next action/date, leg/opening, package fit, last real contact, waiting reason, and next candidate when applicable. Open the full existing profile and preserve Back to Today behavior. Use touch-friendly cards on mobile.

Allow classification, rank, snooze, and decision-date edits with audit reasons. Pinning changes work order, not capacity or contact restrictions. Reuse existing role permissions; do not grant leg managers full sales-history access.

## Data and service boundaries

Add additive, versioned tables/fields for outreach tier/source, opening membership/rank, sequence evidence, dedicated review dates, resource holds, research criteria, and evaluation provenance. Reference existing opportunities, bookings, follow-ups, activities, package configuration, and legs.

A pure policy module computes eligibility, next action, and reasons from explicit inputs and an injected clock. It sends nothing.

A capacity service reconciles commitments and supplies fit/conflict/review evidence. A transactional allocation service owns holds and booking commitment enforcement.

An orchestration adapter consumes actual sent-mail/call/reply events idempotently, links one follow-up per sequence step, and refreshes affected opening candidates. A Today adapter exposes results through existing queue contracts.

Use source-event identifiers and unique constraints to prevent retries creating duplicate tasks or allocations. Preserve manual due dates and existing priority choices. Unknown historic tiers remain unclassified for review rather than being bulk relabeled.

## Errors and rollout

Unavailable or stale calendar/equipment evidence produces needs review. Preserve draft and sequence state on failures. Holds remain governed by stored expiry; a failed refresh must not silently release them early.

New functionality starts behind a feature flag. Review current configuration and a sample of real openings before enabling commitment enforcement. No bulk outreach or reassignment is part of this change.

The Early Bird promo deadline and reminder remain independent of no-response sequencing. Preserve the existing expressed-interest/deposit conditions; a 21-day advancement must not rewrite a promised promo date.

## Required verification

- Convention prospect outranks strong lead and filler for the same feasible opening.
- Replies, promised callbacks, and hold decisions remain visible ahead of routine outreach.
- Separate legs competing for the last package cannot both allocate it.
- Travel and buffers rule out a nominally free event date.
- Duplicate calendar/CRM commitments count once; ambiguous and missing data never become available.
- Interval-aware calculation handles staggered bookings without false capacity exhaustion.
- Two concurrent hold requests for the last resource result in one success.
- Hold expiry, extension, release, and booking conversion preserve quantities and history.
- Failed/scheduled-only sends do not start outreach timers.
- Missing follow-up attempts prevent automatic advancement.
- Replies and explicit dates pause generic sequencing; late replies force reevaluation.
- Retry/replay creates no duplicate task, profile, or allocation.
- Same-year event identity ambiguity becomes review.
- Mobile profile navigation, manual ranking, and existing permissions remain intact.
- Existing Early Bird reminder conditions are preserved.

## Review summary

The proposed daily workflow is: protect real commitments, work convention opportunities first where capacity fits, follow a visible contact cadence, advance deliberately to strong prospects and fillers, and research the remaining gaps. No outgoing messages are sent by accepting or storing this design.

