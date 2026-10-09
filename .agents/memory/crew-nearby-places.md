---
name: Crew nearby-place priorities
description: User's priorities for nearby places on festival profiles and maps.
---

RV parks are the biggest need. Walmarts, mechanics, tire shops, oil-change places, hardware stores, bathrooms, and gas stations are also important to track.

**Why:** The user explicitly named these priorities when requesting FestivalNet-style location maps and nearby accommodations.

**How to apply:** Prioritize RV parks in nearby-place discovery and saved crew stops, while retaining all eight named categories.

Center festival maps on the selected annual venue, never the organizer mailing address. Require staff to confirm a venue pin; changing the annual venue invalidates its old pin and nearby suggestions.

**Why:** The requested festival location belongs to an event edition, while organizer contact information can describe a different place.

**How to apply:** Keep location state year-specific and use an explicit missing-venue state instead of a mailing-address fallback.

Community place listings are suggestions, not confirmed accommodation or parking. Rig fit, hookups and overnight permission start unknown. Never assume Walmart allows overnight parking.

**Why:** A mapped category does not establish suitability for the crew or permission from the property.

**How to apply:** Keep unverified suggestions separate from saved staff-reported facts and notes. Require explicit confirmation before recording affirmative facts; do not silently carry them into another event year.

Community place lookups are deliberately explicit, cached and paced rather than automatic on every profile load. Photon supports the modest venue-search use; public Nominatim must not become a new generic lookup fallback without checking its current policy.

**Why:** Public services have fair-use limits and no uptime guarantee. The Nominatim policy restricts AI-generated generic geocoding services; cached saved records and manual entry keep the CRM usable without provider calls.

**How to apply:** Retain manual pin/stop entry, honest provider-error states, failure backoff and an injectable provider URL. Move to a hosted or managed service before introducing high-volume or automatic lookup.

Use a provider whose policy allows this commercial CRM; do not default to the main FOSSGIS Overpass instance or rotate through hosts to bypass restrictions.

**Why:** The [OSM instance directory](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances) says commercial apps should use hosted/paid service and restricts fast AI-deployment platforms on the main instance. Private.coffee explicitly welcomes any project, but public hosting still has no uptime guarantee.

**How to apply:** Recheck current operator policies when changing providers. The chosen public provider remains replaceable; failures must preserve manual entry and saved crew records.

The user chose to keep manual crew-stop entry for now instead of adding a managed place-search subscription.

**Why:** After reviewing the paid provider options, the user selected “Keep manual stop entry for now.”

**How to apply:** Do not provision a paid nearby-search service without renewed approval. This deferral does not mean automatic nearby searches are reliable or that the user ruled out a subscription permanently.

Manager crew travel is read-only and scoped through a currently assigned booking; its annual edition follows the booking's resolved public-event season, not reservation/setup dates or a caller-selected year. Boss crew reads also require an existing leg assignment.

**Why:** Crew logistics must not expose unrelated annual records or organizer CRM information, and Boss must not bypass Desie's initial assignment.

**How to apply:** Resolve profile and season on the server after checking assignment. Reuse saved annual venue/stops; keep staff editing in the owner profile workflow.
