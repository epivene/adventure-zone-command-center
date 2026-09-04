# Website Inquiry Inbox Design

## Purpose

Move the public Adventure Zone website off the paid Replit deployment, host its Wix custom-element script on the existing Render static site, and deliver contact-form submissions to a protected review inbox in AdventureZone Command Center.

Public submissions must not write directly into the CRM. Authorized staff review each submission, inspect profile-match suggestions, and explicitly convert it into CRM records.

## Users and Access

- The public website visitor can submit an inquiry without signing in.
- The owner and administrators can view and process all website inquiries.
- Office Coordinator accounts require a dedicated `website_inquiries` permission. Amy's Office Coordinator account will receive this permission through the existing account administration flow.
- Other Office and Manager accounts cannot read inquiry data or perform review actions.
- Authorization is enforced by the API, not only by navigation visibility.

## Hosting and Integration

The existing Render static frontend will publish the custom-element script as:

`https://adventure-zone-command-center-1.onrender.com/adventure-zone-site.js`

Wix will configure the custom element with:

- Source: Server URL
- Server URL: the Render script URL above
- Tag name: `adventure-zone-site`

The script will submit JSON to the existing Render API at:

`https://adventure-zone-command-center.onrender.com/api/public/website-inquiries`

The API URL is public configuration, not a credential. No database, SMTP, session, or integration secret will appear in the Wix script.

## Submission Contract

The public form sends:

- `submissionId`: a client-generated UUID reused for retries
- `name`
- `email`
- `eventName`
- `eventDate`, when supplied
- `eventLocation`, when supplied
- `packageInterest`, when supplied
- `message`
- `website`: a hidden honeypot value that must remain empty
- `pageUrl`: the public page URL, limited to an allowed Adventure Zone origin

The server validates the payload with strict schemas and rejects unknown fields. Field lengths remain aligned with the current website form. Email and date formats are validated server-side.

Successful responses return an inquiry reference and a visitor-safe confirmation. Repeating the same `submissionId` returns the original success without creating another record.

The custom element disables the submit button while sending, uses a bounded request timeout, and preserves entered values after failure. A failure message offers a visible email link; it does not automatically open the visitor's mail client.

## Data Model

A new `website_inquiries` table stores the review queue independently from CRM contacts, organizations, bookings, and follow-ups.

Core fields:

- UUID identifier and unique client submission ID
- submission status: `new`, `reviewing`, `converted`, `archived`, or `spam`
- all validated form fields
- normalized email and a non-reversible content fingerprint for duplicate detection
- source origin and creation/update timestamps
- reviewer identity and review timestamp
- converted contact, organization, and booking identifiers when conversion succeeds
- alert delivery state, attempt count, last attempt time, and a sanitized failure reason

Indexes support unread counts, newest-first inbox listing, normalized-email matching, and recent duplicate detection. Raw IP addresses are not stored with the inquiry.

Review actions are also written to the existing audit/activity mechanism with the actor, action, timestamp, and resulting record identifiers.

## Public Endpoint Security

The public intake route is mounted before the owner-only API gate and is the only anonymous write route added by this feature.

Controls include:

- strict request-body size and field limits
- a honeypot field
- per-client fixed-window rate limiting without persisting a raw IP address
- CORS and origin checks against a comma-separated server-only `WEBSITE_INQUIRY_ALLOWED_ORIGINS` setting; production will contain only `https://the-adventure-zone.com` and `https://www.the-adventure-zone.com`, while local test origins are permitted only outside production
- idempotency through the unique submission ID
- a recent-content duplicate check
- generic public errors that do not disclose database or matching details
- structured server logs with inquiry IDs and no full message bodies

If abuse exceeds these controls, a managed challenge can be added later without changing the inbox or CRM conversion model.

## Inbox Experience

Command Center adds a **Website Inquiries** navigation item for authorized users. Its badge shows the count of `new` inquiries.

The inbox lists newest submissions first and displays:

- submitter and email
- event or organization name
- requested date and location
- package interest
- received time and current status

Opening an inquiry shows the complete message, alert state, audit history, and profile-match suggestions.

Available actions are:

- begin review
- approve and convert
- archive
- mark as spam
- restore an archived or spam item to the review queue

Email alerts contain a short summary and a secure deep link to the inbox. The full message remains in Command Center.

## Profile-Match Suggestions

Matching is advisory and never merges records automatically.

Contact candidates are ranked using:

1. exact normalized email
2. normalized full-name similarity
3. relationships to likely event profiles

Event-profile candidates are ranked using:

1. normalized event or organization name
2. city and state parsed from the submitted location when possible
3. event-date proximity to existing bookings
4. relationships to a matched contact

Each candidate includes human-readable reasons and enough context to distinguish similar records. The reviewer can select a suggestion, search manually, or choose to create a new record.

## Conversion Workflow

Approval opens a confirmation panel prefilled from the inquiry and the selected matches. The reviewer can correct names, location, package, dates, and the next-action reminder before conversion.

The default next action is a call due at 9:00 AM America/Denver on the next business day.

One database transaction will:

1. reuse or create the contact
2. reuse or create the event profile
3. ensure the contact-to-profile relationship
4. create a `new_lead` booking
5. create the next-action follow-up
6. add an activity containing the inquiry context
7. mark the inquiry `converted` with the resulting identifiers
8. record the reviewer in the audit trail

The transaction is idempotent. Retrying after a network interruption returns the existing conversion instead of creating duplicate CRM records.

## Notifications

Saving the inquiry is the source of truth. Badge counts derive from persisted `new` records.

After a successful save, the API schedules an email alert using the existing server-side mail configuration. Recipients come from a server-only `WEBSITE_INQUIRY_ALERT_RECIPIENTS` setting so addresses are not bundled into public JavaScript.

Email failure does not fail the visitor's submission. The inquiry records the failed attempt, remains visible in the inbox, and is retried with bounded backoff by the existing worker lifecycle. Authorized users can see the alert state.

## Error Handling

- Invalid or oversized public submissions return a visitor-safe validation message.
- Rate-limited requests return a retryable response and do not create records.
- Database failure returns a temporary failure while preserving the visitor's form entries.
- Alert failure is logged and retried without losing the saved inquiry.
- A failed conversion rolls back all CRM writes and leaves the inquiry reviewable.
- Concurrent conversion attempts resolve to one conversion result.
- Startup readiness continues to gate the public endpoint consistently with other business writes.

## Testing and Verification

Implementation follows test-first development.

API and database coverage will verify:

- valid submission persistence
- validation, origin, honeypot, and rate-limit rejection
- idempotent retries and recent duplicate detection
- badge/list/detail authorization for owner, administrator, Amy's permission, and denied roles
- deterministic contact and event match suggestions with explanation text
- transactional conversion, rollback, and concurrent retry behavior
- archive, spam, restore, and audit events
- alert success, failure persistence, and retry behavior

Frontend coverage will verify:

- permission-aware navigation and badge counts
- inbox loading, filtering, detail display, and status actions
- match selection and approval confirmation
- accessible loading, empty, error, and success states

Custom-element coverage will verify:

- request payload and submission-ID reuse
- disabled/loading state
- success reset
- preserved values and email fallback after failure
- no embedded secrets or Replit runtime dependency

Validation includes the focused test suites, TypeScript checks for affected packages, API and frontend production builds, Render health checks, direct loading of the hosted script, and a Wix Preview smoke test.

## Deployment and Manual Steps

1. Merge the verified Command Center code and deploy the API and static frontend on Render.
2. Configure `WEBSITE_INQUIRY_ALERT_RECIPIENTS` in the API service.
3. Grant the Website Inquiries permission to Amy's Office Coordinator account.
4. Verify the public endpoint and hosted script URLs.
5. Change the Wix custom element from Velo File to the Render Server URL and restore the `adventure-zone-site` tag.
6. Remove the temporary Wix diagnostic custom element after confirmation.
7. Preview the layout without submitting, then test one clearly labeled inquiry from the published production origin and archive it after verification.
8. Ask for final confirmation immediately before publishing the Wix site.

The paid Replit deployment can be stopped only after the Render-hosted script, inquiry flow, and published Wix page are verified end to end.
