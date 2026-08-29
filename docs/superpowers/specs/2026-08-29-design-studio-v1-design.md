# Adventure Zone Design Studio V1 Design

**Date:** 2026-08-29

## Goal

Build a private, Adventure Zone–branded design studio inside the Command Center so staff can create, reuse, personalize, send, print, sign, and archive business materials without depending on Canva, Brevo, or disconnected files.

The Design Studio should feel like one coherent product while supporting two different editing models:

1. **Creative Canvas** for free-form visual work.
2. **Document Builder** for responsive and structured documents.

The Command Center remains the source of truth for event, booking, contact, package, and brand data. Designs can use that data through smart fields without silently mutating already-used or already-signed outputs.

---

## 1. V1 creation types

V1 supports six primary creation types plus blank designs:

- **Event flyer**
- **Social post**
- **Designed email**
- **Brochure**
- **Review request**
- **Contract**
- **Blank design**

These are additive. No type replaces another.

### Output expectations

- Flyers: PNG, JPG, print-ready PDF.
- Social posts: PNG/JPG in common social aspect ratios.
- Emails: responsive HTML preview and Gmail draft creation.
- Brochures: multi-page or tri-fold PDF and image export where useful.
- Review requests: email, printable handout, and QR-card formats.
- Contracts: preview PDF, secure signing version, and final locked signed PDF.

---

## 2. Design Studio home

Add **Marketing → Design Studio** as the main entry point.

The Studio home contains:

### Create New

- Flyer
- Social Post
- Email
- Brochure
- Review Request
- Contract
- Blank Design

### Templates

Browse templates by either:

- **Format**: flyer, social post, email, brochure, review request, contract.
- **Purpose**: new outreach, follow-up, confirmed booking, public event promo, renewal, review request, etc.

Also provide:

- Search
- Favorites
- Recently used
- My templates
- Admin-approved templates

Templates can carry tags such as Adventure Zone, Pirate’s Rebellion, Warrior’s Playground, Office-safe, Admin-only, Contract, Social, and other useful categories.

### Brand Library

Shared assets and reusable content. See Section 6.

### My Designs

- Drafts
- Ready
- Used/Sent
- Attached to events
- Archived
- Version history

### Contracts

A dedicated status view for signing workflows:

- Draft
- Sent
- Viewed
- Organizer Signed
- Awaiting David
- Fully Signed

### AI Create

- Start from an event/profile
- Start from a prompt
- Improve an existing design
- Rewrite copy
- Suggest layouts
- Repurpose into another format

---

## 3. Shared Design Project model

Every design type is stored as a **Design Project** with shared metadata:

- Project ID
- Title
- Design type
- Linked event/profile/booking, optional
- Package collection
- Owner/creator
- Template used, optional
- Current editable version
- Project status
- Attached assets
- Smart fields
- Permission scope
- Locked elements/blocks
- Created/updated timestamps
- Used/sent/exported history

### Project states

For ordinary creative and document projects:

**Draft → Ready → Used/Sent → Archived**

Contracts add signing states described later.

### Source vs output

The editable Design Project is the source artifact. PDFs, images, HTML, and signed documents are outputs generated from a particular version.

This prevents staff from treating exported PDFs or screenshots as the editable master.

---

## 4. Two editor modes

The Studio has two editors sharing the same project model, assets, event data, template system, and permission system.

### 4.1 Creative Canvas

Used for:

- Flyers
- Social posts
- Brochures
- Blank visual designs

V1 is intentionally “Canva-ish” rather than a minimal image editor.

Required V1 tools:

- True free-drag placement
- Move
- Resize
- Rotate
- Text
- Images
- Shapes
- Backgrounds
- Layers panel
- Group/ungroup
- Lock/unlock
- Alignment guides
- Snapping
- Crop
- Transparency
- Duplicate
- Delete
- Undo/redo
- Multi-page designs

### 4.2 Full mobile parity

Mobile is not a cut-down viewer.

The Creative Canvas must support the same practical capabilities on phone as desktop/tablet through touch-friendly controls:

- Pinch zoom
- Two-finger pan
- Drag
- Touch-sized resize handles
- Rotate handles/gestures
- Tap to select
- Long-press context actions where appropriate
- Snapping guides
- Layers access
- Undo/redo
- Collapsible bottom tool tray

Desktop/tablet may use side panels while mobile uses drawers and bottom sheets, but the underlying feature set stays equivalent.

### 4.3 Document Builder

Used for:

- Designed emails
- Review requests
- Contracts

The Document Builder uses responsive or print-safe structured blocks instead of arbitrary free-position elements.

Example blocks:

- Header
- Logo
- Hero image
- Text
- Button
- Image + text row
- Package section
- Event details
- Contact details
- Testimonial
- Star rating prompt
- QR code
- Divider
- Footer
- Legal section
- Initial field
- Checkbox field
- Signature field
- Date-signed field

Emails should remain responsive in Gmail and on mobile. Contracts should remain reliable and printable. Creative freedom must not break delivery or legal layout.

---

## 5. Companion design / repurposing

A finished or in-progress project can create a matching project in another format.

Examples:

- Flyer → Facebook post
- Flyer → designed email
- Email → matching flyer
- Brochure → social post
- Completed event promo → review card

A **Create matching** or **Repurpose this design** action reuses:

- Event/profile association
- Brand collection
- Photos
- Colors
- Approved wording
- Smart fields
- General visual theme

AI may propose the new layout, but the result is always an editable draft.

---

## 6. Brand Library and assets

Use a combined company-wide and package-specific asset model.

### 6.1 Company library

Company-wide assets include:

- Main Adventure Zone logos
- Core colors
- Approved fonts
- Shared contact information
- Shared insurance wording
- Standard footer information
- General stars, banners, shapes, and decorative assets
- General event/carnival photography
- Approved reusable text blocks

### 6.2 Package collections

Separate child collections for:

- **Adventure Zone**
- **Pirate’s Rebellion**
- **Warrior’s Playground**

Package collections may include:

- Package-specific photos
- Logos or badges
- Package descriptions
- Accent colors
- Reusable promotional blocks
- Package-specific imagery and decorative pieces

When a project is linked to a booking with a known package, relevant package assets should be surfaced first without hiding the master company library.

### 6.3 Asset sources

The editor can use assets from:

- Device uploads
- Shared Brand Library
- Package collection
- Photos/files already attached to the event/profile
- Project-only uploads

A project linked to an event gets a **This Event** asset section automatically.

When uploading a new asset, the user can choose:

- **Use only here**
- **Save to Brand Library** if their role permits it

---

## 7. Smart event/profile fields

Support both auto-fill and manual insertion.

A project linked to an event/profile/booking can automatically surface fields such as:

- Event name
- Event dates
- City/state
- Venue
- Event address
- Contact name
- Contact email/phone
- Package(s)
- Price
- Deposit
- Assigned leg
- Company contact information
- Other approved booking/profile values

The same fields can also be inserted manually from an **Insert data** control.

### Smart field states

Each inserted field can be:

- **Live** — reflects the current source value.
- **Overridden** — intentionally customized for this design.
- **Outdated** — source data changed after the design version was created.

When source data changes, the Studio warns the user and offers an update. It does not silently change already-approved, exported, sent, or signed material.

---

## 8. Template locking

Templates can optionally contain locked elements or blocks.

This supports both creative freedom and controlled branding/legal content.

Examples:

- Flyer: lock logo and footer; leave headline, event info, and photos editable.
- Social template: lock brand badge and safe margins; allow copy/image changes.
- Email: lock required footer while allowing content sections to move.
- Contract: lock legal clauses and payment wording while allowing booking-specific fields.

Admins decide what is locked per template. Permissions are enforced in the editor, not merely communicated as guidance.

---

## 9. Role-based permissions

### 9.1 Admin

Admins can:

- Create/edit all design types
- Manage master Brand Library
- Manage package collections
- Create/edit/publish/archive master templates
- Lock/unlock template elements
- Edit approved contract wording
- Manage contract signing flows
- Manage permissions
- Export/send/use any eligible design

### 9.2 Office Coordinator

Office Coordinators can:

- Create and edit flyers, social posts, brochures, emails, and review requests
- Use approved brand assets and templates
- Create coordinator-owned templates where permitted
- Generate Gmail drafts
- Prepare contracts from approved templates
- Fill editable event-specific contract fields

They cannot alter locked legal language or master brand controls unless separately authorized.

### 9.3 Leg Manager

Leg Managers get narrower access tied to their operational needs and assigned events.

V1 may allow them to:

- Use approved event-specific flyer/social templates
- Generate review-request materials
- Create simple event announcements from approved templates
- Access only materials and events within their scope

They cannot edit master templates, contract wording, company brand rules, or global Brand Library assets.

### 9.4 External signer/reviewer

External organizers do not enter the Design Studio.

They receive only the appropriate secure external page, such as:

- Contract signing page
- Review submission page

---

## 10. Optional approval controls

Approval requirements are configurable by template or design category.

Examples:

- Ordinary office flyer: no approval required.
- Major campaign artwork: approval required.
- Contract: governed by contract workflow.
- Locked company master template: admin-controlled.

This avoids turning every minor social image into a management bottleneck while still protecting sensitive materials.

---

## 11. Designed email behavior

Designed emails are built from responsive blocks, not free-position canvas elements.

The system should support:

- Desktop preview
- Mobile preview
- Subject line
- Personalization/smart fields
- Image blocks
- Buttons/links
- Responsive columns where email-client-safe
- Shared footer
- Test preview
- Gmail draft creation

The Command Center prepares the email; Gmail remains the delivery surface.

The system must not silently send an email merely because a design is marked Ready.

---

## 12. Review request workflow

Review requests connect Design Studio presentation to the existing event/manager review concept.

After an event, an approved review-request project can generate:

- Branded email
- Printable card
- QR card

The organizer opens a simple external review page tied to the correct event.

The review system owns the collected data:

- Star rating
- Organizer comments
- Event identity
- Relevant leg-manager association
- Submission timestamp

Design Studio controls the presentation around the request, not the review-data schema itself.

Submitted reviews attach to the event/profile and feed the relevant manager/event review views.

---

## 13. Contract editor and protected document model

Contracts use the Document Builder with stricter rules.

### 13.1 Protected blocks

Admins can lock:

- Legal clauses
- Insurance wording
- Payment terms
- Cancellation terms
- Required notices
- Company identity/footer

Editable event-specific fields may include:

- Event name
- Organizer/contact
- Dates
- Hours
- Venue/address
- Package(s)
- Price
- Deposit
- Amount due
- Approved special terms

### 13.2 Contract preview

Before sending, staff can preview the exact generated contract PDF/version.

No signer should ever sign a document whose final rendered content differs from the reviewed version.

---

## 14. Electronic signature workflow

The standard Adventure Zone countersigner is **David**.

Default workflow:

**Draft → Ready to Send → Sent → Viewed → Organizer Signed → Awaiting David → Fully Signed**

### 14.1 Organizer signing

The organizer receives a secure signing link that works on phone or desktop without requiring a Command Center account.

The signing page can include:

- Required signature
- Required initials
- Required checkboxes
- Date-signed field
- Read-only contract content

### 14.2 David countersignature

After the organizer completes their required fields, David receives the countersign request.

David signs the same immutable contract version.

The contract becomes **Fully Signed** only when all required organizer and David fields are complete.

### 14.3 Finalization

When fully signed:

- Freeze the executed version.
- Generate the final signed PDF.
- Save the final PDF to the event/booking profile.
- Record signer identities and timestamps.
- Update the relevant contract status in the booking.
- Clear or complete related “waiting on contract” work when appropriate.

### 14.4 Changes after send

Important changes after sending—such as price, dates, package, legal language, or payment terms—must not alter the live signing request in place.

The system creates a new contract version and marks the old request as replaced/voided as appropriate.

### 14.5 Audit trail

Keep an audit history for:

- Version sent
- Send timestamp
- View timestamp where available
- Organizer signature timestamp
- David signature timestamp
- Finalization timestamp
- Replacement/void events
- Final signed document identity

---

## 15. AI assistance

V1 supports AI for **copy and layout suggestions**.

Example actions:

- “Make a flyer for this event using Adventure Zone assets.”
- “Turn this event profile into a Facebook post.”
- “Create a polished follow-up email.”
- “Give me three headline options.”
- “Make this brochure cleaner.”
- “Suggest a better layout using these photos.”
- “Repurpose this flyer into an email.”

### AI guardrails

AI output is always an editable draft or suggestion.

AI must not silently:

- Send email
- Publish social content
- Export and mark material as used
- Sign a contract
- Change locked legal clauses
- Change locked brand content
- Override smart event data without user confirmation

AI must respect template locks and role permissions.

---

## 16. Version history and autosave

Every project autosaves.

Maintain restoreable version history so users can recover earlier work.

### Used/sent version preservation

When a project is:

- Exported for use
- Sent as an email
- Sent as a review request
- Sent for signature
- Fully signed

record which exact version was used.

Later edits apply to the working project, not the historical output.

### Mobile/offline behavior

Mobile editing must aggressively autosave.

If the network drops:

- Queue local edits safely.
- Show sync state.
- Sync when connectivity returns.
- Avoid silently discarding unsynced edits.

Conflict behavior must prefer explicit user review over silently overwriting a newer server version.

---

## 17. Event/profile history integration

Projects linked to an event automatically contribute to that event’s history.

Example profile history:

- 2026 Meeteetse flyer created
- Flyer version 4 exported
- Booking follow-up email design used
- Contract version 2 sent
- Organizer signed
- David countersigned
- Final signed contract stored
- Review request sent
- Organizer review received

This provides one place to understand which collateral and documents were actually used for an event.

---

## 18. Finished-work actions

Actions depend on project type.

### Flyer / Social / Brochure

- Export PNG
- Export JPG
- Export PDF
- Save as template
- Duplicate
- Create matching design
- Attach to event
- Archive

### Email

- Desktop preview
- Mobile preview
- Test preview
- Create Gmail draft
- Save as template
- Create matching design
- Archive

### Review Request

- Create Gmail draft
- Generate printable PDF
- Generate QR card
- Track request/review state
- Archive

### Contract

- Preview PDF
- Send for signature
- Track view/signature status
- Resend reminder
- Replace with new version
- View audit history
- Download final signed PDF

---

## 19. Suggested V1 architectural boundaries

Keep the system modular so the Canvas, Document Builder, contract signing, and asset library can evolve independently.

### Design Project service

Owns project metadata, versions, status, event linkage, ownership, and permissions.

### Creative Canvas engine

Owns free-position pages and visual element state.

### Document Builder engine

Owns structured blocks, responsive rendering, document-safe rendering, and block-level locks.

### Brand/Asset service

Owns company assets, package collections, event asset projection, uploads, and asset permissions.

### Template service

Owns template metadata, purpose/format tags, favorites, locks, visibility, and approved states.

### Smart Field service

Resolves live booking/profile values and detects outdated/overridden states.

### Render/Export service

Produces PNG/JPG/PDF/HTML outputs from immutable project versions.

### Email handoff service

Creates Gmail drafts from approved email-render output.

### Review Request service

Generates external review requests and connects responses back to event/manager data.

### Contract service

Owns contract versions, protected blocks, send state, signer requirements, David countersigning, audit trail, and final signed artifacts.

### AI Design Assistant

May suggest text/layout changes through explicit editor actions but has no autonomous publish/send/sign authority.

---

## 20. Error and safety behavior

- Failed export does not mark a design Used.
- Failed Gmail draft creation does not mark an email Sent.
- Failed contract delivery does not change the contract to Sent unless delivery was actually accepted by the sending subsystem.
- Failed signature processing never discards an existing signature record.
- A missing event/profile field is shown as unresolved rather than guessed.
- A missing or deleted asset produces a visible broken-asset warning before export.
- Locked elements remain locked across duplicate, repurpose, and AI actions unless permissions explicitly allow otherwise.
- Contract legal blocks cannot be modified by ordinary coordinator or manager roles.
- No sent/signed historical artifact silently updates when source profile data changes.
- Offline edits expose their pending-sync state.

---

## 21. V1 testing requirements

Tests should cover at least:

1. Admin can create every supported project type.
2. Office Coordinator cannot modify locked contract legal blocks.
3. Leg Manager cannot modify master Brand Library assets.
4. Template locks survive duplication.
5. Template locks survive AI-assisted repurposing.
6. A linked event auto-fills smart fields.
7. A manually overridden field remains overridden when source data changes.
8. A live field becomes Outdated when the source changes after the project version is created.
9. Already-used output remains frozen after source/profile changes.
10. Creative Canvas supports page creation, element movement, resize, rotation, grouping, locking, and undo/redo.
11. Creative Canvas project data is usable from both desktop and mobile editor shells.
12. Document Builder email renders responsive HTML without absolute-position layout dependence.
13. Email project can create a Gmail draft without sending it.
14. Review-request QR/card resolves to the correct event.
15. Submitted review attaches to the correct event and manager context.
16. Contract template protects locked clauses.
17. Organizer can sign without a Command Center account.
18. David cannot countersign a replaced contract version.
19. Contract becomes Fully Signed only after all required organizer fields and David’s signature are complete.
20. Final signed PDF references the exact signed contract version.
21. Material contract changes create a new version rather than modifying a sent signing version.
22. Project autosave restores recent work.
23. Offline/pending edits do not silently disappear.
24. Export failure does not mark a project as Used.
25. Repurpose creates an editable new project with shared event data and assets.
26. AI suggestions cannot edit locked legal/brand blocks.
27. AI suggestions cannot send/publish/sign without user action.
28. Event history records the exact design version that was used/sent/signed.

---

## 22. V1 acceptance criteria

V1 is successful when:

- Staff can create flyers, social posts, emails, brochures, review requests, and contracts without leaving the Command Center for routine design work.
- Free-form creative work feels usable on phone as well as desktop.
- Emails and contracts remain structurally reliable because they use blocks instead of free positioning.
- Brand assets are reusable across all formats.
- Package-specific assets are easy to find.
- Event/profile information can populate designs without repetitive retyping.
- Source changes never silently rewrite already-used collateral.
- Admins can protect logos, brand elements, and legal content through locks.
- Office Coordinators can produce useful materials without gaining dangerous contract/template permissions.
- Leg Managers can access only approved, scoped materials.
- AI materially speeds up copy/layout work while remaining suggestion-only.
- A design can be repurposed into another format without starting over.
- Review requests feed actual event/manager review data.
- Contracts support organizer signing followed by David countersigning.
- Final signed contracts are frozen, auditable, and attached to the booking/profile.
- Gmail drafts can be created from designed emails without introducing an external email-design platform.
- Every exported, sent, reviewed, or signed item is traceable back to the project/version used.

---

## 23. Explicitly deferred beyond V1

Do not block V1 on advanced graphic-design features such as:

- Background removal
- Complex image filters
- Curved text
- Advanced masks/frames
- Generative image editing inside the canvas
- Animation/video editing
- Real-time multi-user collaborative editing
- Public template marketplace
- Automated social-network publishing
- Unrestricted AI autonomous actions

The architecture should leave room for these later without making V1 depend on them.
