# Call Email Request Draft Flow Design

## Goal

Add a call outcome for cases where an event/contact asks The Adventure Zone to send information by email. Saving that outcome must reliably create both an email follow-up task and a Gmail draft without sending anything.

This change must not break or alter the two remaining spreadsheet outreach batches. The existing spreadsheet lead Gmail-draft workflow stays intact and continues to use its current lead-specific verification path.

## User-facing behavior

### Call outcome

Add a call disposition labeled **Asked me to send an email**.

When the call is saved with this outcome:

1. Save the call/activity normally.
2. Create an open email follow-up tied to the same profile/contact and booking when available.
3. Create or update one Gmail draft for that request.
4. Record the resulting draft relationship so the call/profile can show **Email requested · Draft ready**.
5. Never send the message automatically.

If a matching open draft already exists for the same profile/contact/outreach purpose, update or reuse it instead of creating a duplicate.

## Architecture

### Preserve the spreadsheet path

The existing spreadsheet workflow remains unchanged:

`spreadsheet lead -> lead verification -> current calendar/package checks -> personalized preview -> Gmail draft`

No call-record code will mutate spreadsheet lead rows or change the existing lead-draft endpoint contract.

### Add a profile/call draft-request path

Create a separate profile-based draft-request service:

`call outcome -> email follow-up -> profile draft request -> shared draft safeguards -> Gmail draft`

The profile draft request is not a fake spreadsheet row. It has its own durable identity and references:

- organization/profile id
- contact id when known
- booking id when known
- originating call activity/session id
- follow-up id
- request purpose (`send_information` initially)
- Gmail draft id/thread metadata when created
- status/error state

### Shared safeguards

The new service should reuse existing Google/Gmail primitives and approved message-building rules, but it should not depend on spreadsheet-only records.

Before draft creation it must validate:

- Gmail connection can create drafts.
- A verified usable recipient email exists on the selected/current contact.
- The contact is not marked DO NOT SEND / otherwise blocked by existing communication safeguards.
- Relevant profile and Gmail history is available for history-aware wording.
- If the draft makes current package-availability claims, current calendar/package availability must be checked first.
- Existing matching draft requests/drafts are deduplicated.

If package availability cannot be established safely, the system should still preserve the follow-up/request but hold draft creation for review rather than fabricate availability.

## Draft content

The first implementation supports the common **send information** request.

Draft wording should be based on the existing relationship-aware outreach rules:

- first outreach call -> normal researched introduction where appropriate
- existing relationship/follow-up call -> continue the relationship rather than reintroducing the company
- use profile/ACT history, call notes and Gmail history when available
- never invent prior calls, replies, event facts or availability
- draft only; never send

Where verified event dates and package availability are available, the existing approved package/pricing/service language may be used. If the call request does not yet have enough event/date context for a safe full package email, create/hold a draft request for review rather than inventing details.

## Follow-up behavior

The call completion transaction/workflow should create an email follow-up with a clear kind such as `email` / `send_information` using the existing follow-up model where possible.

The follow-up should remain visible until the user completes it. Creating the Gmail draft does not automatically mark the follow-up complete because the user still needs to review and send it.

## Failure handling

Call logging is the primary action and must not be lost because Gmail is temporarily unavailable.

Recommended sequence:

1. Persist call result.
2. Persist email follow-up.
3. Persist draft request.
4. Attempt draft creation.

If step 4 fails, the call and follow-up remain saved and the draft request becomes `needs_review` or `failed_retryable` with a visible error. Do not silently drop the requested email.

Do not retry an uncertain Gmail create result in a way that could create duplicate drafts. Reuse the existing Gmail idempotency/deduplication patterns.

## Follow-up UI cleanup

Replace the current indirect `?action=follow-up` -> hidden **More profile tools** workflow with a simple profile-level follow-up composer/modal.

Saving should:

- create the follow-up through the existing follow-up API/service,
- show an explicit success or error state,
- refresh the profile immediately so the next-follow-up card changes without a full page reload,
- remain usable on mobile.

This is a UI simplification over the existing follow-up model, not a new follow-up subsystem.

## Contact/profile navigation cleanup

The event/profile page becomes the default working surface for event contacts.

- Contacts remain records in the data model.
- Contact details shown inside a profile should be editable from the profile workflow.
- Avoid forcing the user into a separate contact-detail page for routine event booking work.
- Keep standalone contact routes available where they are still needed for global contact search, caller lookup, or non-profile workflows; do not delete them blindly in this change.

This removes duplicate-feeling navigation without risking unrelated call/contact features.

## Data and compatibility

Prefer adding a small dedicated draft-request table/entity rather than overloading the spreadsheet lead-draft table with nullable fake lead fields.

The new record should support idempotency keyed by the originating call/request and should reference the Gmail draft once known.

No migration in this work may alter semantics of existing spreadsheet lead records or existing Gmail drafts.

## Testing

### Call outcome

- The new disposition appears in the call UI.
- Saving it persists the call.
- It creates exactly one email follow-up.
- It creates exactly one draft request.
- Repeated/idempotent completion does not duplicate follow-up or draft.

### Draft behavior

- Valid profile/contact context can create a Gmail draft.
- Existing matching draft is reused/updated rather than duplicated.
- Gmail failure preserves the saved call and follow-up and exposes draft-request failure state.
- Missing/blocked recipient prevents draft creation but preserves the follow-up/request for review.
- No endpoint in this flow sends mail.

### Spreadsheet regression

- Existing lead Gmail draft tests remain green unchanged.
- Existing lead-specific API contracts remain unchanged.
- A spreadsheet lead can still create its draft exactly as before.

### Follow-up UI

- Profile follow-up composer saves successfully and refreshes the displayed next follow-up.
- API failure leaves the form open with an actionable error.
- Mobile-size interaction remains usable.

### Contact navigation

- Routine profile contact actions stay on the profile.
- Existing standalone contact routes still work for caller/global contact workflows.

## Acceptance criteria

- **Asked me to send an email** creates a durable call record, email follow-up, and Gmail draft request.
- When all required evidence is available, one Gmail draft is created/updated and nothing is sent.
- The profile/call shows a clear draft-ready or needs-review state.
- Follow-up saving from a profile is direct and reliable.
- Routine event contact editing no longer bounces the user through unnecessary contact pages.
- The two remaining spreadsheet batches and their existing draft workflow are not changed or broken.
