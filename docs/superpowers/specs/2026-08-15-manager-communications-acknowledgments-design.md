# Manager Communications, Meetup Requests, and Admin Acknowledgments

## Goal

Add a simple, Slack-like communication layer to the manager portal without making the portal feel busy or complicated. Managers should have one obvious place to communicate, request operational help, and respond to admin changes. Admins should be able to supervise all in-app communication, turn meetup/equipment requests into approved handoffs, and file useful chat attachments into the correct leg records.

The ease-of-use requirement is primary: the system should look simple enough for a first-time manager to understand without training.

## Product principles

1. **One obvious communication hub.** Managers should not have to choose between separate Chat, Requests, Notifications, and Handoffs apps for routine work.
2. **Conversation and operations stay connected.** Structured requests and acknowledgments should appear as cards inside or alongside the relevant conversation instead of becoming disconnected records.
3. **Normal chat stays lightweight.** Messages create unread notifications, not mandatory acknowledgments.
4. **Concrete admin changes stay persistent.** Operational changes affecting a leg remain visibly pending until the manager acknowledges them.
5. **No hidden private messaging.** All in-app messages are visible to admins. The UI should state this clearly.
6. **Admin approval controls route-changing actions.** Managers may propose meetups/equipment swaps, but only admins create or approve the final official handoff.
7. **Never destroy source context.** Filing a chat attachment into a leg record keeps the original message and attachment intact and creates a traceable link to the filed record.

## Recommended architecture

Use a single **Messages / Operations Inbox** as the front door for manager communication. It contains normal conversations plus structured action cards when necessary.

The underlying system should still keep separate domain records for:

- conversations/messages,
- meetup/equipment requests,
- approved equipment handoffs,
- admin change acknowledgments,
- attachment filing links,
- notifications.

This keeps the UI simple while preserving clean data boundaries and audit history.

## Messaging experience

### Conversation types

The portal should support:

- **All Managers** channel.
- **Leg + Admin** channel for each travel leg.
- one-to-one manager/admin conversations.
- one-to-one manager/manager conversations.
- small manager group conversations.

A conversation that looks like a direct message is not private from admins. Managers should see a small, persistent disclosure such as:

> Messages in this app are visible to admins.

Admins can browse/search all channels and conversations.

### Message behavior

Messages support:

- text,
- images,
- PDFs,
- common document/file attachments,
- timestamps and sender identity,
- unread state,
- normal notifications,
- reply/thread context where useful.

Messages do **not** require acknowledgment.

The first release does not need a full Slack clone. Avoid reactions, complex presence indicators, bots, slash commands, or elaborate workspace configuration unless later requested.

### Ease-of-use layout

The manager view should prioritize three things only:

1. conversation list,
2. current conversation,
3. small action area for "New message" and "Request meetup / equipment swap".

On mobile, the conversation list can be a drawer/back screen so the current conversation remains uncluttered.

Unread counts should be simple badges. Avoid separate notification-management screens unless required for admin review workflows.

## Meetup / equipment swap requests

Managers can create a structured request from either:

- Messages, or
- their route/leg operations view.

The manager proposes:

- one or more other legs involved,
- equipment/resource involved,
- preferred meetup location,
- preferred date/time or time window,
- explanation/notes,
- optional attachment(s).

The manager is explicitly **requesting admin action**. The request does not immediately alter either leg's route, calendar, or equipment assignments.

### Admin review

The admin can:

- approve as proposed,
- edit any proposed field before approval,
- ask questions in the linked conversation,
- reject/dismiss the request,
- leave it pending.

Approval should create or update the existing equipment handoff domain record rather than introducing a parallel meetup model. The existing handoff lifecycle already supports suggested/approved/needs-review/dismissed behavior and two-leg resource handoffs.

Once approved, the finalized meetup/handoff becomes an official operational item and appears wherever approved handoffs already belong, including route/calendar views as appropriate.

### Linked discussion

Each meetup request should retain a linked conversation/thread so the managers and admin can discuss location, timing, equipment condition, or alternatives without losing the structured request details.

## Persistent admin-change acknowledgments

### What creates an acknowledgment

When an admin makes a concrete operational change affecting a leg, the system creates an acknowledgment card for the affected manager(s).

Examples include:

- event dates/times,
- route assignments,
- leg assignment,
- approved meetup/handoff,
- equipment/resource assignment,
- crew assignment,
- booking details that materially affect operations,
- settlement/money instructions,
- other concrete admin-controlled operational values.

Normal chat messages, informational notes, and cosmetic/admin-only changes should not create acknowledgment cards.

### Grouping

One admin save/action should produce one grouped acknowledgment card even if that save changed several fields.

Example:

**Admin updated your leg**

- Event changed: Aug 22 -> Aug 23
- Meetup added: Bismarck, 2-4 PM
- Paintball trailer assigned

This prevents notification fatigue and gives the manager one coherent thing to review.

### Persistence

The acknowledgment card remains visible across pages and future logins until acknowledged. It should appear in a small persistent notification area, not as a blocking modal.

The card records:

- affected leg,
- admin actor,
- timestamp,
- grouped change summary,
- before/after values where meaningful,
- manager acknowledgment identity/time,
- manager comment if supplied,
- admin response/resolution if review is requested.

### Manager actions

The manager can:

- **Acknowledge**,
- enter an optional comment,
- **Acknowledge & Send Comment**.

If the manager sends a comment, the acknowledgment enters **Needs admin review** instead of simply disappearing as complete.

Suggested statuses:

- `waiting_acknowledgment`
- `acknowledged`
- `needs_admin_review`
- `resolved`

The manager has still acknowledged seeing the change even when review is requested; the separate review status tracks the unresolved operational concern.

### Admin review loop

When a manager comments on an admin change:

- admin receives a prominent review notification,
- the original grouped change and manager comment are visible together,
- admin can reply,
- admin can modify the underlying operational record if needed,
- admin resolves the review when complete.

The full history remains available for audit/reference.

## Filing chat attachments into leg records

Admins can take a manager-sent attachment and choose **Add to leg...** without downloading and re-uploading it.

Supported filing targets should include at least:

- receipt / expense evidence,
- incident photo,
- equipment / handoff photo,
- general leg document,
- manager or crew note attachment where the existing record type supports attachments.

### Filing behavior

The original chat message and attachment remain unchanged.

The filed record stores provenance linking back to:

- source conversation,
- source message,
- sender,
- original attachment,
- filing admin,
- filing timestamp.

Where the destination record needs additional required metadata, the admin gets a small focused form. Example: filing a receipt may ask for the associated expense/category/amount if those are not already known.

### Sender notification

After filing succeeds, notify the manager who sent it.

Example:

**Receipt filed**
Your photo was added to **Kristy Leg -> Expenses -> Fuel -> Aug 15**.

This is a normal notification, not an acknowledgment requirement.

## Notifications

Keep notifications conceptually simple with three urgency levels even if they share one UI surface:

1. **Unread communication** — chat/messages.
2. **FYI operational notifications** — request updates, attachment filed, admin reply.
3. **Action required** — persistent admin-change acknowledgments and admin review items.

Action-required items should visually stand out and remain until resolved. Ordinary unread notifications can clear when viewed.

## Permissions and visibility

### Managers

Managers can:

- read/write channels they participate in,
- message other managers and admin,
- create small group chats,
- upload attachments,
- submit meetup/equipment requests,
- acknowledge admin changes,
- comment on admin changes.

Managers cannot:

- make another leg's route/equipment change official,
- approve their own meetup/handoff request,
- hide messages from admin,
- delete audit-critical operational history.

### Admins

Admins can:

- view all in-app conversations,
- participate in any conversation,
- search messages,
- review/edit/approve meetup requests,
- file attachments into leg records,
- see acknowledgment status across legs,
- respond to manager comments,
- resolve review items.

## Data boundaries

Prefer separate focused stores/tables/services rather than putting all functionality into one messaging table.

Suggested concepts:

- `manager_conversations`
- `manager_conversation_members`
- `manager_messages`
- `manager_message_attachments`
- `manager_meetup_requests`
- `admin_change_acknowledgments`
- `admin_change_acknowledgment_items`
- `attachment_filing_links`
- `manager_notifications`

Exact schema names may follow existing repository conventions during implementation.

Meetup approval should bridge into the existing `equipment_handoffs` system rather than duplicating its final approved record.

File/blob storage should reuse the existing private object-storage pattern with authorized/signed reads.

## Data flow examples

### Manager requests a trailer swap

1. Manager opens Messages or Route and selects **Request meetup / equipment swap**.
2. Manager selects the other leg, trailer/resource, preferred location/window, and notes.
3. Request is submitted to admin and appears as pending.
4. Linked conversation is available for questions.
5. Admin edits the proposed location/time if necessary.
6. Admin approves.
7. Existing equipment handoff record becomes the official handoff.
8. Affected managers receive a persistent admin-change acknowledgment because their concrete route/equipment plan changed.
9. Managers acknowledge or comment.

### Manager sends a receipt in chat

1. Manager posts a receipt photo to their Leg + Admin channel.
2. Admin opens the attachment menu and chooses **Add to leg... -> Expense receipt**.
3. Admin supplies any missing expense metadata.
4. System files/links the attachment to the expense while retaining the chat original.
5. Manager receives **Receipt filed** notification.

### Admin changes an event date

1. Admin changes a booking/event date affecting Leg A.
2. Save operation records the concrete before/after change.
3. Leg A manager sees a persistent **Admin updated your leg** card.
4. Manager comments "This conflicts with our drive from Billings" and acknowledges.
5. Status becomes **Needs admin review**.
6. Admin receives review notification, responds/adjusts schedule, then resolves.

## Error handling and offline behavior

The manager portal already uses offline mutation/blob queues in some areas. Messaging and request creation should follow the same philosophy where practical:

- clearly show sending/queued/failed states,
- never show a message as successfully sent if the server did not persist it,
- retry attachment uploads safely/idempotently,
- prevent duplicate meetup requests from retrying the same client mutation,
- preserve typed manager comments if a submission fails.

Persistent acknowledgment actions should require server confirmation before disappearing.

If a chat attachment is filed into a leg record and destination creation fails, the source message/attachment must remain untouched and the admin should see a retryable error.

## Audit and retention

Operational communication is business history. Preserve:

- sender/actor identity,
- sent/created times,
- edits if message editing is later enabled,
- request approval/rejection history,
- acknowledgment history,
- attachment filing provenance.

Do not silently rewrite historical messages or acknowledgment entries when an underlying booking changes later.

## UI simplicity guardrails

The implementation should be rejected if it turns the manager portal into a dense project-management tool.

Guardrails:

- one primary **Messages** destination,
- no more than a few primary buttons visible at once,
- structured forms open only when requested,
- advanced admin actions live in context menus/drawers,
- action-required cards use plain language instead of system terminology,
- conversation list favors leg/person names over IDs/status jargon,
- mobile-first layouts,
- avoid exposing database concepts such as handoff statuses to managers unless translated into normal language,
- no separate pages for features that can cleanly live as a card/drawer inside Messages.

## Testing strategy

### Messaging

- admins can see all conversations,
- manager-to-manager messages are not hidden from admin,
- unread counters behave correctly,
- attachments retain sender/conversation provenance,
- failed sends do not appear successfully delivered.

### Meetup requests

- manager proposal does not alter official handoff/route state,
- admin can revise proposal,
- approval creates/updates the existing equipment handoff path,
- affected legs are notified,
- retries are idempotent.

### Acknowledgments

- concrete admin changes create one grouped acknowledgment per save/action,
- acknowledgment persists until server-confirmed,
- comment transitions to needs-admin-review,
- admin resolution retains full history,
- non-operational chat/FYI updates do not create acknowledgment cards.

### Attachment filing

- original chat attachment remains available after filing,
- destination leg record receives the attachment/reference,
- provenance remains traceable,
- sender receives a filing notification,
- filing failures do not damage the source message.

### UX

- manager can reach conversations in one obvious step,
- persistent action cards remain visible without blocking the whole app,
- mobile layouts avoid multi-column overload,
- first-time users can send a message, submit a meetup request, and acknowledge an update without navigating through separate admin-style screens.

## Out of scope for the first implementation

- end-to-end encrypted/private manager DMs,
- voice/video calls,
- Slack-compatible integrations,
- reactions/stickers/GIF systems,
- elaborate presence/typing telemetry,
- external SMS mirroring,
- automatic AI moderation or summarization,
- arbitrary workflow builders.

These can be considered later if real usage shows a need.
