# Design Studio Current Template Catalog Design

**Date:** 2026-09-23  
**Status:** Approved through conversation  
**Repository:** `epivene/adventure-zone-command-center`

## Goal

Replace the old Design Studio starters and reusable templates with one controlled, current catalog for Adventure Zone emails, contracts, and proposals. Allow a user working inside an event profile to choose a template, create a profile-owned document, edit it from that profile, and reuse that profile's document in future years without changing completed historical versions.

## Confirmed business facts

| Offering | Current base rate | Attractions | Optional marketing footprint |
| --- | ---: | ---: | ---: |
| Adventure Zone | $9,000 | 10 | 10,000–15,000 sq. ft. |
| Warrior's Playground | $8,000 | 5 | 7,000–10,000 sq. ft. |
| Pirate's Rebellion | $8,000 | 3 | 5,000–7,000 sq. ft. |
| Mini Zone | $5,000 | 5 | 3,000–5,000 sq. ft. |
| Foam Party Add-On | $3,500 | Add-on, not a package | Not treated as a package |

Mini Zone's $5,000 rate was confirmed directly with Dave on 2026-09-23. Pirate's Rebellion and Mini Zone footprints use the newest explicit email figures located during the audit.

Package footprints are not standard contract terms. They may appear in emails or proposals when useful, and may be added to a specific contract only when the event requires an agreed space term.

All general insurance language says **fully insured** and does not state a fixed coverage limit.

## Source-of-truth rule

The active `package_templates` records are the single source for package name, base rate, attraction count, marketing description, and operational requirements. The template catalog stores placeholders and catalog metadata, not duplicate hard-coded package prices.

Foam Party is stored as an approved add-on offer at $3,500 and is never exposed as a fifth package.

When a catalog template is selected, the system resolves current package/add-on data and saves snapshots in the new profile project. Later source changes do not silently rewrite a sent, finalized, or prior-year document.

## Archival rule

On release:

1. Archive every existing Design Studio project that is not already archived.
2. Archive all existing Design Studio reusable templates and existing communication templates.
3. Preserve archived records and versions for audit/history; do not delete them.
4. Seed the replacement catalog with stable catalog keys and revision numbers.
5. Do not show archived projects or templates in ordinary pickers.
6. Archived, sent, used, and finalized documents remain read-only. Reuse creates a new editable draft.

This archive is intentionally global because the owner confirmed there is nothing currently in Design Studio that needs to remain active.

## Replacement catalog

### Email templates

All email templates are polished branded HTML using the approved smaller header/footer, current website/package links, warm professional tone, no em dashes in body copy, and the Foam Party banner below the package section where relevant.

1. General first outreach
2. Past customer: We want to come back
3. Returning customer offer
4. Adventure Zone focused
5. Warrior's Playground focused
6. Pirate's Rebellion focused
7. Mini Zone / smaller event
8. Follow-up: no reply
9. Proposal or contract follow-up
10. After-convention follow-up
11. After-event thank-you and review request
12. Contract ready
13. Signed contract received
14. Deposit received

Subject lines that market the company include “The Adventure Zone” and do not begin with “Let's.” Templates do not claim availability, exact insurance limits, unconfirmed discounts, or event-specific commitments.

### Contract templates

Generate the contract picker from a 3 × 5 matrix:

**Arrangements**

- Guaranteed fee
- Pay-for-play
- Guarantee plus percentage

**Package selections**

- Adventure Zone
- Warrior's Playground
- Pirate's Rebellion
- Mini Zone
- Multi-package/custom

This produces 15 selectable contract starters. Each starts from the current protected contract clauses and exposes only event-specific and negotiated fields for editing. Standard contracts omit package footprints. Foam Party is an optional $3,500 add-on selection.

### Proposal templates

1. Adventure Zone prepaid
2. Warrior's Playground prepaid
3. Pirate's Rebellion prepaid
4. Mini Zone prepaid
5. Pay-for-play
6. Guarantee plus percentage
7. Multi-package/custom

Proposal templates may show current package footprint and attraction count when useful. Foam Party is an optional $3,500 add-on, not a standalone proposal package.

## Profile workflow

A **Design Studio** button on an event profile opens a modal picker without leaving the profile.

The picker has Email, Contract, and Proposal tabs. Choosing a template creates a new Design Studio project linked to the profile's organization and, when available, its primary contact and current booking. The user then opens the normal editor.

The profile shows its linked Design Studio documents grouped as:

- Current drafts
- Final/sent documents
- Previous years

Actions:

- **Edit** opens an editable current draft.
- **Use for new year** duplicates the selected profile document into a new draft, refreshes current package/add-on facts, clears event-specific dates and negotiated terms that must be reconfirmed, and preserves the prior version unchanged.
- **View** opens finalized or historical documents read-only.
- **Replace** follows the existing contract replacement/versioning rules.

The profile link is durable. A document created from a template belongs to that profile even after the global catalog is revised.

## Data model

Extend Design Studio design types with `proposal`.

Add catalog lifecycle metadata to `design_templates`:

- `catalog_key`: stable unique identifier
- `catalog_revision`: integer revision
- `template_family`: email, contract, or proposal
- `state`: active or archived
- `archived_at`

Use existing `design_projects.linked_organization_id`, `linked_contact_id`, and `linked_booking_id` for profile ownership.

Add project metadata sufficient for safe reuse:

- `source_template_id`
- `source_catalog_revision`
- `document_year`

Do not overload notes strings for durable identifiers.

## Server behavior

Add an idempotent current-catalog seeder that upserts by stable catalog key. It may update an active catalog template only when the catalog revision increases.

Add a server-side instantiate endpoint. The client sends template ID, profile organization ID, optional contact/booking IDs, and document year. The server verifies access, loads current package/add-on facts, resolves protected content, creates the linked project and first version atomically, and returns the project.

Project list supports an exact `linkedOrganizationId` filter so profiles load only their own linked documents.

The server validates that supplied contact and booking records belong to the selected organization. Missing optional profile details produce unresolved editable fields, not invented content.

## Interface behavior

The main Design Studio opens on the replacement catalog and clearly separates Emails, Contracts, and Proposals. Old Canva-style marketing starters and archived communication templates are removed from the active surface.

Search operates within the selected catalog and active profile projects. The profile modal supports package and arrangement filters but does not ask for event details before a template can be chosen.

Loading, empty, authorization, creation-failure, and retry states use plain language and preserve the user's current profile context.

## Safety and accuracy

- Template selection never sends an email, contract, or proposal.
- Creating a template instance only creates an editable draft.
- Final/sent versions remain immutable.
- Reuse never edits the prior year in place.
- Prices are resolved from current approved data at draft creation.
- Event dates, customer names, negotiated amounts, percentages, deposits, due dates, and signatures remain event-specific fields.
- Contract sizes are omitted by default.
- Insurance wording remains flexible: “fully insured.”
- Foam Party remains a $3,500 add-on.

## Acceptance criteria

1. No old project or template appears in active Design Studio lists after migration.
2. Archived records remain queryable for history/audit.
3. The catalog contains 14 emails, 15 contract combinations, and 7 proposals.
4. All package displays resolve $9,000 / $8,000 / $8,000 / $5,000 from the current package source.
5. Marketing footprints resolve 10,000–15,000 / 7,000–10,000 / 5,000–7,000 / 3,000–5,000 sq. ft.
6. Contracts omit footprint text unless a user deliberately adds event-specific language.
7. Foam Party appears only as an optional $3,500 add-on.
8. A profile user can open the picker, choose a template, create a linked draft, edit it, and return to it from the same profile.
9. “Use for new year” creates a separate draft and preserves the old document.
10. Archived, sent, used, and finalized documents cannot be edited.
11. Existing autosave revision protection remains intact.
12. Authorization continues to follow the existing Design Studio ownership boundary.

## Out of scope

This release does not send emails automatically, sign contracts automatically, invent event information, change Adobe Sign behavior, or turn Foam Party into a standalone package.
