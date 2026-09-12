# Profile Email Studio Delivery and Palette Alignment

**Date:** 2026-09-12
**Repository:** `epivene/adventure-zone-command-center`
**Status:** Approved 2026-09-12

## Purpose

Finish the event-profile redesign by matching the supplied decision-workspace mockup more closely and making email a first-class profile action. From the selected profile panel, an authorized user must be able to review recent email activity and start a profile-linked HTML draft that can be saved in the app, created in Gmail Drafts, scheduled, or sent.

The implementation must use the existing Design Studio editor, profile email records, Google Workspace connection, outreach safety checks, and profile history. It must not create a second disconnected email system or represent a Design Studio output as a Gmail draft unless Gmail actually created it.

## Confirmed Product Decisions

- The compact profile list keeps review stars as secondary gold context beneath the location.
- The selected profile remains beside the list on desktop and uses the existing sheet on mobile.
- Colors follow the supplied mockup palette rather than introducing another theme.
- Beneath the profile's note and action controls, show the primary email address, the three most recent email conversations, current draft statuses, and a **New Draft** button.
- New Draft opens the existing drag-and-drop HTML email maker with the profile and primary contact already linked.
- The editor offers four real outcomes: **Save in app**, **Create Gmail Draft**, **Schedule**, and **Send Now**.
- A profile without an active contact email shows the email area and a disabled New Draft button with the explanation **Add a contact email first**.
- Sending or scheduling continues to use the app's exact-content outreach review requirement when that feature is enabled.

## Visual Alignment

Use the mockup's exact core palette:

| Purpose | Color |
| --- | --- |
| Page paper | `#f6f2e9` |
| Cards and detail | `#fffefa` |
| Primary ink | `#182225` |
| Muted text | `#536064` |
| Dividers | `#d8d1c4` |
| Urgent/accent | `#e85d35` |
| Dark urgent text | `#bc3e20` |
| Opportunity/reviews | `#efb33f` |
| Positive/contact | `#157d78` |
| Booked/success | `#32765a` |
| Warning text | `#a63f35` |

Active quick-filter chips use charcoal with white text and retain their small category-colored dots. Contacted status uses teal, booked uses green, deadline and follow-up urgency use orange/red, and waiting remains neutral. Review stars remain gold.

The desktop detail header changes from a solid dark bar to the mockup's light paper treatment with dark text, an orange eyebrow/accent, and a restrained peach edge. Do not use a gradient. Keep the dark deal-model band because it is the mockup's intentional money-focused contrast.

The profile workspace retains compact six-pixel-radius cards, the orange selected edge, cream list background, visible keyboard focus, and one-column mobile reflow.

## Profile Email Area

Add a compact `ProfileEmailSummary` below the existing Add Note/Profile Actions row in the reusable profile detail component.

In the inline desktop panel, the action row and email summary belong to the same scroll flow: the current sticky action treatment must not cover or separate the email summary. In the mobile sheet, keep the actions easy to reach while allowing the email summary to stack beneath them without a nested horizontal scroller.

It shows:

1. **Email** heading and primary recipient address.
2. A prominent **New Draft** button.
3. Up to three most recent Gmail conversations already linked to the profile, ordered by the existing Google Workspace profile-email source's most-recent timestamp.
4. Active app drafts linked to the same organization, and their truthful states: saved, Gmail draft, scheduled, needs changes, or failed.
5. Links to open the full profile Emails section when more history exists.

Extend the existing shared Gmail profile panel with a compact variant or extract its existing query into a shared hook. Do not duplicate Gmail fetching or matching logic. Opening a recent conversation must use the current safe message viewer and must not mark the message read implicitly.

The email area has its own loading, empty, and error states. A Gmail loading failure must not prevent the rest of the profile panel from rendering.

## Starting an HTML Draft

When New Draft is selected:

1. Resolve the current primary contact with an email address. If no primary email exists, use the first active contact with an email; never guess between unrelated contacts.
2. Create a Design Studio project with `type: "email"`, the existing default email document, `linkedOrganizationId`, and `linkedContactId`.
3. Name it from the profile and current date without fabricating an event date or campaign purpose.
4. Navigate directly to `/design-studio/:projectId` with a safe `returnTo` value for the originating profile.
5. The editor displays the resolved To address and profile name, while still allowing the user to return to the profile.

Project creation uses the existing Design Studio API fields and authorization. No new draft is created until the user invokes one of the editor outcomes.

## One Canonical Email Record

The existing `office_email_drafts` row becomes the canonical delivery record for profile-linked Design Studio email. A Design Studio output links to that row instead of acting as a separate pretend mail record.

Add the smallest backward-compatible fields needed:

- `body_format`, defaulting to `plain_text`, supporting `plain_text` and `html`;
- nullable `design_project_id` and `design_version_id`;
- nullable `scheduled_for` and `business_time_zone`;
- nullable `gmail_draft_id`, `gmail_message_id`, and `gmail_thread_id`;
- nullable send/schedule idempotency keys;
- nullable dispatch lease, attempt, retry, and sanitized failure fields required for automatic scheduling.

Extend the existing state constraint without removing current states. New supported states are `gmail_draft`, `scheduled`, and `failed`; existing `draft`, `submitted`, `needs_changes`, `sending`, `sent`, and `cancelled` remain compatible.

Use the repository's existing SQL migration and startup-migration pattern. Existing rows remain plain text and unchanged.

## Editor Outcomes

All delivery actions first save and freeze the exact current Design Studio version. HTML comes from the constrained email document serializer, not arbitrary unsanitized browser markup.

### Save in app

Create or update the canonical `office_email_drafts` row in `draft` state. Saving never contacts Gmail and never sends.

### Create Gmail Draft

Create or update a real Gmail draft through the existing authorized Google Workspace delivery client, store the returned Gmail identifiers, and transition the canonical record to `gmail_draft`. Repeating the same request returns the existing Gmail draft rather than creating a duplicate.

If Gmail's result is uncertain, preserve the email record with a manual-review failure state and instruct the user to check Gmail Drafts before retrying.

### Schedule

Require a future date and time, display the configured business timezone, and convert to UTC at the API boundary. Persist the exact frozen Design Studio version and transition the canonical record to `scheduled`.

A dedicated office-email dispatcher claims due rows atomically with expiring leases and sends them through the same delivery path as Send Now. Reuse the existing worker conventions and Render service configuration used by scheduled opportunity email; do not run an unsupervised timer inside the web server.

Scheduled email remains editable, reschedulable, or cancellable until claimed for sending. Editing creates a new frozen version and updates the canonical record rather than mutating sent history.

### Send Now

Use the existing owner/profile email send coordinator and production outreach safeguards. Send the frozen HTML as an HTML MIME body through the configured Adventure Zone Gmail account, then persist Gmail message/thread IDs, sent timestamp, profile activity, and any applicable follow-up workflow.

The UI must never show success until provider delivery and durable state updates both succeed. Ambiguous delivery results become a manual-review failure and must not be blindly retried.

## Outreach Review and Follow-ups

When exact outreach review is enabled, Schedule and Send Now remain disabled until the saved final recipient, subject, and serialized HTML fingerprint are approved. Any subsequent editor change invalidates approval. Creating a Gmail draft does not send and therefore does not require delivery approval.

After confirmed send or schedule, reuse the existing follow-up prompt and opportunity/profile activity conventions. Do not create a follow-up for a saved app draft or Gmail-only draft.

## API Boundaries

Add profile-linked Design Studio email endpoints following the current authenticated server/action patterns:

- create/update a canonical email record from a frozen Design Studio version;
- create or refresh the real Gmail draft;
- schedule/reschedule/cancel;
- send now;
- list active profile-linked drafts for the compact profile email area.

Every operation verifies that the Design Studio project, linked organization, linked contact, and email record belong together. The server derives the recipient from the linked active contact and rejects mismatched IDs. The From account is never accepted from the client.

Do not silently change existing `/office-admin/email-drafts` or Design Studio response contracts. Additive response fields are permitted; older plain-text composer behavior remains functional.

## Reliability and Security

- Require current owner/office authorization for profile, project, and email access.
- Keep OAuth credentials and Gmail provider payloads server-side.
- Do not log HTML bodies, recipients, tokens, or provider responses containing message content.
- Sanitize or serialize HTML from the constrained editor document before MIME construction.
- Use request keys and stored Gmail IDs to prevent duplicate drafts or sends.
- Use atomic state transitions and expiring leases for scheduled dispatch.
- Preserve failed drafts with actionable, sanitized errors.
- Never infer missing recipients, event dates, campaign purpose, or profitability.

## Testing

### Frontend

- exact mockup palette and status mappings;
- compact recent-email and draft-state rendering;
- email errors do not break the profile panel;
- New Draft is keyboard accessible and creates a linked email project;
- missing-contact-email disabled state;
- editor opens with profile/contact context;
- Save, Gmail Draft, Schedule, and Send controls expose accurate busy/success/error states;
- outreach approval invalidates when final HTML changes;
- desktop split and mobile sheet remain usable without horizontal scrolling.

### Server and database

- backward-compatible migration and state constraint;
- project/profile/contact ownership checks;
- exact HTML version freezing;
- app draft save without Gmail side effects;
- idempotent Gmail draft creation;
- schedule timezone conversion and future-date validation;
- claim/send lease behavior, retry boundaries, and cancellation race;
- idempotent Send Now with Gmail identifiers and profile activity;
- uncertain provider outcome remains manual review;
- plain-text profile drafts continue to work;
- fake Gmail provider only—automated tests must never send real mail.

## Rollout

1. Merge and apply the additive migration while the existing Gmail connection/readiness and outreach gates continue to prevent unavailable delivery actions; do not add a second rollout flag solely for this feature.
2. Deploy the API and office-email dispatcher.
3. Verify the connected Adventure Zone Gmail account has the required draft/send scopes.
4. Exercise Save in app and Create Gmail Draft on an internal test profile.
5. Verify one scheduled internal message and one immediate internal send, including profile history and Gmail thread linkage.
6. Enable normal delivery after exact-head verification.

## Acceptance Criteria

- Profile colors and states visibly match the supplied mockup palette.
- The selected profile panel shows the primary email, three recent conversations, draft statuses, and New Draft beneath the action controls.
- New Draft opens the existing HTML maker with the correct profile and contact linked.
- Save in app creates no Gmail side effect.
- Create Gmail Draft creates exactly one real Gmail draft and reports its state accurately.
- Schedule sends automatically at the chosen business-local time without duplicate delivery.
- Send Now delivers the exact approved HTML and records Gmail/profile history identifiers.
- Missing email, authorization failure, rate limits, and uncertain delivery produce truthful recoverable states.
- Existing profile routes, actions, search, filters, CSV export, plain-text drafts, and full email history continue to work.
