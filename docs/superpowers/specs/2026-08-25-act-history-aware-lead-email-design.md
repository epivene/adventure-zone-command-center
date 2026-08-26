# ACT and History-Aware Lead Email Design

**Status:** Approved in conversation by Desiree on August 25, 2026  
**Project:** Adventure Zone Command  
**Primary workflow:** Amy's September/October 2026 spreadsheet leads

## Goal

Recover useful contact information from the preserved ACT archive, determine whether Adventure Zone has a real prior relationship with each recipient, and choose the appropriate email style without inventing a contact, response, or business history.

This design adds evidence and classification to the existing per-event review workflow. It does not send email, bypass availability checks, or automatically approve a recipient.

## Locked business rules

- A verified organization inbox may be used when no named person exists.
- Organization-inbox drafts use `Hi,` and never invent a contact name or role.
- A verified response within the three calendar years before classification makes the recipient a returning contact.
- A verified response older than three calendar years uses a reintroduction email.
- Prior outbound contact with no verified response uses a prior-outreach/no-response email.
- No prior contact uses the introduction email.
- Unclear or conflicting evidence requires human review.
- `DO NOT SEND` overrides every classification and blocks draft creation.
- AI may summarize evidence and personalize approved copy, but it may not establish that a response occurred without supporting source evidence.
- A person, email address, event, or profile is never automatically created or overwritten from extracted text.

## Scope and delivery order

### Checkpoint 1: ACT profile evidence and organization inboxes

The selected-profile review will display:

- CRM profile name, location, phone, and website;
- active CRM contacts and their roles;
- preserved ACT Description/Business Card text when available;
- unique email addresses extracted from that text;
- the ACT archive/version reference supporting each extracted candidate.

The existing ACT replacement archive stores complete per-record detail snapshots separately from the reduced company projection used to build CRM profiles. The feature must read the latest complete company detail snapshot linked to the selected organization. It must not assume the latest list projection contains Description/Business Card data.

Description extraction will inspect the archived detail record through one isolated extractor. It recursively examines string leaves, normalizes each leaf's terminal property name to lowercase alphanumeric text, and accepts the leaf only when that name is `description`, ends in `description`, is `businesscard`, or ends in `businesscard`. It does not scan arbitrary text fields for email addresses. For every accepted leaf, the extractor returns the original text, its exact JSON property path, and normalized unique email candidates. If no eligible field exists, the UI states that no ACT Description/Business Card was archived. The accepted-key rule and returned source path make the behavior testable without assuming one undocumented ACT response shape.

The review form gains a distinct `organization_inbox` recipient mode in addition to `existing` and `manual`. In organization-inbox mode:

- recipient email and evidence are required;
- contact name and person role are absent rather than fabricated;
- recipient confirmation and introduction suitability remain required;
- no CRM contact is created;
- the saved review decision remains distinguishable from a manually entered person.

### Checkpoint 2: Relationship evidence and email classification

The app will assemble prior-contact evidence associated with the selected profile, event, and recipient from:

- imported ACT notes and history;
- imported ACT email/history records where direction is explicit;
- Gmail messages already linked to the profile or deterministically matched through a verified recipient address;
- existing CRM activities that retain a stable ACT or Gmail source identifier.

Every evidence item contains its source type, stable source identifier, timestamp, direction when proven, matched profile/contact/email, and a short display excerpt. Duplicate ACT/Gmail observations of the same message must collapse to one evidence item.

Response status is deterministic:

- An inbound Gmail message from the verified recipient is a response.
- An ACT record counts as a response only when its structured data explicitly identifies an inbound/replied direction.
- Free-text notes such as “talked to them” may be displayed as context but do not prove a response automatically.
- Ambiguous direction, conflicting recipients, or uncertain profile matching produces `needs_review`.

Classification uses the time at which the classification is generated as its anchor. Let `cutoff` be the same calendar date three years earlier:

- latest verified response on or after `cutoff`: `returning_contact`;
- latest verified response before `cutoff`: `reintroduction`;
- outbound evidence but no verified response: `prior_outreach_no_response`;
- no prior-contact evidence: `new_introduction`;
- incomplete or conflicting evidence: `needs_review`.

The classification record stores the anchor time, cutoff date, selected outcome, evidence identifiers, latest outbound timestamp, latest verified response timestamp, and whether human review is required. Reclassification is idempotent and does not rewrite source history.

## Email behavior

The classifier selects one of four versioned email styles:

1. `new_introduction` — Amy's preferred 2026 introduction email.
2. `prior_outreach_no_response` — a polite reintroduction/follow-up that does not claim the recipient replied.
3. `returning_contact` — acknowledges recent prior conversation without inventing details.
4. `reintroduction` — acknowledges older contact and reintroduces Adventure Zone.

The exact alternate-template wording remains reviewable and versioned. AI may create a suggested opening from evidence excerpts, but factual statements about people, dates, prior interest, pricing, or commitments must be traceable to displayed evidence. If the evidence does not support a specific reference, the draft uses neutral approved wording.

Package sections are still controlled separately by live Google Calendar availability and normal inventory. History classification never decides which packages are offered. Commercial language concerning no upfront cost, percentage of ticket sales, or guarantees remains approval-required.

## Review experience

After a profile is selected, the reviewer sees three clearly separated areas:

1. **Profile and recipient evidence** — profile details, contacts, ACT Description/Business Card, and extracted email candidates.
2. **Previous contact** — classification, latest contact/response dates, source badges, and expandable supporting records.
3. **Email style** — the selected style and a short explanation such as “Returning contact: verified reply on May 14, 2025.”

Suggestions never mark the existing confirmation checkboxes automatically. Changing the profile, recipient, recipient mode, or evidence invalidates prior recipient and suitability confirmations.

If the organization has no named contact but has a verified general inbox, the UI shows `Organization inbox` and the future email greeting preview shows `Hi,`.

## Data and API boundaries

- Keep ACT source text immutable in the archive.
- Store selected ACT evidence by stable archive/version identifier, not by an untraceable copied claim.
- Return only the profile evidence needed by the review screen; never expose unrelated raw ACT records.
- Sanitize display excerpts and do not log raw email bodies, ACT description contents, recipient addresses, or AI prompts.
- Gmail access extends the existing Google Workspace connection and matching system; no second integration is created.
- A Gmail message must be linked deterministically or reviewed before it can affect classification.
- Evidence and classifications are owner/authorized-staff data and follow existing audit patterns.

## Failure and safety behavior

- Missing ACT detail: show “No ACT Description/Business Card archived” and continue with CRM contacts/manual research.
- Extracted malformed email: display nothing and record no candidate.
- Multiple extracted emails: require the reviewer to choose one; none is automatically preferred.
- No named person: allow organization inbox only after explicit recipient and suitability confirmation.
- Conflicting response evidence: classify as `needs_review` and do not generate a normal draft.
- AI unavailable or invalid: retain deterministic classification and use neutral approved copy or hold for review; never weaken evidence rules.
- Missing Calendar availability or `DO NOT SEND` evaluation: no Gmail Draft is created.

## Testing requirements

- ACT extractor preserves original text and extracts normalized unique emails from the Alamosa example `Society Hall Annual Celebration | Societyhall@gmail.com`.
- Missing/unsupported ACT fields fail closed without inventing content.
- Organization-inbox review succeeds without a person name and existing/manual person modes retain their current requirements.
- Switching recipient mode or email clears prior confirmation.
- A response exactly on the three-year cutoff is `returning_contact`; one day earlier is `reintroduction`.
- Outbound-only evidence is `prior_outreach_no_response`.
- No evidence is `new_introduction`.
- Ambiguous direction is `needs_review`.
- Duplicate ACT/Gmail observations do not count twice.
- `DO NOT SEND` blocks every email style.
- AI output cannot change deterministic response status or introduce unsupported claims.

## Out of scope for these checkpoints

- Automatic sending.
- Automatically creating contacts from extracted text.
- Google Calendar availability calculation and package filtering.
- Final alternate-template copy approval by Amy.
- Universal approval of no-upfront-cost, percentage, guarantee, overbooking, rental, fourth-Pirate, or Mini Zone language.
