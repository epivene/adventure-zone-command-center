# Business document organization

## Goal

Make the large business-document library navigable without moving or rewriting stored files.

## Design

- Keep image and video formats out of the regular document views and expose them in a dedicated **Media** view.
- Present regular files in a three-level hierarchy: document type, best available year, then an event/collection name inferred from the existing display name.
- Treat **Needs Review** as the sorting inbox by placing it first and showing a prominent pending-count callout from every regular library view.
- Preserve the existing search, filters, open, edit, and delete actions. Organization is derived in the client, so this phase requires no schema migration and does not alter imported files.

## Derivation rules

- Media is identified from a case-insensitive image or video filename extension.
- Year prefers effective, issue, or expiration metadata, then a year in the name, then creation year.
- Event/collection removes file extensions, years, document-type words, and version words such as `draft`, `signed`, and `revised`. Versions therefore stack together under the same event heading.
- Unrecognized names remain under a readable collection name; an empty inferred name falls back to `General`.

## Verification

- Unit tests cover media classification and type/year/event grouping.
- Page tests cover view separation, hierarchy rendering, the sorting-inbox callout, and all existing document actions and filters.
