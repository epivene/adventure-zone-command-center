# Office Coordinator Workspace Design

**Date:** 2026-08-21  
**Status:** Approved design  
**Primary user:** Office Coordinator  
**Owner/admin counterpart:** Adventure Zone Command Center owner

## Summary

Add a dedicated **Office Coordinator** role and workspace to Adventure Zone Command Center. The first Office Coordinator account is intended for Amy, but the implementation must be role-based rather than hardcoded to one person.

The Office Coordinator should have broad visibility into event/profile information so she can perform real office and booking-adjacent work, while final sales prioritization, outbound email sending, route strategy, pricing/package decisions, finances, crew, imports, and other owner controls remain owner-only.

The workspace should feel like an intentional Adventure Zone job workspace, not a restricted or supervised copy of the owner portal. Avoid user-facing language such as "limited access," "support," "supervised," "approval required," or "assigned by Desiree." The role title is **Office Coordinator** and the workspace may be labeled **Booking Workspace** where that wording is more natural.

## Goals

1. Give the Office Coordinator a named login that is independent of travel-leg manager accounts.
2. Allow the Office Coordinator to browse and search all event/profile records needed for office work.
3. Allow direct editing of ordinary factual profile/contact information.
4. Provide a task-based Today experience for mail, contact verification, follow-up preparation, research/update work, and other office tasks.
5. Allow the Office Coordinator to draft complete emails but never send them directly.
6. Route submitted email drafts to the owner for review, editing, sending, or return for changes.
7. Give the owner a private Office Coordinator control area for queue management, review, completion history, help requests, and submitted drafts.
8. Enforce permissions on the backend, not merely by hiding UI.
9. Keep the role reusable for future office staff without expanding scope unnecessarily.

## Non-goals for the first release

- Direct outbound email sending by the Office Coordinator.
- Sales-call prioritization or ownership of the booking pipeline.
- Route planning or route secrecy controls.
- Pricing, package, discount, or proposal authority.
- Finance, receipt, crew, manager-operations, import, ACT migration/recovery, or system-settings access.
- Automatic task generation from every possible profile condition. This may be added later after the manual workflow is proven.
- Reusing a travel leg as a fake Office Coordinator identity.

## Role and terminology

### User-facing identity

The account header should present:

- **Adventure Zone**
- **Office Coordinator**

The primary workspace can be labeled **Booking Workspace**.

### Internal role

Introduce a role/account type separate from the existing leg-manager system. The implementation should support a reusable office-role account model, with the first role value being `office_coordinator`.

Do not model this role as a travel leg. Existing leg-manager authentication and permissions are scoped to a leg and currently expose route, money, receipts, crew, incidents, reviews, and operations tools. The Office Coordinator needs a person-based account with a different permission boundary.

## Office Coordinator navigation

The first-release workspace has six primary areas:

1. **Today**
2. **Profiles**
3. **Mail**
4. **Email Drafts**
5. **Tasks**
6. **Messages**

Profile search should be easy to reach throughout the workspace.

## Today

Today is the Office Coordinator home screen. It should present a calm, ordered work queue rather than sales prioritization language.

Examples:

- Verify mailing address for an event.
- Confirm the current contact person.
- Mail a brochure or information package.
- Prepare a follow-up.
- Draft an email.
- Update missing phone/email/website information.
- Review an email returned for changes.
- Resolve or comment on a task that needs more information.

The owner controls the queue order. The Office Coordinator sees a natural **Next up** ordering without exposing private sales scoring, sales priority fields, or the reasoning behind the order.

## Profile access

The Office Coordinator can search and open **all event/profile records**.

### Visible information

The profile view should include the working context needed to do the job, including where available:

- Event/profile name and description.
- Contacts and contact roles.
- Phone numbers and extensions.
- Email addresses.
- Mailing addresses.
- Website.
- Event locations/venues.
- Relevant booking information.
- Notes and history.
- Past communications.
- Past mail/brochure activity.
- Other factual event details already available in the normal profile.

### Direct edits allowed

The Office Coordinator may directly correct ordinary factual information such as:

- Event/profile spelling or factual name corrections.
- Contact person/name.
- Contact role/title.
- Phone number and extension.
- Email address.
- Website.
- Mailing address.
- Event location/venue information.
- Other factual profile fields explicitly marked safe for Office Coordinator editing.

These edits save immediately and appear in normal history/audit activity.

### Owner-only profile controls

Do not expose or permit changes to:

- Private sales priority/order.
- Internal prioritization or lead-ranking controls.
- Booking-pipeline strategy controls that determine who the owner should pursue first.
- Route assignment/route strategy controls.
- Pricing, package composition, discounts, or proposal authority.
- Administrative settings.
- Imports, migration, recovery, or consolidation administration unless separately authorized in a later design.

The backend must reject unauthorized writes even if an Office Coordinator manually calls an owner endpoint or types an owner URL.

## Tasks

### Task types

Initial task types:

- `contact_verification`
- `mail_brochure`
- `follow_up_prep`
- `research_update`
- `draft_email`
- `other`

### Task state

User-facing states:

- To do
- In progress
- Waiting
- Done

A task may also carry a **Needs Help** flag and a note.

### Task fields

A task should support:

- ID.
- Type.
- Title/instruction.
- Optional linked profile/event.
- Optional linked contact.
- Status.
- Needs-help state.
- Office Coordinator note.
- Private owner queue order/priority.
- Due date when useful.
- Created timestamp.
- Updated timestamp.
- Completed timestamp.
- Creator/source metadata.

Private owner ordering must not require user-facing labels such as "sales priority."

### Task actions for Office Coordinator

The Office Coordinator can:

- Start a task.
- Add/update a working note.
- Mark it Waiting.
- Mark it Done.
- Mark/unmark Needs Help and explain what is needed.
- Open the linked profile/contact.
- Launch the appropriate mail or email-draft workflow.

The Office Coordinator should not be able to alter private owner queue priority or reassign owner-only work.

## Mail and brochure workflow

The Mail area tracks physical outreach.

For a linked profile/contact, the Office Coordinator should be able to:

1. Verify the intended recipient/contact.
2. Verify or correct the mailing address.
3. Mark the brochure/package as prepared.
4. Record a mailed date.
5. Optionally record a short postage, tracking, or mailing note.
6. Mark the related task complete.

Mail activity should be visible in the profile history and in the owner's Office Coordinator view.

This is operational history, not a hidden performance score.

## Email draft workflow

### Office Coordinator capabilities

From a profile or Email Drafts area, the Office Coordinator can:

- Choose a recipient from known profile/contact email addresses.
- Enter/edit subject.
- Write the complete email body.
- Save a draft.
- Add an optional note to the owner.
- Click **Submit Email**.

The Office Coordinator must not have a send action, send token, or permission to invoke outbound email delivery.

### Draft states

User-facing states:

- Draft
- Submitted
- Needs Changes
- Sent

Optional internal states may exist for processing, but these four should cover the normal Office Coordinator experience.

### Submit Email behavior

Submitting an email creates an owner review item containing:

- Linked event/profile.
- Linked contact/recipient.
- Recipient email address snapshot.
- Subject.
- Body.
- Office Coordinator note, if any.
- Submitter account.
- Submitted timestamp.
- Current review state.

The owner may:

- **Send** as written.
- **Edit & Send**.
- **Return for Changes** with a note.

If returned, the Office Coordinator sees **Needs Changes** and the owner's return note. After updating, the draft can be submitted again.

After the owner sends the email, the Office Coordinator sees **Sent**. The owner identity does not need to be emphasized in the Office Coordinator UI.

### Security requirement

Outbound email sending must be guarded by owner authorization on the server. Hiding a Send button is insufficient.

If the application later adds pre-approved Office Coordinator sending, that must be a separate explicitly designed permission and is outside this release.

## Messages

The Office Coordinator should have a simple Messages area for internal communication relevant to her work. Reuse existing communication patterns where practical, but do not accidentally grant leg-manager-only route/operations context.

The Office Coordinator should be able to receive owner messages and communicate about tasks, drafts, or profiles without needing access to owner-only sections.

## Owner-side Office Coordinator area

Add an **Office Coordinator** area to the existing Command Center.

The owner can:

- View the current Office Coordinator queue.
- Create tasks.
- Link tasks to profiles and contacts.
- Reorder tasks privately.
- Edit/cancel tasks.
- Review completed work.
- See tasks marked Needs Help.
- Open the linked profile directly.
- Review profile-edit history attributable to the Office Coordinator.
- Review submitted email drafts.
- Send, Edit & Send, or Return for Changes.
- Review mail/brochure completion history.
- Manage Office Coordinator account access/session state.

Submitted email drafts and Needs Help items should also surface on the owner's **Today** page so the owner does not have to remember to inspect a separate section.

## Authentication and authorization architecture

### Separate from leg-manager authentication

The current manager login is leg-based. Office Coordinator authentication must be separate.

Introduce a person/account-based office authentication flow, for example:

- `/office/sign-in`
- Office account session/token.
- `/office/auth/me`
- Office-protected API middleware.

The exact route prefix may change during implementation if a more generic staff-auth namespace is cleaner, but the permission boundary must remain distinct from `/manager` leg access.

### Account model

The account model should include at minimum:

- ID.
- Display name.
- Role (`office_coordinator`).
- Password hash/salt or the project's chosen secure credential mechanism.
- Enabled flag.
- Session version/revocation field.
- Created/updated timestamps.

Do not store plaintext passwords.

### Authorization rules

Office Coordinator authorization must be allowlist-based. Only explicitly approved office routes/actions should be exposed.

An Office Coordinator token must not authorize:

- `/manager/*` leg-manager endpoints.
- `/manager-admin/*` owner manager-administration endpoints.
- Owner auth.
- Finance.
- Crew.
- Route operations.
- Incident/review operations.
- Imports/migrations/recovery.
- Settings.
- Outbound email send endpoints.

Likewise, the Office Coordinator frontend should redirect or show Not Found/Access Denied for owner and leg-manager routes.

## Data model

Prefer focused tables/entities rather than adding Office Coordinator concepts to travel-leg manager tables.

### Office accounts

Suggested entity: `office_accounts`

Core fields:

- `id`
- `display_name`
- `role`
- `password_hash`
- `password_salt`
- `enabled`
- `session_version`
- timestamps

### Office tasks

Suggested entity: `office_tasks`

Core fields:

- `id`
- `task_type`
- `title`
- `instructions`
- optional `profile_id` / organization-event link appropriate to the current profile model
- optional `contact_id`
- `status`
- `needs_help`
- `coordinator_note`
- `owner_sort_order`
- optional `due_at`
- `created_by`
- `created_at`
- `updated_at`
- `completed_at`

### Mail activity

Suggested entity: `office_mail_activity`, unless existing activities can safely and clearly represent the workflow.

Core fields:

- `id`
- linked profile/contact
- linked task when applicable
- recipient/address snapshot
- prepared timestamp
- mailed timestamp
- optional tracking/postage/note
- actor account
- timestamps

If the existing activity timeline is suitable, the implementation may store mail events there while preserving structured fields needed by the Mail workspace.

### Email drafts

Suggested entity: `office_email_drafts`

Core fields:

- `id`
- linked profile
- linked contact
- recipient address snapshot
- subject
- body
- coordinator note
- state
- submitted timestamp
- owner return note
- sent timestamp
- sent message/reference ID when available
- created/updated timestamps
- creator account

Use snapshots for recipient/subject/body at review/send boundaries so later profile edits do not silently change what was submitted.

## API boundaries

Create dedicated office-protected endpoints rather than proxying unrestricted owner endpoints.

Expected capability groups:

- Office authentication/session.
- Office Today/task list.
- Office task updates.
- Office profile search/read.
- Explicitly safe office profile edits.
- Office mail logging.
- Office email draft CRUD + submit.
- Office messages.

Owner-side endpoints should cover:

- Office account administration.
- Task creation/reordering/editing.
- Needs Help and completion review.
- Email review/send/return.
- Office work history.

For profile editing, prefer dedicated safe mutation schemas or field-level allowlists rather than exposing a broad owner profile update endpoint and attempting to hide fields only in the UI.

## Frontend architecture

Create a dedicated Office Coordinator shell instead of reusing `ManagerShell` wholesale.

Likely route family:

- `/office/sign-in`
- `/office`
- `/office/profiles`
- `/office/profiles/:id`
- `/office/mail`
- `/office/emails`
- `/office/tasks`
- `/office/messages`

The shell should have its own navigation and account context but may reuse safe presentational profile components where they can be cleanly parameterized by capabilities.

Avoid duplicating the entire owner profile implementation. Prefer shared read-only/factual sections plus role-specific actions.

## Audit and history

Normal Office Coordinator work should create useful history without presenting it as surveillance.

Record actor/source for:

- Factual profile edits.
- Notes.
- Mail prepared/mailed actions.
- Task state changes.
- Needs Help changes.
- Email draft submit/resubmit.
- Owner return/send actions.

The owner can review this history. The Office Coordinator sees normal work history/status where useful, not hidden owner-only prioritization metadata.

## UX tone

The Office Coordinator workspace should communicate responsibility and usefulness.

Use neutral operational language such as:

- Today
- Next up
- Mail
- Verify contact
- Draft Email
- Submit Email
- Needs Help
- Waiting
- Done

Avoid:

- Support portal
- Limited manager
- Restricted access
- Supervised
- Awaiting Desiree approval
- Checked by admin
- Sales priority

## Error handling

- Session expiry returns the user to Office Coordinator sign-in without leaking owner/manager data.
- Unauthorized API requests return 401/403 consistently.
- Email submit failures leave the draft saved and clearly show it was not submitted.
- Profile edits should validate data before saving and return field-level or clear actionable errors.
- Mail completion should not mark a task Done if the required mailed date/log operation failed.
- Owner send failures must leave the draft in a retryable submitted state rather than falsely marking it Sent.

## Testing requirements

### Authentication/security

- Office Coordinator can sign in with the correct office account.
- Disabled/revoked account cannot sign in or continue using an old session.
- Office token cannot access owner routes.
- Office token cannot access leg-manager routes.
- Office token cannot call outbound email send endpoints.
- Direct URL navigation cannot expose owner-only pages.

### Profiles

- Office Coordinator can list/search/open all profiles.
- Allowed factual edits succeed and generate history.
- Owner-only fields cannot be changed through office endpoints.
- A crafted payload containing an owner-only field is rejected or ignored according to explicit schema behavior; silent privilege expansion is not allowed.

### Tasks/mail

- Owner can create and reorder tasks.
- Office Coordinator sees owner order without private priority metadata.
- Office Coordinator can update task state and Needs Help.
- Mail prepared/mailed actions persist correctly and appear in history.

### Email drafts

- Office Coordinator can create/edit/save a draft.
- Submit Email creates an owner review item.
- Office Coordinator cannot send.
- Owner can Send, Edit & Send, or Return for Changes.
- Returned draft becomes Needs Changes with owner note.
- Sent draft becomes Sent only after successful outbound send.
- Submitted drafts and Needs Help items appear on owner Today.

### Regression

- Existing owner Command Center authentication/navigation continues to work.
- Existing leg-manager login and leg-scoped permissions remain unchanged.
- No Office Coordinator tables or routes accidentally change travel-leg manager behavior.

## Rollout

1. Add the role/account and data migrations.
2. Add office authentication and authorization middleware.
3. Add task/mail/email-draft backend capabilities.
4. Add Office Coordinator shell and pages.
5. Add safe shared profile read/edit capability.
6. Add owner Office Coordinator admin/review area and Today surfacing.
7. Create the first Office Coordinator account through an owner-only setup flow; do not hardcode credentials in source.
8. Verify the security matrix before enabling the account in production.

## Success criteria

The feature is complete when:

- Amy can sign in as **Office Coordinator** without selecting a travel leg.
- She can search and view every event/profile she needs.
- She can directly update ordinary factual profile/contact information.
- She can work through an ordered Today queue, log mail/brochure work, and flag Needs Help.
- She can draft and submit emails but has no technical ability to send them.
- The owner receives submitted emails and help items in the normal Command Center workflow and can review/send/return them.
- Owner-only sales strategy, route, finance, crew, import, settings, and email-send permissions remain inaccessible to the Office Coordinator at both UI and API levels.
- Existing leg-manager behavior is unaffected.
