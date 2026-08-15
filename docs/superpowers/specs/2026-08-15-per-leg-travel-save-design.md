# Per-Leg Travel Save Design

## Goal
Allow each active travel leg to save its own editable details independently. A leg's Save button is disabled until that leg changes. Reordering remains a separate operation with its own Save order action.

## UX
- Each active leg card has a Save button near its editable fields.
- The Save button is disabled while that leg matches its last-saved detail values.
- Saving one leg sends only that leg's name, color, base address, default vehicle, and default MPG.
- A successful save resets only that leg's dirty state and shows a small Saved confirmation on that card.
- Unsaved edits on other legs remain untouched.
- Dragging legs marks only the order as dirty and enables Save order.
- Saving order does not save unsaved detail edits.
- Archive, restore, delete, and add behavior remain separate.

## API
Add a single-leg detail endpoint and a dedicated reorder endpoint. The existing bulk configure endpoint remains for compatibility but the Routes UI no longer uses it for ordinary edits.

## Data integrity
Single-leg detail updates require the leg to exist and be active. Reorder requests must contain exactly the active leg ids once each and preserve a contiguous 1..N order. Archived legs remain after the active block.

## Testing
Add service tests proving a single-leg save changes only that leg and does not reorder, plus reorder tests proving order changes do not alter details. UI state should distinguish per-leg dirty state from order dirty state.