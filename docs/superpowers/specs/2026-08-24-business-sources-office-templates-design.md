# Business Sources + Office Template Authoring Design

## Status

Approved architecture captured August 24, 2026. This design extends the existing Business Sources, Communication Templates, and Office Coordinator email-drafting flows without creating a separate file library or a second email/template subsystem.

## Goal

Make uploaded business-source files directly viewable, rebuild Adventure Zone standard email/script wording from the real Adventure Zone Sticky Notes source plus Amy's actual outreach style, and let Office Coordinator users create private reusable templates from their own drafts without being able to corrupt protected auto-fill fields.

## Core principles

1. **Source files remain evidence.** Original uploaded files are never silently rewritten, normalized, or treated as operational truth merely because they exist.
2. **Adventure Zone Sticky Notes is the base wording source for standard templates/scripts.** Preserve its recognizable wording and structure where still useful; make only light grammar, punctuation, placeholder, and flow edits unless a source fact is outdated or conflicts with reviewed current data.
3. **Amy's actual sent-email patterns refine the source wording.** Her real email habits guide tone, order, and practical variations, but do not override reviewed business facts.
4. **Changing facts render from reviewed data.** Package price, duration, dates, names, contact details, and similar values should use placeholders/current structured data rather than being frozen into reusable copy.
5. **Saved templates are not finished emails.** Templates preserve protected placeholders; rendering creates a normal editable draft that may then be personalized.
6. **Office Coordinator autonomy is real but bounded.** Amy can create and maintain her own private templates without owner approval for each use, while owner/admin retains visibility and administrative control.
7. **Company templates cannot be accidentally overwritten by Office users.** Office users may use or duplicate company/shared templates but not mutate the canonical source version.

---

## Part 1: Business Sources as a usable source library

### Existing behavior

The current Business Sources page already stores protected source-file metadata and already has an authenticated `Open document` action that requests a short-lived signed link. The problem is discoverability: file access is buried inside the expandable `File, links & historical terms` section.

### New card behavior

Every source record with an uploaded file gets an obvious **View file** action in the main source-card header/body area.

Each source card should surface at a glance:

- display title
- original filename
- upload/file-present status
- source category / year / access scope
- file size when available
- **View file** button

The existing expandable area remains useful for replace/remove actions, links, historical terms, and source-management details.

### Security

Do not expose permanent storage URLs.

`View file` continues to call the existing authenticated file-open endpoint, receives a temporary signed URL, and opens it in a new tab. Owner-only/role access rules remain unchanged.

No private source binary is committed to Git.

### Source provenance

The source record titled **Adventure Zone Sticky Notes** remains explicitly identified as the principal scripts/templates source. Standard templates seeded from this source retain `sourceDocumentId` / source-note provenance.

---

## Part 2: Source-grounded Adventure Zone standard templates

### Source priority

Standard template wording is developed in this order:

1. **Adventure Zone Sticky Notes** — primary wording/categories/source phrases.
2. **Amy's real sent emails** — practical tone, sequencing, personalization patterns, and response variations.
3. **Reviewed current business/package facts** — source of truth for variable/operational facts.

If source wording and current reviewed facts conflict, the template keeps the source's communication intent while substituting the reviewed fact or a structured placeholder. Never silently publish an old fact simply because it appears in a source document.

### Editing philosophy

The goal is **light revision, not corporate rewriting**.

Allowed cleanup:

- spelling
- punctuation
- capitalization
- obvious grammar
- sentence flow
- consistent Adventure Zone/package naming
- replacing person/event/date/price facts with placeholders
- breaking overly long paragraphs into readable sections
- removing obsolete event-specific details from reusable copy

Avoid changing recognizable wording just to sound more polished.

### Amy email patterns to preserve

Amy's sent outreach consistently uses a practical sequence:

- personal greeting when a contact is known
- quick introduction and relationship to Adventure Zone
- specific event named early
- enthusiasm about attending that particular event
- concise attraction/package description
- short Adventure Zone video/link when appropriate
- offer/price/duration using current data
- possible no-upfront/no-guarantee/revenue-share option only with conditional wording
- operational/reassurance details after the main offer
- clear next step

Her real outreach also supports useful variations such as:

- **wrong person / please forward** opening
- **insurance / additional-insured concern** response
- short follow-up responses to event-specific objections

### Initial standard template set

The first source-grounded standard library should include at minimum:

- Initial Outreach / Adventure Zone Intro
- State Fair Outreach
- Wrong Person / Please Forward
- Follow Up With Me Later
- Previously Attended / Seasonal Follow-up
- Insurance / Liability Concern Response
- Certificate of Insurance Request
- Ride / Inflatable Inspector Request
- Thank You / Not This Year / Keep Us in Mind
- Package-specific reusable wording where directly supported by source material

Additional Sticky Notes categories may be included when the source clearly contains reusable communication language.

### Scripts

The same source-review pass may refine relevant guided-call script wording, but it must preserve the existing call-flow graph and dispositions.

Source wording may change `say`/`coach` text only; it must not silently change branching logic, call outcomes, or workflow destinations.

Live-call copy should remain short and speakable, normally one or two sentences before waiting for a response.

---

## Part 3: Template ownership model

Templates gain an explicit ownership/origin distinction.

### Adventure Zone standard templates

- canonical company-owned templates
- sourced from Sticky Notes + reviewed Amy-email patterns
- visible to owner/admin
- usable by Office Coordinator when marked office-safe/active
- Office users cannot overwrite them
- Office user may duplicate one into a private template

### Shared Office templates

- owner-approved reusable templates available to Office Coordinator accounts
- may originate from a company template or be promoted from a coordinator-created template
- owner/admin controls promotion, archive, and shared status

### Private Office templates

- created by one Office Coordinator account
- private to that account by default
- immediately usable by that coordinator
- owner/admin can view, edit, archive, or promote them
- other Office Coordinator accounts cannot see/use them unless promoted to Shared

### Archived templates

Archived templates remain visible to owner/admin for history/provenance but are not offered for new Office drafts.

Existing drafts that were rendered from an archived template remain unchanged snapshots.

---

## Part 4: Office Coordinator "Save/Edit Template" flow

### Entry point

The existing Office email editor gets a **Save/Edit Template** action beside the draft controls.

Behavior depends on state:

- blank/custom draft → **Save as Template**
- draft rendered from a private template owned by this coordinator → **Edit Template**
- draft rendered from Adventure Zone/shared template → **Save as My Template** (duplicate), not overwrite

### Template editor contents

Opening template authoring loads the current subject/body text from the email box when appropriate.

The editor supports:

- template name
- subject template
- body template
- protected placeholder insertion
- preview using the current profile/contact context when available
- save/update private template
- cancel without changing the email draft

Saving a template does not automatically alter the current draft unless the user explicitly chooses to re-apply it.

### Draft-to-template conversion assistance

When a coordinator saves current draft text as a template, the app should detect known profile-specific values from the current context and offer replacements such as:

- `Sarah` → `{{contactName}}`
- current event/profile name → `{{eventName}}`
- current city → `{{eventCity}}`
- current state → `{{eventState}}`
- current event dates → `{{eventDates}}`
- current package values → corresponding package placeholders

The UI presents these as suggestions, not silent transformations. The coordinator may decline when a literal value is intentionally reusable.

### Finished draft behavior

When a saved template is used, placeholders are rendered into normal subject/body text using current profile/contact/package data.

The resulting email draft is ordinary editable text. Amy can personalize that individual email before submitting it.

The saved template itself remains protected and unchanged.

---

## Part 5: Protected placeholder model

### Goal

Prevent accidental reusable-template corruption such as:

- typoing `{{contactName}}` into an unknown token
- deleting only half of a token
- saving a specific person's name where a dynamic name belongs
- submitting an email with unresolved tokens

### Editor representation

In the **template editor**, approved placeholders should render as locked inline chips/tokens rather than raw freely editable braces.

Example display:

`Hi [Contact Name],`

Internally that chip serializes to:

`{{contactName}}`

### Allowed token operations

A coordinator may:

- insert a token from the approved token palette
- move a whole token
- remove a whole token

A coordinator may not:

- edit the characters inside a token
- invent an arbitrary token name
- partially delete a token

This prevents malformed placeholders at the authoring layer.

### Approved placeholders

Reuse the existing communication-template placeholder vocabulary where possible, including:

- `contactName`
- `eventName`
- `eventCity`
- `eventState`
- `eventDates`
- `senderName`
- `senderPhone`
- `senderEmail`
- `packageName`
- `packagePrice`
- `packageDuration`
- `followUpDate`
- `conventionName`
- `additionalInsuredWording`
- `additionalInsuredInfo`

Do not create free-form arbitrary placeholders from Office input.

### Validation

Server-side template create/update validation must independently verify that every serialized token belongs to the approved placeholder set.

UI protection is not sufficient by itself.

Existing unresolved-token submission protection remains in the final draft flow: drafts with unresolved `{{...}}` fields cannot be submitted.

---

## Part 6: Admin template management

The existing Admin → Communication Templates page becomes the owner control center for all template origins.

### Sections / filters

Provide clear filters or grouped sections for:

- Adventure Zone Templates
- Shared Office Templates
- Amy's / Coordinator Templates
- Archived

For private templates, display owner/coordinator identity in an administrative-safe label.

### Admin actions

Owner/admin may:

- open
- edit
- archive
- restore where supported
- promote a private coordinator template to **Shared Office**
- optionally duplicate wording into a new Adventure Zone standard template rather than mutating source provenance

Promotion preserves provenance/history: who originally created it and when.

### Company-template protection

Office Coordinator may never change the canonical company template through the Office API.

If an Office user wants modified wording from a standard/shared template, the action creates a new private template owned by that coordinator.

---

## Part 7: Data model changes

Extend the existing communication-template model rather than introducing a second table/system.

Recommended fields:

```text
owner_kind       company | shared_office | office_user
owner_office_user_id nullable
created_by_kind  system | owner | office_user
created_by_id    nullable
source_template_id nullable
```

Existing fields remain meaningful:

```text
source_document_id
source_note
access_scope
state
subject_template
body_template
allowed_placeholders
required_placeholders
```

### Ownership invariants

- `company` templates have no Office user owner.
- `shared_office` templates have no private Office owner.
- `office_user` templates require an authorized Office user ID.
- Office list endpoints return company/shared templates plus only the signed-in user's private templates.
- Owner/admin list endpoints may return all templates.

### Promotion

Prefer changing an Office template's ownership to `shared_office` only when history fields preserve original creator provenance. If provenance would be lost, clone-on-promote instead.

The implementation plan should choose the simpler safe option after reviewing current schema/migration constraints.

---

## Part 8: API boundaries

### Owner/admin APIs

Existing owner template management remains authoritative and expands to support ownership/origin filtering and promotion.

### Office APIs

Office Coordinator needs authenticated endpoints for:

- list templates available to this Office user
- render template
- create private template
- update own private template
- archive own private template
- duplicate company/shared template into a private template

Office endpoints must reject attempts to mutate:

- company templates
- shared templates
- another coordinator's private templates

### Existing drafts

Office draft submit/send boundaries remain unchanged:

- coordinator can save and submit
- coordinator cannot send
- owner/admin retains send/approval authority as currently designed

Template creation must not grant additional email-send permission.

---

## Part 9: Standard template source refresh workflow

### Source extraction

Implementation should use the actual protected **Adventure Zone Sticky Notes** source content already associated with Business Sources. Do not commit the binary or copy the entire source into Git.

Extract only the reusable wording needed to construct template seeds/reviewed defaults.

### Source fidelity

For each seeded standard template, preserve provenance:

- Sticky Notes source document ID
- human-readable source note / locator when available
- note that Amy real-email patterns were used as tone/usage corroboration where applicable

### Review status

Source-derived standard templates should land in a reviewable state unless the existing approved source-integration design already marks that exact wording as reviewed/active.

Do not silently overwrite owner-edited existing template rows on startup.

Use stable codes and an explicit migration/update strategy for known system-seeded templates.

---

## Part 10: Error handling and safeguards

- Failure to open a protected business file shows an inline error and does not expose storage internals.
- Template authoring failures do not destroy the current email draft text.
- Duplicate/save failures preserve unsaved template-editor content.
- If rendering lacks required data, show missing fields and prevent submission until resolved.
- Unknown placeholders are rejected server-side.
- Office mutation attempts against non-owned templates return a permission error.
- Promotion/archive operations are auditable.
- No template operation changes CRM profile/contact data.

---

## Part 11: Testing requirements

### Business Sources

- visible `View file` action appears when `hasFile=true`
- no view action when no protected file exists
- existing signed-link open flow remains authenticated
- remove/replace behavior still works

### Standard templates

- source-derived template seeds have Sticky Notes provenance
- known system templates update only through an explicit safe migration strategy
- current package facts remain placeholders/structured values rather than stale hard-coded values
- standard copy tests preserve expected Amy/Sticky Notes phrasing without requiring verbatim whole-document reproduction

### Office template permissions

- Office user sees company + shared + own private templates
- Office user does not see another user's private templates
- Office user can create/update/archive own private template
- Office user cannot mutate company/shared/other-user template
- duplicating company/shared creates a private copy
- owner can view/manage all
- owner can promote private to shared

### Protected placeholder editor

- token chips cannot be partially edited
- approved token can be inserted/moved/removed as a unit
- serialized output contains valid `{{token}}`
- server rejects unknown tokens even if client validation is bypassed
- draft-to-template detector suggests replacement for known current contact/event values
- rendered draft contains actual current values and remains normally editable
- unresolved final draft token still blocks Submit Email

### Regression

- Office Coordinator still cannot send email
- existing draft save/submit/review flow remains intact
- admin template editor remains functional
- call-script graph/dispositions are unchanged by source-wording refinement
- source business binaries remain outside Git

---

## Success criteria

This work is successful when:

- owner can immediately open uploaded Business Source files from the source-card surface;
- Adventure Zone standard templates sound recognizably like the Sticky Notes / Amy workflow instead of generic sales copy;
- changing facts are protected by placeholders/current reviewed data;
- Amy can turn her own draft wording into reusable private templates without leaving the email workflow;
- protected fields cannot be mistyped inside template authoring;
- Amy can edit her own private templates without overwriting company originals;
- owner can see/manage Amy's templates and promote a good one to Shared Office;
- future Office Coordinator accounts do not automatically inherit Amy's private experiments;
- email-send permission boundaries remain unchanged.

## Non-goals

This project does not:

- create a general-purpose Drive/file browser;
- commit source binaries to Git;
- allow arbitrary Office-defined merge fields;
- allow Office Coordinator to send emails directly;
- make every Amy private template company-standard automatically;
- replace the existing communication-template table/rendering system;
- replace the existing guided-call graph;
- silently reconcile conflicting source business facts.
