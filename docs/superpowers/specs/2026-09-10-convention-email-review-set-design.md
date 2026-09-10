# Convention Email Review Set Design

**Date:** 2026-09-10  
**Status:** Approved in chat for specification  
**Primary goal:** Put the seven convention campaign emails into one usable Dave review task today, with a real rendered preview, testable links, and an independent decision for every email.

## Scope

This release adds a focused review-first workflow around the seven current convention campaign templates.

It includes:

- one owner action that sends the current seven-template set to Dave;
- one Boss work request containing seven immutable template review snapshots;
- ordered desktop and mobile previews;
- a safe, explicit link-testing checklist for every email;
- independent approve/request-changes decisions and notes;
- progress and final state calculated across all seven reviews;
- duplicate prevention for an unchanged set.

It does not include the drag-and-drop template editor. That follows as a separate phase using reusable email blocks after the time-sensitive review workflow is available. The batch review must not depend on Design Studio.

## Existing-system constraints

The current Boss work-request flow already supports one `email_template_approval` request with one `communication_template_reviews` row. The review stores an immutable subject/body/format/fingerprint snapshot and activates only the exact template revision Dave reviewed.

The current Boss preview uses a sandboxed iframe. This is safe for rendering but does not provide a reliable way to test external links. Link testing therefore belongs in an explicit checklist outside the iframe.

The current convention seed defines seven templates with codes beginning with `convention_before_` or `convention_after_`. The server remains authoritative for identifying and ordering the set.

## Data model

### Multiple review items per request

Keep the existing `email_template_approval` work-request type. A request may now own one or more `communication_template_reviews` rows.

Change the uniqueness rule from one review per request to one review per request/template, and persist the review order and display name:

- remove `communication_template_reviews_request_unique`;
- add `position` as a non-negative integer with a default of zero;
- add `template_name_snapshot` as non-null text, backfilled from the referenced template;
- add a unique index on `(request_id, template_id)`;
- add a unique index on `(request_id, position)`;
- add an index on `(request_id, decision)`.

New batch items receive positions zero through six in the server's canonical order. Existing one-template requests are backfilled to position zero and remain valid.

### Link verification evidence

Add `verified_links` as non-null JSONB with a default empty array on `communication_template_reviews`.

Each entry contains:

- `href`: the exact reviewed destination;
- `label`: the readable anchor text;
- `verifiedAt`: the Boss-recorded timestamp.

Only links extracted from that row's immutable `body_snapshot` may be submitted. The server rejects unknown, duplicate, non-HTTP(S), or changed URLs.

This records Dave's confirmation; it does not claim that the application can observe the contents of a cross-origin destination.

## Creating the review set

Add an owner endpoint dedicated to the convention set:

`POST /communication-templates/convention-review-set`

Input:

- `assignedBossAccountId`;
- `priority`;
- optional `dueAt`;
- optional instructions.

Server behavior:

1. Load the seven current company-owned convention campaign templates using the server's canonical ordered code list.
2. Fail without creating anything if any expected template is missing, archived, invalid, or duplicated.
3. Validate each template's placeholders and authored HTML.
4. Compute the existing fingerprint for each exact template revision.
5. Compute a set fingerprint from the ordered seven `templateId:fingerprint` pairs.
6. Create one work request titled **Review convention email set**.
7. Insert seven immutable review rows in the same transaction.
8. Use `convention-template-review-set:<set fingerprint>` as the deduplication key.
9. If the exact set already exists, return that existing request rather than create a duplicate.

Active templates are eligible for re-review. Sending an unchanged active template does not demote it. Editing an active template through the existing template editor still moves it to `reviewed`; approving its exact snapshot returns it to `active`.

The owner Email Templates page gets one clear **Send convention set to Dave** action near the convention templates. After creation it links to the owner-visible request and reports that seven emails were included.

## Boss review experience

The Boss request detail displays a single **Convention Email Set** review screen.

### Set-level navigation

The top of the screen shows:

- progress, such as **3 of 7 reviewed**;
- counts for pending, approved, and changes requested;
- previous/next email navigation;
- a compact ordered list of all seven email names and their decision status.

The first pending email opens by default. Dave can revisit decided emails but cannot change a saved decision in this release.

### Email preview

Each email shows:

- its position, for example **Email 2 of 7**;
- template name;
- example subject with readable sample placeholder values;
- desktop/mobile preview toggle;
- the immutable HTML snapshot rendered in a sandboxed iframe;
- a notice that example names and dates are preview-only and the saved template retains placeholders.

The iframe remains sandboxed and non-authoritative for link testing. It must not run scripts, submit forms, or navigate the parent application.

### Link checklist

Parse anchor links from the immutable HTML snapshot and show a checklist beneath the preview.

Each unique HTTP(S) destination shows:

- the readable anchor text, falling back to a linked image's alt text and then the host name;
- the exact destination URL;
- **Test link**, opening that exact URL in a new tab with `noopener,noreferrer`;
- **Link works** confirmation.

Links with unresolved placeholders, malformed URLs, or disallowed protocols appear as blocked warnings and cannot be marked working.

Dave may request changes at any time. Approval is disabled until every valid extracted link is confirmed and there are no blocked links. Emails with no links explicitly show **No links in this email** and require no link confirmation.

### Independent decisions

Every review item has its own note and two actions:

- **Request changes** requires a note;
- **Approve email** requires all links to be confirmed.

The decision endpoint becomes item-specific:

`POST /boss/work-requests/:requestId/template-reviews/:reviewId/decision`

Input:

- `decision`: `approved` or `changes_requested`;
- optional `note`;
- `verifiedLinks`: the exact checked-link evidence.

The server verifies assignment, request/review ownership, pending status, fingerprint, link membership, and link completeness in one transaction.

Approving an item activates only that exact template snapshot. If the stored template changed after the set was created, the decision fails with a clear **Template changed—send the newest version for review** message.

## Aggregate request state

A new set starts in `waiting_on_dave`.

After the first item decision, while any item remains pending, the request becomes or remains `in_progress`.

When all seven items have decisions:

- if every item is approved, the request becomes `approved` and receives `completed_at`;
- if one or more items requested changes, the request becomes `changes_requested` and does not receive `completed_at`.

Approved items remain approved and active even when another item needs changes. The owner view lists the exact emails needing work and preserves Dave's item notes.

Concurrency is handled with decision/fingerprint predicates. Repeated identical submissions return the already-decided item; conflicting submissions return HTTP 409 and require refresh.

## Compatibility

Existing single-template review requests continue to render through the same component as a one-item set.

During the frontend transition, the detail response may expose both:

- `templateReviews: TemplateReview[]` as the new canonical collection;
- `templateReview: TemplateReview | null` as a compatibility alias only when one item exists.

The existing single-template decision route remains temporarily available and delegates to the only review item. It returns a conflict when a request contains multiple items.

## Security and safety

- Snapshot rendering remains inside a sandboxed iframe.
- Link testing uses only server-extracted HTTP(S) URLs from the immutable snapshot.
- External links open with `noopener,noreferrer`.
- Script, data, JavaScript, file, and malformed destinations are blocked.
- The server never treats a client-supplied link as authoritative.
- A decision cannot activate content whose subject, body, format, or fingerprint no longer matches the stored template.
- Creation and all seven snapshot inserts are atomic.
- No email is sent and no Gmail draft is created by this review workflow.

## Error handling

The UI provides explicit messages for:

- missing or invalid convention templates;
- an unchanged review set that already exists;
- a template changed after snapshot creation;
- blocked or unresolved links;
- a stale/repeated decision;
- a partially failed network request.

Creation is all-or-nothing. A decision affects only one review item and its aggregate request state calculation.

## Testing

### Database and service tests

- migration preserves existing one-item reviews;
- one request accepts seven distinct templates and rejects a duplicate template;
- set creation inserts seven ordered immutable snapshots atomically;
- the same ordered fingerprints deduplicate to one request;
- missing/invalid templates create no request;
- active templates may be reviewed without being demoted;
- partial decisions keep the request `in_progress`;
- all approvals complete the request as `approved`;
- mixed decisions complete it as `changes_requested`;
- approved items remain active when a sibling requests changes;
- changed template content blocks activation;
- unknown, unsafe, incomplete, or duplicate link evidence is rejected;
- repeated identical decisions are idempotent.

### Frontend tests

- owner action creates/opens one seven-email set;
- Dave sees the seven templates in canonical order;
- progress and status counts update per decision;
- desktop and mobile preview controls render the snapshot;
- sample placeholder values do not mutate the stored snapshot;
- each safe link displays label, exact URL, and a new-tab test action;
- approval is disabled until all links are confirmed;
- blocked links force a change request;
- per-email notes and decisions do not leak into another item;
- existing one-template reviews still work.

## Delivery boundary

This review-first release is complete when one owner action can place the exact seven current convention templates into one Dave task and Dave can render, test, and decide every email independently.

The follow-up drag-and-drop editor will operate directly on communication templates through a reusable block document, with blocks for header, GIF/image, heading, paragraph, offer box, button, divider, spacer, and footer. Its design and HTML round-trip rules will be specified separately so it cannot damage the approved existing email layouts.
