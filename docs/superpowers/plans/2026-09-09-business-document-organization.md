# Business document organization

## Goal

Make the large business-document library navigable without moving or rewriting stored files.

## Design

- Keep image and video formats out of the regular document views and expose them in a dedicated **Media** view.
- Present regular files in a compact, collapsible three-level hierarchy: document type, best available year, then a confirmed linked event/profile.
- Treat **Needs Review** as the sorting inbox by placing it first and showing a prominent pending-count callout from every regular library view.
- Preserve the existing search, filters, open, edit, and delete actions. Organization is derived in the client, so this phase requires no schema migration and does not alter imported files.

## Derivation rules

- Media is identified from a case-insensitive image or video filename extension.
- Year prefers effective, issue, or expiration metadata, then a year in the name, then creation year.
- Event folders use labels resolved from confirmed profile, booking, or event-family links. The interface never guesses an event from a filename.
- Unlinked files are collected under one `Needs Sorting` folder instead of receiving hundreds of one-file headings.

## Verification

- Unit tests cover media classification and type/year/event grouping.
- Page tests cover view separation, hierarchy rendering, the sorting-inbox callout, and all existing document actions and filters.
