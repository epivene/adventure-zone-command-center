---
name: Boss event visibility boundary
description: Defines when bookings and event information become visible in the Boss workspace.
---

Boss must not create, browse, edit, or assign bookings. Event information becomes visible to Boss only after Desie assigns the booking to a travel leg, and it should appear in the context of that leg.

**Why:** Desie owns booking intake and leg assignment. The Boss workspace is for operating assigned legs, not for viewing the broader sales and booking pipeline.

**How to apply:** Do not add Boss booking lists, detail pages, mutations, or unassigned-event queries. Scope Boss event-derived data to records tied to a leg and show assigned events under Schedule legs.