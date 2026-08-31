# Design Studio — In-App Editor + Real Canva Handoff

## Goal

Replace the current stripped-down Canva handoff page with a real, mobile-friendly visual editor inside Adventure Zone Command Center, while preserving an optional one-click path that converts the current design into a real editable Canva design and opens it there.

The user should never have to copy/paste design text into Canva.

## Product Principle

Command Center is the primary editor and source of truth for Adventure Zone design projects.

Canva is an optional continuation environment.

A design must remain fully useful even if Canva is unavailable, disconnected, over quota, or never used.

## Core User Flow

1. Open Design Studio.
2. Choose one of the Adventure Zone visual starter templates.
3. A real editable project is created from that template.
4. The project opens directly on a canvas inside Command Center.
5. The user edits text, photos, shapes, stickers, position, scale, rotation, layers, and colors.
6. Changes autosave to the existing Design Studio project.
7. The user may export/download directly from Command Center.
8. Optional: tap **Open in Canva**.
9. Command Center exports the current design to a Canva-importable file while preserving text/vector structure where practical.
10. The backend imports that file into Canva through Canva Connect.
11. Canva returns a Canva design identifier/edit URL.
12. Command Center stores that Canva link on the Design Studio project and opens it.
13. Future taps become **Continue in Canva** and reopen the same Canva design.

## Explicit Non-Goals

- Do not recreate every Canva feature.
- Do not require Canva Pro, Brand Kit, Brand Templates, Autofill, Magic Resize, or paid-only Canva features.
- Do not make Canva the source of truth for project content.
- Do not depend on Canva AI design generation.
- Do not use copy/paste as the normal Canva workflow.
- Do not restore the old desktop-heavy three-panel editor UI.

## In-App Editor — V1 Feature Set

### Selection and Transform

Every editable element can be selected directly on the canvas.

Selected elements support:
- drag/move
- resize from handles
- rotate
- duplicate
- delete
- lock/unlock
- bring forward
- send backward
- bring to front
- send to back

Touch interactions must work on phones and tablets.

### Text

Text elements support:
- edit text inline or through a contextual editor
- font size
- bold
- italic
- text color
- alignment
- line height
- text box width
- rotation

Font-family selection may be limited in V1 to a curated set that is already supported reliably by the app/export path.

### Photos and Images

Image elements support:
- replace photo
- choose from Adventure Zone design assets
- upload a new image
- move
- resize
- rotate
- fit/fill behavior
- basic crop positioning
- duplicate/delete

The real Adventure Zone attraction photos supplied for the current starter set should be part of the reusable image library.

### Shapes and Stickers

V1 includes reusable Adventure Zone-friendly elements:
- rectangle
- circle
- star
- arrow
- location pin
- speech/price bubble
- brush-stroke style banner
- sticker-like outlined block

Users can change fill color on simple shapes.

### Undo / Redo

The editor maintains local undo/redo history for canvas operations.

Undo/redo history does not need to persist between sessions in V1.

### Zoom and Mobile UX

The canvas supports:
- zoom in/out
- fit to screen
- pan when zoomed

Mobile layout uses:
- canvas as the primary surface
- compact top bar for back/save/undo/redo
- contextual bottom toolbar based on selected element

Do not bring back permanent Layers and Inspector sidebars on mobile.

A layers sheet/drawer may be opened on demand.

## Template Model

The Adventure Zone starter templates must become real canvas documents, not screenshots and not text prompts.

Each template is composed of editable nodes such as:
- text
- image
- shape
- sticker/decorative shape

The current five starters remain:

1. Big Day Event Flyer
2. We Bring the Action Social Post
3. Open Date Booking Promo
4. Epic Packages One-Sheet
5. Big Day Review Request

Their visual direction follows the user's preferred Meeteetse flyer:
- black poster base where appropriate
- Adventure Zone yellow / hot pink / white / black palette
- large Adventure Zone logo
- brush-stroke labels
- crooked white-bordered photo collage
- stars
- arrows
- sticker and bubble shapes
- oversized event/date/location blocks
- highly energetic carnival-poster feel
- real Adventure Zone attraction photography

## Existing Editor Code Reuse

The repository still contains the previous Design Studio canvas/editor infrastructure, including the freeform canvas model and transform-related components.

Reuse working behavior where it is sound, especially:
- canvas document normalization
- node model
- transform/select behavior
- undo/redo logic
- asset resolution
- project save/update API

Do not restore the old UI wholesale.

The new editor should be a simpler shell around reusable low-level editor logic.

## Project Persistence

The existing `design_projects.canvas` field remains the persisted canvas source of truth.

A project stores:
- project metadata
- content/copy where still useful
- editable canvas JSON
- design status
- linked business context
- Canva design metadata when Canva has been used

Autosave should update the project after a short debounce.

Existing immutable historical/version behavior should remain intact where it already protects sent/used outputs.

## Canva Metadata

Do not store Canva state as ad-hoc note lines long term.

Add structured Canva project fields or a dedicated related record for:
- Canva design ID
- Canva edit URL or reconnectable design reference
- last Canva import timestamp
- Canva import status
- optional source version identifier

The Canva URL itself may be temporary, so the durable Canva design ID should be preferred when the API allows regeneration of a fresh edit URL.

## Canva Connect Integration

The application uses a real Canva Connect integration with OAuth.

Required behavior:
- connect Canva account
- securely store OAuth credentials/tokens server-side
- refresh tokens when required
- never expose Canva client secrets in browser code
- request only the scopes needed for design import/create/read workflows

The app must show a clear disconnected state if Canva has not been connected.

Canva remains optional; all in-app editing continues to work without it.

## Open in Canva Flow

### First Export

When the user taps **Open in Canva** for a project with no Canva design yet:

1. Save pending Command Center edits first.
2. Render/export the current canvas to a Canva-supported import format.
3. Prefer a format that preserves editable text/vector structure better than a flattened image.
4. PDF is the initial target format unless implementation testing demonstrates a better supported format from our canvas renderer.
5. Backend submits the file through the Canva design-import flow.
6. Poll or await the import result according to Canva's API requirements.
7. Persist returned Canva design metadata.
8. Open Canva's edit URL.

### Existing Canva Design

When a Canva design ID already exists:
- button label is **Continue in Canva**
- retrieve or regenerate a current Canva edit URL if necessary
- open the existing Canva design
- do not create a duplicate design on each click

### Re-export After Command Center Changes

V1 does not attempt bidirectional live synchronization.

If the user edits the Command Center version after a Canva design was already created, show a small status such as:

> Command Center has newer changes than the Canva copy.

Offer:
- **Open existing Canva version**
- **Create new Canva copy from current version**

Do not silently overwrite the user's existing Canva design.

## Canva Import Fidelity

A flattened PNG is not acceptable as the default Canva handoff because it destroys editability.

The export implementation should preserve as much as practical:
- text as text
- images as image objects where the import format supports reconstruction
- vector/shape boundaries

Exact element-for-element fidelity cannot be guaranteed because Canva controls import reconstruction.

The product should describe this as:

> Open an editable Canva copy

rather than promising perfect one-to-one round-trip synchronization.

## Direct Export from Command Center

The in-app editor must also support output without Canva.

V1 export targets:
- PNG
- PDF

Export uses the current saved canvas and includes images, text, and decorative shapes.

## Error Handling

### Canva disconnected

Show:
- **Connect Canva**
- explanation that Canva is optional

Do not block editing or Command Center export.

### Canva import fails

Keep the Command Center project unchanged.

Show a retryable error and preserve the exported source artifact long enough for a retry where practical.

### Canva quota or AI-generation errors

Irrelevant to this workflow.

The integration must not rely on Canva AI generation APIs.

### Missing/expired Canva edit URL

Use durable Canva design metadata to request/regenerate a valid navigation URL when supported.

## Data Safety

- Autosave before Canva export.
- Never discard the Command Center canvas after successful Canva import.
- Never treat Canva import success as permission to delete the source project.
- Existing Design Studio delete/archive protections remain separate from Canva deletion.
- Do not delete a Canva design when a Command Center project is deleted unless a future explicit destructive action is designed and confirmed.

## Testing Strategy

### Unit tests

Cover:
- starter templates produce valid editable canvas documents
- transform operations
- text editing
- image replacement
- layer ordering
- undo/redo
- autosave serialization
- Canva-state decisions (first import vs continue vs create-new-copy)

### Component tests

Cover:
- selecting an element exposes the correct contextual toolbar
- mobile bottom toolbar behavior
- deleting/duplicating elements
- zoom controls
- Open in Canva disconnected state
- Open in Canva existing-design state

### Server tests

Cover:
- Canva OAuth callback/token storage
- project-scoped Canva metadata
- import request creation
- import polling/result handling
- failure does not alter canvas source of truth
- newer Command Center version detection

### Manual acceptance

On Android/mobile:
- open a starter
- edit event name
- replace a photo
- drag a text box
- rotate a sticker
- undo/redo
- reload and verify autosaved state
- export PNG/PDF
- connect Canva
- tap Open in Canva
- confirm a real Canva design opens
- confirm the design is materially editable in Canva
- return to Command Center and confirm the Canva link remains attached

## Success Criteria

The feature is complete when:

1. A starter opens as a real editable canvas inside Command Center.
2. The user can perform common Canva-like edits without leaving the app.
3. The experience is usable on an Android phone.
4. The design autosaves in Command Center.
5. The user can export PNG/PDF without Canva.
6. **Open in Canva** creates and opens a real Canva design from the current visual design, not copied text and not a simple flattened screenshot as the intended default.
7. **Continue in Canva** reopens the previously created Canva design instead of creating duplicates.
8. Canva failure never prevents in-app editing or destroys the Command Center project.
