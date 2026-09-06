---
name: Boss event visibility boundary
description: Defines when bookings and event information become visible in the Boss workspace.
---

Boss must not create, broadly browse, or edit bookings. Event information becomes visible to Boss only after Desie initially assigns the booking to a travel leg, and it should appear in the context of that leg. Once visible, Boss may reassign that event between active legs.

**Why:** Desie owns booking intake and leg assignment. The Boss workspace is for operating assigned legs, not for viewing the broader sales and booking pipeline.

**How to apply:** Do not add Boss booking lists, detail pages, general booking mutations, or unassigned-event queries. Scope Boss event-derived data to records tied to a leg, show assigned events under Schedule legs, and allow only active-leg-to-active-leg reassignment.