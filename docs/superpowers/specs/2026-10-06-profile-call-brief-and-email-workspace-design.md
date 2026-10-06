# Profiles for live calls and an integrated email workspace

Date: October 6, 2026
Status: Design for owner review; implementation has not started.
Repository: epivene/adventure-zone-command-center
Inspected main commit: af0e43d0653fb3117ae01c2f29a602d47ed47030

## Purpose and approved direction

Desiree needs to answer questions about an event while on a call without navigating long profiles and reading multiple lengthy notes. She also wants to read her email account inside the app, connect conversations directly to profiles, and have that action automatically apply the correct existing Gmail profile label without duplicates.

Success means opening a profile gives useful call context immediately; opening an email provides the same context beside the conversation. The saved profile connection survives Gmail label changes and labeling failures.

## Profile Call Brief

Make the Call Brief the first substantive section beneath a compact profile header. Put general organization information, ratings, administrative work, and operations controls farther down.

Show:
- Contact name, recorded role, phone, event name, and city/state.
- Current relationship or booking state, with the year visible.
- Last actual customer contact: date, direction, and a short readable excerpt or an existing reviewed summary. A recent administrative note must not masquerade as a recent conversation.
- Event dates, package, recorded quote, contract status, and deposit status when available for the selected booking/year.
- Next action, due date, waiting state, and explicit contact holds or cautions.
- Short recent history with expandable originals and links to the source email or note.

Keep Emails, History, Documents, and Add Call Note within one tap. Provide quick profile lookup by event, contact, email, phone, or city, preserving the search when returning.

Use recorded facts and source links. Do not infer a quote from current package prices, equate a proposed date with a confirmed booking, or treat missing booking fields as open availability. Unknown, stale, and conflicting information must be visibly distinguishable. Preserve existing notes and full history.

Reuse the existing call-briefing and profile presentation components where their data fits. Do not generate summaries through a paid model on each profile load. Show concise excerpts and already reviewed summaries initially. Offer source expansion where reliable short context is unavailable.

Desktop: compact cards, with critical cautions above expandable content.
Phone and Fold: one column, readable labels, no horizontal scrolling, and brief actions that remain easy to reach.

## Emails workspace

Add an Emails entry to the main owner navigation with Inbox, Sent, Drafts, and mailbox Search. This is an app email interface backed by Gmail APIs, using the existing connected business account.

Display the account identity and connection/sync status. Retrieve pages of mailbox conversations on demand; loading an inbox must not import the entire account into CRM or invoke the app assistant.

Desktop: conversation list, message reader, and linked-profile Call Brief.
Phone: list then reader, with a compact profile button or panel; preserve folder, search, and scroll position when returning.

Support full conversations, safe readable HTML/text, attachments, collapsible quoted replies, refresh, and clear errors. Show Inbox, unread/read, and draft/sent states accurately. Unlinked conversations remain visible and searchable.

Provide compose and reply with saved drafts and explicit Send. Reuse approved promotional templates and existing draft/reply delivery services rather than create another independent delivery path. Preserve recipient, subject, thread identity, and draft content after failures. Prevent repeated clicks or timeouts from causing duplicate sends. Assistant preparation never grants permission to send or schedule.

Keep Open in Gmail available as a fallback. Clearly identify a saved copy and its timestamp when live Gmail is unavailable; never present it as freshly synchronized.

## Link to profile and automatic Gmail labeling

The user chooses a profile through a searchable picker. Show the selected event and location before applying. Suggested matches are suggestions; ambiguous matches must not silently file mail.

Save the association for the connected account and Gmail conversation identity in the app. Extend/reuse the existing approved mappings and thread-intent infrastructure; do not create a competing source of truth.

After committing the association, enqueue applying the profile label:
1. Reuse the exact account-scoped mapped Gmail label ID.
2. Verify the label still exists and belongs to the selected profile.
3. If mapping is missing, stale, or conflicting, keep the link and show a repair state. Do not silently create, rename, merge, or duplicate labels.
4. Repeated linking to the same profile returns the existing result without duplicate associations, audit activity, labels, or queued operations.
5. Reassigning an already linked conversation requires an explicit change-profile action and supersedes stale pending operations. Preserve the reassignment history.
6. Show separate outcomes: profile linked; label applied, pending, or needs attention.

Link to profile leaves INBOX unchanged. Archive is a separate explicit action. The existing assignment service can remove INBOX, so the new link workflow must carry a durable preserve-inbox intent through enqueue, retry, and reconciliation. Keep legacy filing behavior compatible for workflows that explicitly request archival; do not change it globally by accident.

Profile email views retrieve saved associations first. Label reconciliation may recover historical links as a compatibility fallback but must not be required to load an established association. New replies in an already linked Gmail thread inherit its saved profile association. A new thread receives a suggestion unless an existing verified matching rule safely applies.

## Integration and migration

Existing foundations inspected:
- google-profile-assignment-transaction.ts commits approved mappings and account/thread intent.
- google-profile-label-sync-service.ts executes Gmail label mutations and includes INBOX removal.
- google-profile-label-resolver.ts currently can create labels; the new action needs a reuse-only resolution path.
- google-workspace-profile-email.ts lists mapped conversations, with label recovery and saved conversation support.
- call-briefing.ts and profile-at-a-glance.tsx provide existing profile/call presentation foundations.

Retain existing profile mappings, archived messages, attachments, templates, and history. Reconcile existing account/thread associations deterministically; conflicting historical ownership goes to review rather than an arbitrary migration choice. Any schema change must be idempotent and preserve existing records.

Use existing role/access checks and Google authorization. Do not change permissions or consent silently. If the current connection cannot read the full mailbox, show a specific reconnection requirement rather than an empty inbox. Keep broader owner mailbox access separate from connector/profile-limited access.

## Verification and delivery

Tests must cover account isolation, unlinked inbox visibility, paging/search, missing authorization, saved-copy status, link without a label, duplicate/concurrent linking, stale or conflicting mappings, label failures, preserved INBOX on retries, reassignment with pending old work, and later replies on a linked thread.

Verify Call Brief year selection, unknown/conflicting dates, distinction between administrative notes and actual contact, and no fabricated quote or availability. Validate the desktop, phone, and Fold layouts.

Verify draft preservation and duplicate-send protection using test doubles or a dedicated test environment; no live customer send is needed for validation.

Deliver in an isolated branch and reviewable pull request with focused checks and screenshots. Do not merge or deploy merely to verify design. Implementation will follow the reviewed specification and implementation plan.
