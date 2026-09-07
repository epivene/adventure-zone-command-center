---
name: Boss event visibility boundary
description: Defines what booking and event information is visible or actionable in the Boss workspace.
---

Boss may see confirmed and potential booking schedule information on the shared calendar and route map so they have the full planning picture. Those planning views are read-only: Boss must not open booking details, create bookings, edit booking/profile data, resolve admin calendar reviews, or retry/administer map data.

Desie still owns booking intake and initial leg assignment. Once Desie assigns an event to a travel leg, Boss may reassign that event between active legs from the leg-management area. Unassigned potential events remain visible for planning but cannot be assigned or otherwise changed by Boss.

**Why:** Boss needs route-wide visibility without gaining access to Desie's sales and booking workflow.

**How to apply:** Use safe schedule/map projections for Boss, omit private booking fields, render booking cards and map popups without Admin booking links or mutations, and keep the existing assigned-event-only guard on leg reassignment.
