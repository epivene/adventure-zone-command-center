# Profile Email, Scheduled Sending, and Attention Badges Design

**Date:** 2026-09-01  
**Repository:** `epivene/adventure-zone-command-center`  
**Status:** Approved in chat; awaiting written-spec review

## Purpose

Extend the existing Google Workspace and profile workflows so office users can draft, send, and schedule Gmail messages from an individual profile. Scheduled messages must send automatically from `theadventurezone12@gmail.com`. Each profile must independently show unread-email and upcoming-follow-up indicators.

## Confirmed Product Decisions

- Email composition starts from a profile only.
- A scheduled message sends automatically at its scheduled time without a second approval.
- An inbound message remains unread until a user explicitly marks it read; merely opening it does not clear the unread state.
- When a profile has unread email and an upcoming follow-up, both indicators appear together.
- A follow-up is upcoming when its due time falls within the next seven days.
- The connected sending mailbox is `theadventurezone12@gmail.com`.

## Recommended Architecture

Use a database-backed application outbox and a dedicated worker. Gmail remains the delivery provider, but the application owns draft and schedule state because Gmail's public API does not expose dependable native schedule-send behavior.

The existing API server exposes authenticated endpoints for profile mail composition, drafts, scheduling, cancellation, message listing, and explicit read-state changes. A worker atomically claims due outbox rows, sends them through the connected Gmail account, and records Gmail message and thread identifiers. The existing inbound Gmail sync associates replies with profiles and maintains application-level unread state.

The worker must run as an independently supervised deployment process rather than relying on an in-process timer in the autoscaled web server. This prevents scale-to-zero, restarts, or multiple web instances from losing or duplicating scheduled work.

## Data Model

### Outbound messages

Persist one record per composed email with:

- profile ID
- author/office-user audit identity when available
- from mailbox, fixed to the configured Adventure Zone Gmail account
- To, Cc, and Bcc recipients
- subject and body content
- state: `draft`, `scheduled`, `sending`, `sent`, `cancelled`, or `failed`
- scheduled delivery timestamp in UTC
- business-timezone identifier captured for display and audit
- immutable idempotency/send key
- Gmail message ID and thread ID after delivery
- attempt count, last attempt timestamp, next retry timestamp, and sanitized failure reason
- created, updated, cancelled, and sent timestamps

Only `draft` and `scheduled` messages may be edited. A scheduled message may be cancelled until a worker successfully claims it for sending.

### Inbound messages and profile association

Store or extend synced Gmail metadata with:

- Gmail message and thread IDs
- sender and recipient addresses
- received timestamp
- matched profile ID, when confidently identified
- application read timestamp and the user who marked it read
- sync timestamps

Matching first uses an existing Gmail thread linked to a sent profile message, then known email addresses belonging to the profile's contacts. Ambiguous or unmatched messages remain in the general Mail inbox for manual assignment. The system must never guess between multiple plausible profiles.

### Follow-up indicator

Derive the follow-up badge from incomplete follow-up activities whose due timestamp is between now and seven days from now, inclusive. Overdue items remain attention-worthy and must also show the indicator until completed or dismissed. The endpoint should return the nearest relevant due item for navigation.

## API and Service Boundaries

Create a Gmail provider interface owned by the server. Production uses the existing connected Google Workspace authorization; tests use a fake implementation.

The profile-mail API supports:

- list messages for a profile
- get profile attention counts
- create/update a draft
- send now through the outbox
- schedule or reschedule a draft
- cancel a scheduled message
- explicitly mark an inbound message read
- assign an unmatched inbound message to a profile

The worker claims messages with a database transaction and row locking or an equivalent atomic lease. It must verify that a message is still due and `scheduled` before sending. The immutable send key prevents a retry from intentionally issuing a second send request; Gmail IDs and final state provide the local delivery audit trail.

Immediate sends use the same outbox pipeline with a due time of now so scheduling, retries, auditing, and error behavior remain consistent.

## User Experience

Each profile includes an **Email** action. The composer opens with the primary contact email prefilled and allows editing recipients, subject, and body. The user may save a draft, send now, or select a date and time for automatic delivery.

Dates and times are entered and displayed in the configured business timezone and converted to UTC at the API boundary. The confirmation view always displays the timezone abbreviation to avoid accidental scheduling in the browser's local timezone.

Scheduled messages show their delivery time and status and remain editable or cancellable until sending begins. Failed messages show a safe, actionable reason and a retry option when appropriate.

The top-right area of each profile displays two independent controls:

- `1 email`, `2 emails`, and so on for unread inbound messages
- `!` when an incomplete follow-up is overdue or due within seven days

Both controls render simultaneously when both conditions apply. Selecting the email badge opens the profile's message list. Opening a message does not change its state; an explicit **Mark read** action clears it. Selecting `!` opens or focuses the nearest relevant follow-up.

## Sync and Refresh Behavior

The existing Gmail sync remains the source of inbound messages. After each sync, profile attention counts are recomputed or invalidated. The frontend periodically refreshes attention data while visible and invalidates it immediately after marking a message read, assigning a message, completing a follow-up, or creating a follow-up.

A delayed sync may delay the badge but must not lose mail. The Google Workspace settings page exposes the last successful inbound sync and outbound worker health.

## Reliability and Error Handling

- Gmail authorization failure pauses sends without discarding queued messages and surfaces a reconnect-required state in Google Workspace settings.
- Temporary network, provider, and rate-limit failures retry with bounded exponential backoff.
- Permanent recipient, authorization, or malformed-message failures transition to `failed` with a sanitized reason.
- Worker leases expire so another worker can recover work after a crash.
- Send attempts and state transitions are auditable.
- Logs must not contain message bodies, access tokens, or full recipient lists.
- Cancellation and worker claiming must be atomic so a user never sees a successful cancellation after delivery has begun.
- The UI must distinguish scheduled, sending, sent, cancelled, retrying, and failed states.

## Security

All mail endpoints use the existing owner or office authorization model and enforce profile-level access consistently with current Office pages. OAuth tokens remain server-side and encrypted or stored through the existing connector mechanism. The API never accepts an arbitrary From address; it verifies the connected mailbox is `theadventurezone12@gmail.com` before enabling delivery.

HTML email content must be sanitized or generated from a constrained editor format. Inbound content must be rendered safely without executing remote scripts. Error responses must not expose OAuth credentials or raw provider payloads.

## Testing Strategy

### Server and database

- draft creation and editing state rules
- send-now and scheduled transitions
- automatic claiming at the due-time boundary
- timezone conversion and daylight-saving transitions
- cancellation versus worker-claim race
- retry/backoff and lease recovery
- idempotency under repeated worker execution
- Gmail authorization and permanent-failure handling
- thread-first and address-based inbound matching
- ambiguous inbound messages remaining unassigned
- explicit mark-read semantics
- unread counts per profile
- follow-up window boundaries, overdue items, and completed items

### Frontend

- composer is reachable from profiles and not exposed as a general new-message action
- primary recipient prefilling and validation
- draft, send-now, schedule, edit, and cancel flows
- timezone shown in scheduling confirmation
- unread count singular/plural labels
- opening mail does not mark it read
- explicit **Mark read** updates the badge
- `!` navigation to the nearest follow-up
- simultaneous rendering of unread and follow-up badges
- accessible names and keyboard operation for both indicators

All automated email tests use a fake Gmail provider and must never contact or send through the real mailbox.

## Rollout and Operations

1. Add schema and API behavior behind a mail-send feature flag.
2. Deploy migrations and the worker with delivery disabled.
3. Verify the connected Gmail mailbox and required send scope.
4. Enable delivery for internal test profiles and confirm Gmail thread linkage.
5. Enable automatic scheduled delivery for normal use.
6. Monitor worker lag, failed sends, authorization health, and inbound sync freshness.

A worker-health alert should fire when the oldest due scheduled message exceeds the normal polling interval by more than a small grace period.

## Acceptance Criteria

- From a profile, an authorized user can save an email draft, send it now, or schedule it.
- A scheduled email is sent automatically from `theadventurezone12@gmail.com` at the selected business-local time.
- A scheduled email can be edited, rescheduled, or cancelled before sending begins.
- Temporary failures retry without duplicate intentional sends; permanent failures are visible.
- Gmail replies are matched to the correct profile when deterministic evidence exists.
- An inbound message counts as unread until explicitly marked read.
- A profile shows the correct unread-email count.
- A profile shows `!` for incomplete overdue follow-ups and follow-ups due within seven days.
- Both indicators appear together and navigate to their corresponding profile sections.
- Unmatched or ambiguous messages remain available for manual profile assignment.
- Automated tests do not send real email.
