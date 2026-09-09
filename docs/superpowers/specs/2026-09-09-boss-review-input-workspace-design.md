# Boss Review and Input Workspace Design

**Date:** 2026-09-09  
**Status:** Approved in conversation; awaiting written-spec review

## Purpose

Give Dave one obvious place in the Boss workspace to see what needs his attention, complete short forms, preview proposed email templates, approve wording, request changes, and leave notes.

The same workflow gives the Owner a controlled place to send requests to Dave, review his submissions, and decide when submitted information becomes official CRM data.

The first release supports two request types:

1. Rapid Convention Notes
2. Email Template Approval

The task framework is deliberately extensible so later request types, such as a route question or document approval, can use the same queue without requiring a separate subsystem or a free-form form builder.

## Goals

- Make `Needs Your Attention` the first page Dave sees after Boss sign-in.
- Keep Dave's work quick enough for mobile use and back-to-back convention conversations.
- Preserve unfinished typing and never clear a form until its save is confirmed.
- Let Dave approve email wording or request changes without editing the canonical template.
- Let the Owner review convention submissions before applying them to CRM profiles.
- Activate an approved email template automatically in the existing communication-template library.
- Keep a durable history of requests, responses, decisions, notes, and revisions.
- Keep existing Boss routes, calendar, documents, receipts, reviews, and maintenance features accessible.

## Non-goals

- A general-purpose drag-and-drop form builder.
- Direct email sending from Dave's approval screen.
- Allowing Dave to edit canonical email template wording or markup.
- Automatically applying rapid convention notes to profiles without Owner review.
- Building new Amy-specific workflow or navigation.
- Deleting or rewriting historical records attributed to Amy.
- Live synchronization between Gmail drafts and in-app templates after the initial conversion.

## Roles and permissions

### Owner

The active Owner is the only user who can:

- create or cancel a Dave request;
- set instructions, priority, and an optional due date;
- edit canonical email template wording and presentation;
- submit a template revision to Dave;
- review a convention submission;
- select or correct its CRM profile match;
- approve and apply the submission to CRM data.

### Dave / Boss

Dave can:

- view requests assigned to the Boss workspace;
- save and resume an in-progress form;
- submit multiple convention entries;
- reopen and correct a saved-but-not-yet-applied convention entry;
- preview an email template exactly as a recipient will see it;
- approve a template;
- request changes and leave notes;
- see the state and recent history of his requests.

Dave cannot edit the canonical template, apply a convention submission to the CRM, or access Owner-only controls.

### System

The system can create clearly labeled automatic requests from an approved workflow. Automatic creation must be deterministic, auditable, and deduplicated. Release 1 uses automatic requests only where explicitly wired; it does not create speculative tasks.

Amy is not part of this workflow. Historical attribution remains unchanged, but no new Amy queue, permissions, or navigation are added.

## Recommended approach

Use one flexible Boss task queue with typed payloads. Each task has common assignment, priority, state, instructions, due date, and audit history, while a type-specific record owns the fields and actions for a convention form or template review.

This avoids two disconnected mini-apps while also avoiding the complexity of a full form builder.

## Boss experience

### Default landing page

After Dave signs in, the Boss home route opens **Needs Your Attention**.

The top area shows:

- total items needing Dave;
- urgent or overdue count, when nonzero;
- a short plain-language description of the next action.

Open items appear before existing dashboard summaries and are ordered by:

1. overdue;
2. urgent priority;
3. due date;
4. oldest creation time.

Each card states the request type, purpose, who or what it concerns, due date when present, current status, and the primary action.

A compact, collapsible **Recently Completed** section shows recent decisions and submissions. Full history remains available without crowding the landing page.

Existing Boss pages and navigation remain available.

### Email template approval card

The card opens a recipient-style preview containing the rendered subject, email body, images, links, package presentation, and current promotion language. Internal labels explain:

- what the template is for;
- which campaign stage it belongs to;
- when it will be offered;
- any dynamic fields that will change for each recipient.

Actions:

- **Approve**
- **Request Changes**

Requesting changes requires a note. Approval allows an optional note. Dave cannot modify the preview.

An approval applies only to the exact reviewed template revision. If the Owner changes wording or HTML after approval, the template returns to `awaiting_approval` and a new review is required.

### Rapid Convention Notes card

The form is optimized for a phone and repeated entry. Controls are large, fields are short, and optional detail stays collapsed.

The initial rapid form captures:

- convention;
- event or organization name;
- person's name;
- role/title, optional;
- email, optional;
- phone, optional;
- city/state, optional;
- interest level;
- likely package or attraction interest, optional;
- what they cared about or asked for;
- promised next step;
- follow-up timing, optional;
- free-form quick note, optional.

At least an event/organization name or a person's name is required to save. Contact methods remain optional so Dave can capture partial conversations quickly.

The primary action is **Save & Start Next**. It:

1. validates the minimum fields;
2. sends an idempotent save request;
3. waits for server confirmation;
4. adds the entry to **Saved Today**;
5. clears the visible form only after confirmation;
6. focuses the first field for the next conversation.

The form keeps an autosaved working draft. Leaving, refreshing, closing the browser, or temporarily losing service must not silently discard it. A confirmed submission and an unfinished draft are separate records so resetting after a successful save cannot erase the saved entry.

Saved Today lists the person's or organization's name, save time, sync state, and Edit action. Dave may correct an entry until the Owner applies it. After application, it is read-only and links to the resulting profile.

## Owner experience

A **Dave Requests** area in the Owner workspace provides:

- **Needs Dave**: created or returned items waiting for Dave;
- **Submitted to Me**: convention entries awaiting Owner review;
- **Changes Requested**: templates Dave returned with notes;
- **Completed**: applied entries and approved templates;
- creation controls for supported request types.

When creating a request, the Owner selects a prepared type, supplies short instructions, chooses priority, and may set a due date.

### Convention review

Submissions are grouped by convention and shown newest-first within that convention.

The review screen shows:

- Dave's submitted fields;
- possible existing profile/contact matches with reasons;
- duplicate warnings;
- the CRM changes that will occur;
- edit/correction controls for submitted details;
- **Approve & Add to Profiles**;
- **Return for Clarification**.

No CRM record changes occur before approval.

If the Owner selects an existing organization, the approved submission adds the appropriate contact information, a convention-source note, follow-up details, and an auditable link back to the submission. If the Owner confirms a new organization, the same transaction creates the new profile and related contact/note/follow-up data.

Application is idempotent. Repeated requests, retries, refreshes, or double taps cannot create duplicate organizations, contacts, notes, or follow-ups.

### Template revision

A change request returns to the Owner with Dave's notes beside the exact reviewed revision. The Owner edits the canonical template, saves a new immutable revision, and sends that revision back to Dave.

Approval changes the exact revision to `active` and makes it available through the existing in-app email-template picker. Superseded revisions remain in history but are not selectable for new drafts.

## Convention template conversion

The existing conference campaign drafts are converted once into canonical in-app communication templates. The conversion preserves approved:

- purpose labels;
- recipient-facing subject lines;
- HTML and mobile layout;
- images and their ordering;
- working links;
- package-card presentation;
- sender/signature treatment;
- pre-convention, during-convention, and post-convention variants;
- personalization placeholders;
- winter booking promotion.

Gmail drafts are source material for the initial conversion, not the long-term source of truth. After conversion, changes happen in the app as new template revisions.

Internal template names must identify their purpose for Dave and the Owner; they are separate from the recipient-facing subject line.

The winter booking promotion is rendered as a campaign-wide offer with a displayed expiration date, not wording that says every recipient individually receives 30 days. The deadline is calculated from the intended send date according to the approved winter campaign rule, and the feature must not display the promotion outside its active campaign window. Promotion settings remain centralized so template copy does not drift across convention variants.

## State model

### Common task states

- `waiting_on_dave`
- `in_progress`
- `submitted_to_owner`
- `changes_requested`
- `returned_for_clarification`
- `approved`
- `applied`
- `cancelled`

Only valid transitions are accepted. Every transition records actor, time, prior state, new state, and optional note.

### Template lifecycle

The existing template lifecycle remains authoritative:

- `draft`
- `reviewed` or equivalent pre-activation state already used by the application;
- `active`
- `archived`

The new approval record links a Boss task to one immutable template revision. The implementation should adapt names to the existing schema rather than create a competing lifecycle.

### Convention submission lifecycle

- local/server working draft;
- saved submission;
- submitted to Owner;
- returned for clarification;
- approved and applied;
- cancelled.

An applied submission is immutable except through normal audited CRM corrections.

## Data design

Add a focused Boss work-request feature with records equivalent to:

- `boss_work_requests`: tenant/account, type, state, priority, instructions, due date, creator, assignee, timestamps, deduplication key;
- `boss_work_request_events`: immutable state and note history;
- `boss_convention_submissions`: request, convention, typed response fields, client mutation ID, current edit version, applied profile/contact IDs, application timestamp;
- `communication_template_reviews`: request, template ID, immutable template revision/fingerprint, decision, note, reviewer, decision timestamp.

Exact table and column names may follow repository conventions. Typed columns should hold frequently queried identity and status fields; flexible response detail may use validated JSON only where it prevents needless schema churn. Validation occurs at the API boundary and again before CRM application.

## API boundaries

Boss endpoints provide:

- list/count assigned open and recently completed work;
- get one authorized request;
- autosave a convention working draft;
- save a convention entry with a client mutation ID;
- edit a saved, unapplied entry;
- approve a template revision;
- request template changes.

Owner endpoints provide:

- create/list/cancel requests;
- view submissions and review histories;
- return a submission for clarification;
- preview proposed CRM mutations;
- atomically approve and apply a convention submission;
- submit a new template revision for review.

Every mutation checks current state and authorization on the server. Client-side hiding is not treated as access control.

## Reliability and error handling

- Autosave is debounced and visibly reports `Saving`, `Saved`, or `Not synced`.
- The latest unfinished draft is also retained locally so a browser interruption does not erase typed text.
- A form resets only after confirmed server persistence.
- Save and apply endpoints require idempotency keys.
- Conflicting edits return a clear refresh/review message rather than silently overwriting newer data.
- Template approval verifies the stored revision fingerprint so changed content cannot inherit approval.
- Missing or ambiguous profile matches block application and request Owner selection.
- Failure during CRM application rolls back the transaction; the submission remains reviewable.
- Images or preview failures do not block Dave from reading text or leaving a decision, but the screen warns him when the preview is incomplete so he does not unknowingly approve a broken visual template.
- Audit history is append-only for decisions and state transitions.

## Dashboard integration

The Boss dashboard response adds a lightweight work summary and may load detailed tasks from a dedicated endpoint. Existing dashboard cards remain intact.

The Owner dashboard displays a badge/count when Dave has submitted work or requested template changes. The initial release does not require email, text, or push notifications.

## Accessibility and mobile behavior

- Touch targets meet mobile sizing expectations.
- Every status is communicated by text as well as color.
- Forms use labels, appropriate input modes, and accessible validation summaries.
- The email preview can switch between mobile-width and desktop-width presentation.
- The page works on narrow phones without horizontal scrolling.
- Save state remains visible near the primary action.

## Testing

### Server

- Owner/Boss authorization boundaries;
- valid and invalid state transitions;
- request deduplication;
- convention save idempotency;
- atomic CRM application and rollback;
- duplicate-match blocking;
- prevention of double-applied notes, contacts, and follow-ups;
- immutable template-revision approval;
- automatic activation after approval;
- required change-request note;
- audit-event creation.

### Client

- Boss sign-in lands on Needs Your Attention;
- urgency ordering and empty state;
- mobile rapid-entry field flow;
- autosave restoration;
- no reset before confirmed save;
- reset and refocus after confirmed save;
- Saved Today editing;
- offline/not-synced status;
- exact template preview and incomplete-preview warning;
- approve/change-request controls;
- Owner grouping and review controls;
- dashboard badges;
- existing Boss navigation remains available.

### Regression

Run the existing Boss dashboard/workspace, communication-template, email editor, organization/contact, notes, and follow-up tests in addition to the new focused suites.

## Acceptance criteria

1. Dave signs in and immediately sees all open assigned work.
2. Dave can record repeated convention conversations using Save & Start Next without losing or duplicating entries.
3. An unfinished entry survives navigation or interruption.
4. No convention submission changes CRM data until the Owner approves it.
5. The Owner can correct the profile match and apply once without duplicates.
6. Dave sees the actual visual email and can approve it or request changes with notes.
7. Dave cannot edit canonical template content.
8. Approval activates only the reviewed revision in the existing template library.
9. Any later template edit requires renewed approval.
10. Converted convention templates retain their approved presentation, personalization, and winter promotion behavior.
11. Both workspaces show accurate counts and durable history.
12. Amy receives no new workflow or access while historical attribution remains intact.
