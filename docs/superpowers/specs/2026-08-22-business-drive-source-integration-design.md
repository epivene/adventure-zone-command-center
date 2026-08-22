# Business Drive Source Integration + Event Checklist Design

**Date:** 2026-08-22  
**Status:** Approved design, pending user review of this written specification  
**Project:** Adventure Zone Command Center

## Summary

Use the newly available Adventure Zone business files as reviewed source material for the Command Center without blindly importing their wording or treating every number in them as current operational truth.

The first source set is:

- `ADVENTURE ZONE STICKY NOTES.docx.pdf`
- `Adventure Zone Attended Calendar.xlsx`
- `Inflatable List.pdf`
- `Inflatables (carnival).docx.pdf`
- `pirates rebellion contract.pdf`
- `VENDOR APP 2026.docx`

The files should improve six existing parts of the app:

1. Guided call scripts and response branches.
2. Reusable email and office communication templates.
3. Package, pricing, site, and operating knowledge.
4. Leg Manager event check-in/check-out, including required pre-event and post-event checklists.
5. Resource inventory and maintenance identity.
6. Profile history and event-specific document records.

The original files remain available as evidence. The app stores reviewed, structured facts and professionally edited customer-facing copy separately from the raw source files.

## Relationship to existing designs

This design extends the following approved systems rather than replacing them:

- Packages, Booking Assistant, and Manager Assistant.
- Editable Call Scripts.
- Manager Event Lifecycle + Operations.
- Office Coordinator Workspace.

Where this specification differs from the earlier Manager Event Lifecycle design, this specification governs the sequencing and persistence of pre-event and post-event checklist work around check-in and check-out.

## Product principles

### 1. Source material is not automatically operational truth

A business file can contain useful language, old prices, negotiated exceptions, typos, duplicated drafts, or conflicting rules. Upload date alone does not make one passage authoritative.

The app must distinguish:

- the original source document,
- a proposed fact or piece of wording extracted from it,
- the reviewed structured value currently used by Command Center,
- event-specific exceptions such as signed contract terms.

### 2. Current app wording remains the default when it is already better

The current guided-call wording is conversational, concise, and safer than copying Amy's long email-style introductions into a live phone call. Existing wording remains primary unless a source adds a genuinely useful response, missing fact, or stronger phrase.

Amy's document is a base library of business experience. It is not a block of copy to paste into the app unchanged.

### 3. All customer-facing copy receives an editorial pass

Anything derived from Amy's scripts or templates must be rewritten and reviewed for:

- grammar,
- spelling,
- punctuation,
- capitalization,
- sentence flow,
- consistent package names,
- clear placeholders,
- a warm but professional tone,
- concise live-call phrasing,
- scannable email structure,
- removal of accidental repetition,
- removal of obsolete dates and hard-coded names,
- removal of unsupported promises.

Editing wording must not silently change the underlying business fact. If a sentence is unclear because the source fact is unclear, the app marks the fact for owner review instead of polishing a guess into something that sounds certain.

### 4. Reusable copy pulls facts from structured data

Prices, package durations, attraction counts, insurance language, discounts, payment options, and site requirements should not be duplicated across dozens of templates.

Templates reference reviewed structured data wherever practical. Updating an approved package price should update future rendered drafts without requiring manual edits to every email template.

### 5. Event-specific documents never become universal rules

A signed contract or vendor application belongs to the related event/profile and may contain negotiated terms that differ from package defaults.

The 2025 Ravalli County Fair Pirate's Rebellion agreement is historical evidence for that booking. It is not the universal Pirate's Rebellion contract or current package price.

The 2026 Hawthorne Armed Forces Day vendor application is also historical as of this specification date. It should be attached to that event/profile with its historical dates and deadline, not create a new overdue task unless the owner deliberately chooses to reopen or reuse it.

## Source library and provenance

### First-release scope

Release 1 does not build a live Google Drive synchronization system or a generic AI document importer. It performs a reviewed, one-time integration of this known source set and establishes a small source-library structure that future files can use.

### Source document record

Store a lightweight record for each source document with:

- ID.
- Original filename.
- Display title.
- Source category.
- Original file attachment/reference.
- Effective year or date range when known.
- Related profile, booking, package, resource, or business-knowledge area when known.
- Access scope: owner, office, manager-safe, or public-template-safe.
- Review state: unreviewed, reviewed, superseded, or archived.
- Uploaded/imported timestamp.
- Reviewed by and reviewed timestamp.
- Notes describing conflicts or limitations.

### Proposed facts and reviewed values

When a source contributes structured business data, retain provenance back to the document and location within it.

A proposed fact should support:

- fact category,
- proposed value,
- normalized value when applicable,
- linked entity,
- source document,
- source page/sheet/cell description,
- review state,
- conflict group,
- reviewer and decision timestamp.

The first release may seed the reviewed values directly in a migration or feature-owned initializer, but the resulting records still retain a readable source note. A broad extraction dashboard is not required.

## Editorial and template policy

### Customer-facing voice

Customer-facing copy should sound like a real Adventure Zone employee, not a legal notice and not generic AI marketing.

Use:

- direct language,
- short paragraphs,
- specific next steps,
- natural enthusiasm,
- respectful handling of objections,
- consistent descriptions of The Adventure Zone as an event company rather than a normal single-inflatable rental business when that distinction is relevant.

Avoid:

- very long introductions before asking a question,
- multiple repeated closings,
- awkward all-caps emphasis,
- unreviewed superlatives,
- internal shorthand such as `inflates`,
- hard-coded employee names where the signed-in sender should be used,
- hard-coded prices or discount deadlines in static copy,
- promising the no-upfront-cost option before eligibility is confirmed,
- implying a package or attraction is available before schedule/resource checks.

### Copy status

Reusable copy has one of these states:

- Draft.
- Reviewed.
- Active.
- Archived.

Only Active copy appears as a normal template choice. The owner can preview and edit reviewed copy before activation.

### Placeholder validation

Templates use validated placeholders rather than free-form tokens. Initial examples include:

- `{{contactName}}`
- `{{eventName}}`
- `{{eventCity}}`
- `{{eventState}}`
- `{{eventDates}}`
- `{{senderName}}`
- `{{senderPhone}}`
- `{{senderEmail}}`
- `{{packageName}}`
- `{{packagePrice}}`
- `{{packageDuration}}`
- `{{followUpDate}}`

A template cannot be submitted or sent with unresolved required placeholders. Optional placeholders may be omitted cleanly without leaving broken punctuation.

## Guided call script integration

### Keep the protected script graph

The existing six script kinds remain:

- First outreach.
- Past customer / rebooking.
- Follow-up.
- Proposal / contract follow-up.
- Requested callback.
- Incoming inquiry.

The existing branch engine, dispositions, follow-up behavior, Do Not Call handling, and protected workflow remain code-controlled. Owner-editable wording continues to replace only visible `Say this` and `Coaching tip` text.

### Selective additions from Amy's source material

Amy's notes provide useful business responses that are missing or too shallow in the current graph. Add professionally rewritten nodes or branch choices for situations such as:

- The event already hired another provider.
- The event does not have enough space.
- The event cannot afford a full package.
- A contract or vendor agreement prevents competing attractions.
- The event is not happening this year.
- The event was cancelled or permanently discontinued.
- The person contacted is no longer the correct contact.
- The person contacted is the new correct contact.
- The contact asks to be removed.
- City, county, venue, or insurance rules do not allow inflatables.
- A former customer does not want Adventure Zone back.
- The event is interested in a smaller option.
- The event wants a future-season follow-up.

Each branch must produce the correct structured outcome rather than merely displaying polite wording. Examples include:

- future-season follow-up,
- contact correction task,
- Do Not Call,
- declined for this season,
- research needed,
- Mini Zone/package follow-up,
- feedback/recovery task,
- referral or alternate-event note.

### Script-writing standard

Live call text should normally be one or two speakable sentences before the employee pauses for a response. Longer detail belongs in coaching tips, package cards, or a follow-up email.

The script should help the caller sound prepared without making the call feel read aloud from a document.

## Reusable communication templates

### Template library

Add an owner-managed communication template library. Initial groups should include:

- New event introduction.
- Previous customer/rebooking.
- Follow up next season.
- Pre-convention introduction.
- Met at convention.
- Missed at convention.
- Package-specific introduction.
- Mini Zone/smaller-footprint option.
- Budget or space response.
- Wrong contact/contact verification.
- Contract attached.
- Signed contract received.
- Deposit received.
- COI information request.
- Thank-you after event.
- Christmas/holiday message.
- Ride inspector request.
- Internal COI request.

### Template fields

A template should contain:

- ID/code.
- Name.
- Channel/type.
- Category.
- Optional audience/event-type tags.
- Subject template when applicable.
- Body template.
- Allowed placeholders.
- Required data fields.
- Package/payment data dependencies.
- Access scope.
- Active/archive state.
- Source/provenance note.
- Created/updated/reviewed metadata.

### Office Coordinator behavior

The Office Coordinator can choose an Active template while drafting an email, render it with the linked profile/contact/event data, edit the result freely, and click **Submit Email**.

The Office Coordinator still cannot send. The existing owner review flow remains authoritative.

Owner-only or sensitive templates, such as insurer requests containing private business details, are not automatically visible in the normal Office Coordinator library.

### Dynamic fact rendering

Customer-facing templates should retrieve reviewed values at render time for:

- package price,
- normal duration,
- attraction description,
- insurance wording,
- included setup/staffing/teardown language,
- approved payment options,
- approved discount terms.

A template that depends on unresolved or conflicting business data should show **Needs owner review** rather than choosing a value silently.

## Package and business knowledge updates

### Reviewed 2026 starting defaults

Seed editable starting values from the most recent internally labeled 2026 material:

- Adventure Zone: $9,000.
- Pirate's Rebellion: $7,500.
- Warrior's Playground: $7,500.
- Mini Zone: $5,000.
- Normal base duration: 1-4 operating days.

These are editable starting/default values, not immutable contract prices.

### Package count language

Keep the current structured package guidance:

- Adventure Zone normally targets approximately 10-12 main attractions.
- Warrior's Playground normally targets approximately 5 main competitive/adrenaline attractions.
- Pirate's Rebellion normally targets approximately 3 main wet attractions.
- Mini Zone normally targets approximately 5 main attractions.

Customer-facing copy may use a simpler approximate description, but it must not turn references to 10-30 or 10-50 attractions into a promise for one normal package. Larger numbers can represent multiple units, broader company capacity, or older marketing language and require explicit configuration.

Carnival games, prizes, paintball/action-pursuit equipment, and shared resources remain separately modeled where appropriate.

### Requirements and conflict handling

Import reviewed package knowledge for:

- preferred and minimum footprint,
- power options,
- water access,
- Pirate's Rebellion pool-fill needs,
- setup and teardown access,
- forklift/loader needs,
- anchoring/ballast alternatives,
- operating-hour limits,
- camping/restroom access,
- surface/location preferences.

Do not silently resolve conflicts in the source files. Examples include:

- Mini Zone ballast appearing as both 44 and 50 barrels.
- Older 1-5 day wording versus newer 1-4 day wording.
- Different descriptions of when a no-upfront-cost option is available.
- Negotiated contract prices that differ from package defaults.

Conflicting values remain marked for owner review. The app may continue using the currently approved structured value until the owner changes it.

### Discounts and payment options

Discounts and no-upfront/payment options are owner-controlled rules. The source material may seed named options and explanatory copy, but the assistant and Office Coordinator cannot promise them automatically.

The owner controls:

- active/inactive state,
- eligibility,
- stacking behavior,
- deadline,
- amount/percentage,
- package/event restrictions,
- customer-facing explanation.

## Leg Manager event lifecycle checklists

### Goal

Turn the paper inflatable inspection sheet into the base for practical, event-specific pre-event and post-event checklists used by the assigned Leg Manager during check-in and check-out.

This is not a digital copy of the Monday-Sunday grid. It is a mobile workflow tied to one event, one leg, and the resources assigned to that event.

### Release 1 phases

Required checklist phases are:

1. **Pre-event checklist** during event check-in.
2. **Post-event checklist** during event check-out.

Daily multi-day rechecks may be added later using the same template system, but are not required by this release.

### Check-in sequence

1. Manager taps **Check in**.
2. The app immediately records arrival/check-in time and optional location using the existing lifecycle rules.
3. The event state becomes **Checked in - pre-event checklist needed**.
4. The app opens the pre-event checklist generated from assigned resources and site-wide requirements.
5. The manager completes the checklist and resolves any required exceptions.
6. The event becomes **Ready to operate** only when the pre-event checklist is completed and no unresolved unsafe result blocks operation.

Recording arrival must not be lost because a checklist is interrupted. The checklist is resumable and offline-capable.

### Checkout sequence

1. Manager taps **Start checkout**.
2. The app records that checkout work started and opens the post-event checklist.
3. The manager records equipment/site condition, missing items, damage, cleaning, and maintenance needs.
4. The manager completes the checklist, or uses an explicit **Unable to complete** exception with a required reason.
5. The app records the final checkout/departure timestamp.
6. The existing resumable event wrap-up opens.

A normal checkout should not silently bypass the post-event checklist. The explicit exception exists so a manager is not trapped by an unusual emergency, missing equipment access, or technical failure. The exception is visible to the owner/admin and creates follow-up work.

### Checklist structure

Generate two types of items:

#### Event/site-wide items

Examples:

- Walkways are clear and free from obstruction.
- Cords crossing walkways are properly covered/matted.
- Mats lie flat and straight.
- Loose items and garbage are removed.
- Anchoring method is appropriate for the surface/site.
- Required access or site conditions are available.

#### Resource-specific items

For each assigned inflatable/resource where applicable:

- Inspect the full inflatable for holes or damage, especially stairways.
- Verify required safety signage is attached.
- Verify the blower nozzle is secure.
- Inspect blower and extension cords and connection security.
- Verify each anchoring point has the required stake or approved ballast.
- Verify hook stakes are flush with the ground.
- Verify straight stakes are vertical, exposure is within the approved limit, and tops are covered.
- Verify inflatable sections are attached securely.
- Inspect straps and anchor points for excessive wear.

The post-event counterpart uses the same equipment categories but asks about condition after operation, new damage, missing components, cleaning/drying needs, load completeness, and whether the resource should remain available.

The post-event items are a designed operational extension of the source checklist; they are not represented as verbatim requirements from the paper form.

### Item results

Use clear mobile labels derived from the paper sheet:

- **Acceptable**.
- **Needs work, but safe**.
- **Unsafe - cannot operate**.
- **Not applicable**.

Behavior:

- **Acceptable** requires no issue.
- **Needs work, but safe** requires a note and creates or updates a maintenance/follow-up item while allowing operation.
- **Unsafe - cannot operate** requires a note and photo when the device permits, marks the affected resource unavailable/out of service, and blocks that resource from being marked ready.
- **Not applicable** may require a short reason for safety-critical items.

An unsafe result on one attraction should block that attraction, not automatically cancel the entire event. A site-wide unsafe result may block **Ready to operate** for the event until corrected or overridden by an authorized admin action.

### Photos, notes, and follow-up

Managers may attach photos to any item. Photos are required when practical for:

- unsafe damage,
- significant new post-event damage,
- missing equipment,
- a condition that needs owner/admin review.

Checklist results can create linked work in the existing maintenance/resource system rather than remaining trapped inside a completed checklist.

### Resource availability integration

A pre-event or post-event unsafe result changes the resource's operational status to unavailable/out of service until an authorized repair/inspection action returns it to service.

A safe-but-needs-work result does not automatically remove the resource from service, but it must remain visible in maintenance follow-up and future assignment warnings.

### Permissions

- Leg Managers can complete checklist runs only for events assigned to their leg.
- Leg Managers can view their submitted checklist history for assigned events.
- Owner/admin can view all checklist runs, exceptions, photos, and linked maintenance items.
- Owner/admin can correct or override lifecycle/checklist state through an attributable action with a required reason.
- Office Coordinator does not complete operational safety checklists.

### Offline and retry behavior

Checklist completion must work with poor or no connectivity:

- Checklist template and assigned-resource context are cached before near-term events when possible.
- Item selections, notes, and photo references save locally.
- Each checklist run uses a client-generated idempotency key.
- Sync retries do not duplicate runs or maintenance items.
- The UI clearly distinguishes Saved on device, Syncing, Synced, and Needs attention.
- An upload failure does not erase the text result or other completed items.

## Resource inventory updates

### Initial asset identity fields

Extend resource inventory with optional fields:

- Year built.
- Make.
- Model.
- Serial number.
- Inspection/maintenance identity notes.

Seed the nine known inflatable records from the uploaded list as reviewed initial data:

- Labyrinth Maze.
- Choo Choo Playhouse.
- Slide From The Castle.
- Beautiful Balloon.
- Arctic Blast.
- Run For The Hills.
- Purple House.
- Eliminator.
- Take Me Out To The Ballgame.

The source list is not assumed to be the complete company inventory. Existing resources should be matched before creating new records, and uncertain matches go to owner review.

### Checklist applicability

Resources may carry checklist tags such as:

- inflatable,
- blower-powered,
- wet attraction,
- multi-section,
- action-pursuit,
- carnival game,
- trailer/shared equipment.

Checklist generation uses these tags so a bumper-boat pool, carnival game, and inflatable slide do not receive an identical set of irrelevant questions.

## Attended calendar history import

### Source meaning

The workbook uses:

- `X` = attended.
- `B` = blacklisted.
- `C` = cancelled at the last minute.

Rows are grouped by month and contain event name, location, and yearly status columns.

### Match-first import

Do not create profiles directly from every row.

Use a reviewable matching process:

1. Normalize event name and location without discarding the original text.
2. Compare against existing profiles, event families, locations, and known aliases.
3. Use month/season as supporting evidence, not as the sole identity key.
4. Confident match: add structured attendance history to the existing profile/location.
5. Possible match: send to review.
6. No match: offer a new profile/location candidate.

Repeated names in different months or locations are not automatically duplicates. The workbook itself includes events that appear in more than one month, so the importer must preserve the possibility of multiple occurrences.

### History record

A structured attendance-history entry should contain:

- linked profile/event family,
- linked location when known,
- year,
- month/season from the source row,
- status: attended, blacklisted, or cancelled_last_minute,
- original event name/location text,
- source document reference,
- match confidence/review metadata,
- optional note.

Blacklisted is sensitive owner-level history. It should not automatically become the existing public-facing Do Not Call state without owner review because operational blacklisting and contact preference are not necessarily the same thing.

## Event-specific documents and profile attachment

### Ravalli County Fair / Pirate's Rebellion

Attach the signed 2025 agreement and rider to the appropriate Ravalli County Fair profile/location/booking history.

Store event-specific facts as historical booking terms, including dates, negotiated price/payment structure, access requirements, and attraction description. Do not overwrite current Pirate's Rebellion defaults from this contract.

### Hawthorne Armed Forces Day

Attach the 2026 vendor application to the Hawthorne Armed Forces Day profile/location as a historical application document.

Preserve its event dates, vendor coordinator information, application deadline, space/power form, and rules. Do not create a current overdue task automatically because the deadline has passed. A future version of the application can create a due task when its deadline is still active.

The small listed vendor-booth sizes should not be interpreted as sufficient space for an Adventure Zone package. They describe the application form's normal vendor spaces and require separate organizer confirmation for a full attraction setup.

## Sensitive information and access boundaries

The sticky-notes source includes business identifiers, insurance contacts, reference contacts, pricing rules, and internal notes.

Classify extracted information before exposing it:

### Owner-only by default

- EIN and sales-tax identifiers.
- Contract signatures.
- private reference-contact lists,
- discount authority and discretionary discount rules,
- private pricing strategy,
- source-review conflicts,
- internal-only notes,
- blacklist reasoning,
- credentials or account information if encountered.

### Office-safe when needed

- normal customer/profile contact details,
- mailing and venue addresses,
- approved email templates,
- COI information-request template,
- approved package descriptions,
- task-specific operational facts required to prepare work.

### Manager-safe when assigned

- event operational contacts,
- assigned package/resources,
- setup/teardown/site requirements,
- event checklist items/results,
- approved safety and maintenance instructions,
- no unrelated sales history or private pricing strategy.

Backend authorization must enforce these boundaries; hiding a section in the UI is insufficient.

## Data model

Use focused entities that follow current repository patterns.

### Suggested source/provenance entities

- `business_source_documents`
- `business_source_fact_reviews`

### Suggested template entities

- `communication_templates`
- optional `communication_template_versions` only if version history is inexpensive within the current settings architecture; otherwise retain updated metadata and archive superseded templates.

### Suggested checklist entities

- `event_checklist_templates`
- `event_checklist_template_items`
- `event_checklist_runs`
- `event_checklist_item_results`
- `event_checklist_attachments`

A checklist run is linked to booking/event, leg, phase, actor, and assigned-resource snapshot. Item results are separate records rather than one opaque JSON blob so unsafe issues, reporting, and maintenance links remain queryable.

### Existing entities to extend

- Package templates/knowledge for reviewed prices and requirements.
- Resources for year/make/model/serial and checklist tags.
- Event/profile history for attended-calendar entries when the existing history model can represent them cleanly.
- Documents/attachments for event-specific source files.
- Maintenance/resource availability for checklist-created issues.

Do not create a second package, maintenance, profile, or event model merely to hold imported facts.

## API boundaries

### Owner/admin

Provide owner-protected capabilities to:

- list source documents and review notes,
- view unresolved fact conflicts,
- manage communication templates,
- activate/archive templates,
- approve package/business knowledge,
- preview attended-history matches,
- approve/reject profile matches,
- view all checklist exceptions and maintenance links,
- correct/override checklist lifecycle state with attribution.

### Office Coordinator

Provide office-protected capabilities to:

- list Active office-safe templates,
- render a template against an authorized profile/contact/event,
- create/edit/save/submit an email draft,
- never invoke outbound send,
- never access owner-only source conflicts or sensitive identifiers.

### Leg Manager

Provide manager-protected capabilities to:

- retrieve checklist runs/templates for assigned events,
- save item results incrementally,
- attach notes/photos,
- complete or exceptionally bypass a checklist with reason,
- view resulting resource availability and maintenance status appropriate to the leg,
- never alter another leg's checklist or owner-only review data.

## Error and conflict behavior

- A source conflict remains visible; the system does not choose the newest-looking value automatically.
- Template rendering with missing required data shows exactly what is missing and keeps the draft/template selection intact.
- A template save rejects unknown placeholders.
- Package facts cannot be overwritten by an event-specific contract import.
- Checklist item saves are incremental and idempotent.
- An unsafe-result maintenance creation failure keeps the checklist result saved and clearly marks the linked follow-up as unsynced/retryable.
- A failed checklist photo upload does not erase the selected status or note.
- Attendance import never creates a profile on a low-confidence match without owner action.
- Sensitive source data is not returned from office/manager endpoints.

## Testing requirements

### Editorial/templates

- Raw Amy source copy is not surfaced as an Active template without reviewed edited text.
- Active templates contain valid punctuation/formatting and no unresolved required placeholders.
- Package prices and durations render from reviewed structured data.
- Changing an approved package price affects future rendered drafts without editing every template.
- Missing required data blocks submit/send and identifies the field.
- Office Coordinator can draft and submit but cannot send.
- Owner-only templates/data are not returned to Office Coordinator.

### Call scripts

- Existing six script kinds continue working.
- New objection/response branches map to the correct dispositions and follow-up actions.
- Do Not Call remains explicit and server-protected.
- Current default wording remains when no reviewed override exists.
- Owner wording edits cannot change branch destinations.

### Packages/knowledge

- Reviewed 2026 starting defaults seed correctly and remain editable.
- Event-specific contract values do not overwrite package defaults.
- Conflicting Mini Zone ballast values remain flagged rather than silently resolved.
- No-upfront-cost wording cannot be used as an unconditional promise.

### Check-in/pre-event

- Check-in records arrival before the checklist completes.
- Interrupted/offline checklist resumes without losing arrival or item progress.
- Event cannot reach Ready to operate with an unresolved site-wide unsafe result.
- An unsafe resource result marks only the affected resource unavailable unless the issue is site-wide.
- Needs-work-but-safe creates follow-up without automatically removing the resource from service.
- Manager cannot complete a checklist for another leg's event.

### Checkout/post-event

- Start checkout opens the post-event checklist.
- Normal final checkout requires checklist completion.
- Unable to complete requires a reason and is visible to owner/admin.
- Final checkout opens the existing resumable wrap-up.
- Post-event damage can create a linked maintenance item and resource status change.
- Offline retries do not duplicate checklist runs, item results, or maintenance work.

### Inventory/history/documents

- The nine source assets match existing resources before creating new ones.
- Year/make/model/serial data remains editable and auditable.
- `X`, `B`, and `C` workbook values import to the correct reviewed history states.
- Possible attendance matches remain in review.
- Repeated event names/months are not automatically merged.
- Ravalli contract and Hawthorne application remain linked historical documents rather than universal rules.

### Security/regression

- Owner-only identifiers never appear in office/manager API responses.
- Existing owner, Office Coordinator, and Leg Manager authorization remains intact.
- Existing call scripts, package editing, resource conflict tracking, check-in/out, and event wrap-up continue working when no source-derived data is present.

## Implementation order

### Phase 1: Reviewed business knowledge and copy foundation

- Add source/provenance records for the six files.
- Update reviewed package defaults and record unresolved conflicts.
- Add the communication-template library and seed professionally edited templates.
- Add selected guided-call branches while preserving current preferred wording.

### Phase 2: Event safety/condition workflow

- Add checklist templates and applicability tags.
- Integrate pre-event checklist with check-in.
- Integrate post-event checklist with checkout.
- Connect unsafe/needs-work results to resource status and maintenance.
- Add offline/idempotent persistence and admin oversight.

### Phase 3: Inventory and attended history

- Extend resource asset fields and match/import the nine known inflatables.
- Build the attended-calendar preview/match workflow.
- Import approved historical attendance states.

### Phase 4: Event-specific documents

- Attach the Ravalli and Hawthorne files to their profiles/bookings.
- Store reviewed historical terms and metadata without changing universal defaults.
- Surface the documents in normal profile/document history.

## Non-goals for this release

- Live Google Drive synchronization.
- Automatic ingestion of every future Drive file.
- Verbatim bulk import of Amy's scripts or emails.
- Allowing Office Coordinator to send email directly.
- Allowing Leg Managers to edit package pricing, discounts, or source facts.
- Treating a signed event contract as a new universal package template.
- Automatically resolving conflicting source values.
- Automatically creating profiles from every attended-calendar row.
- Requiring a daily checklist for every day of a multi-day event in Release 1.
- Replacing the existing event wrap-up, maintenance, resource, package, or profile systems.
