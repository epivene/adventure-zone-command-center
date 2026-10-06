# Unified booking workspace design
Date: 2026-10-06
Status: Draft for user review
Baseline: merged PR #1006, main d376f2152700bab3c59d118ae7e4da394fbd1fea

## Purpose and agreed direction
Desiree needs to answer profile questions during calls quickly and handle email and booking work without hunting through separate screens. The home screen is Today, with small groups rather than a mixed feed. Email layout also needs improvement. Success means an incoming question, reply, or review opens with the relevant conversation and profile context, with fewer navigation decisions.

The proposed structure below completes those choices. It is a reviewable design, not an implemented change.

## Navigation
Use four primary booking destinations: Today, Profiles, Emails, and Schedule & Routes. On narrow screens, shorten the last label to Schedule. Keep More for secondary tools. Put assistant/COM access within the relevant workspace and More rather than occupying a primary mobile slot.

Retain operations, marketing, administrative tools, imports, settings, and their permissions through More and existing workspace switching. Preserve existing deep links. The old Email Review route should open the Needs review view within Emails, preserving record identifiers and return navigation.

## Today
Show three compact groups in this order:
- Replies: inbound conversations needing a reply, drafts requiring review, and email items requiring a filing/linking decision.
- Calls & Follow-ups: explicit callbacks, scheduled calls, and due follow-ups.
- Booking Work: paperwork, booking details, research, new outreach, and cleanup.

Each group initially shows up to five items and a count, with Show all expanding the group in place. Empty groups show a short empty state without a large blank card. Within each group, preserve existing pinned/manual ordering; then rank remaining items by urgency and due date.

Each row shows the event/profile, action, reason, and due information. Selecting it opens the actual task with its conversation or profile context. A review decision takes precedence over a draft, which takes precedence over a reply when the same source represents one action. Distinct actions for one event remain distinct. Deduplication uses source/task identity, not the event name.

Waiting, later items, COM work in progress, and completed items are collapsed below active work. Waiting items with a new inbound reply return to active work. Outbound mail, automated replies, and bounces must not create a customer-reply task. Missing data and blockers remain visible; an overdue item alone does not become a scheduled call.

These are display groups over existing task data, not new copies of the business queues. Keep the existing outreach, active booking, returning event, paperwork, and route workflows.

## Emails: layout and workflow
Emails is one conversation workspace. Its toolbar contains the connected account, search, Compose, and compact views: Inbox, Sent, Drafts, Needs review, Needs your reply, and Waiting. Avoid a second page-sized review dashboard above the mailbox.

At wide desktop sizes use a message list and reading pane, with an optional profile panel. The reading pane gets the largest share of width. Default the profile panel closed when the layout cannot comfortably fit all three. At intermediate widths use list and reader, with profile details in a drawer. On narrow/Fold closed screens show one view at a time: list, conversation, or profile details. Back returns to the previous view, preserving search, filter, selection, and list scroll.

Rows use a consistent hierarchy: sender/event, subject, one-line preview, date, and a small status indicator. Highlight unread and selected messages without oversized cards. Keep one stable conversation action bar; put uncommon actions in an overflow menu. Limit decorative badges and repeated headings. Use existing app typography/colors with consistent spacing, subtle separators, readable line lengths, and accessible tap targets.

The reader shows the full thread, participants, attachments, linked profile, and the next action. Keep Link to profile, attention state, and Archive distinct. Linking reuses the existing mapped Profiles label without duplicates and preserves Inbox. Archive is an explicit action.

Needs review renders existing review records within the same workspace. Resolve/link decisions update the original review item; preserve current attention state unless the user changes it. Reconcile related thread review items through the existing service behavior, avoiding duplicate history. Keep any existing review action that archives explicitly labeled as archiving.

Compose follows the existing saved-draft and explicit-send workflow. Show To/Cc/Bcc and attachments for review, preserve approved HTML templates and saved MIME, and retain the durable send ledger. Navigating, linking, reviewing, or changing status never implicitly sends.

Use Needs Attention as the canonical attention label. The empty legacy Action Needed label is left for Desiree to remove.

## Profiles and Schedule
Profiles open with a compact call brief: contact, event/year, location, current status, package/pricing with source, and next action. Booking details, paperwork, and one consolidated activity history follow below. Conversations open in the same profile context and return to their original list.

Schedule & Routes groups the existing calendar, legs, maps, and capacity tools. Missing verified dates or assignments are shown as unknown, not available capacity. Preserve current route planner rollout flags and configuration prerequisites.

## COM and state boundaries
Native UI and future COM actions must use the same account/thread/profile identity and saved attention state. Separate verified linking, attention updates, and explicit archiving. Preserve existing documented COM filing semantics until a separately reviewed API change is implemented; do not silently change a filing tool that currently archives. This redesign does not expand COM authority or enable autonomous sending.

Use existing mailbox, review, master work, and profile services as sources of truth. View adapters provide presentation and grouping. Shared conversation context owns selection and return state; it must not create duplicate tasks, mailbox records, or profile history.

## Errors and rollout
Show errors in the affected pane with retry. Preserve the selected thread, draft, and filters; never replace an account error with a misleading empty inbox. Enforce existing access permissions on every destination.

Deliver the interface in stages: unified navigation and Emails, Today groups, then profile context and Schedule grouping. Keep old routes usable throughout. COM API parity and route-planner activation remain separate follow-ups with their own compatibility/configuration checks.

## Acceptance checks
- Today is home with the three agreed groups and no duplicate representation of one action.
- Inbox, review, draft, and profile context work within Emails, with stable back/scroll behavior.
- Desktop, Fold open, and Fold closed layouts remain readable without horizontal overflow; controls work by keyboard and have visible focus.
- Linking reuses labels and preserves Inbox; archive and send happen only through their explicit actions.
- Existing native email regressions, account isolation, saved-template/send behavior, permissions, and deep links remain intact.
- Call facts remain easy to find, and all existing secondary tools remain accessible.

Self-review: scope is presentation/navigation using existing services; no placeholders, new mailbox backend, task schema migration, or implicit route/COM activation.
