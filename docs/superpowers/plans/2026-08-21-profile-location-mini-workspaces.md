# Profile Location Mini-Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each Profile Location as an expandable mini-profile with its own contacts, notes/history, bookings, and follow-ups, while preserving the parent Profile roll-up.

**Architecture:** Reuse the existing `/organizations/:id/locations` APIs and `DrizzleLocationRepository` detail model. Add a focused frontend Locations panel that lazy-loads location detail and scoped notes; mount it on the full Profile page. No database or API contract changes are required.

**Tech Stack:** React, TypeScript, existing authenticated API helpers, existing organization-location routes, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-profile-location-mini-workspaces-design.md`

## Global Constraints

- No database migration.
- Do not reassign records automatically.
- Location-specific data must remain visibly attributed to its location.
- Parent Profile remains the roll-up view.
- Event Families remain separate Profiles, not locations.

---

### Task 1: Location panel behavior

**Files:**
- Create: `artifacts/adventure-zone/src/components/profiles/profile-locations-panel.tsx`
- Test: `artifacts/adventure-zone/src/components/profiles/profile-locations-panel.test.tsx`

- [ ] Define summary/detail/note API expectations.
- [ ] Implement lazy location summary/detail/note loading.
- [ ] Render contacts/history/bookings/follow-ups.
- [ ] Wire location-scoped notes through existing note CRUD routes.
- [ ] Keep unassigned parent-profile records out of an individual location panel.

### Task 2: Mount on Profile page

**Files:**
- Modify: `artifacts/adventure-zone/src/components/profiles/profile-details-card.tsx`
- Test: `artifacts/adventure-zone/src/pages/EventProfilePage.locations-panel.test.ts`

- [ ] Require Locations panel from the full Profile details area.
- [ ] Mount the panel with the current Profile ID.
- [ ] Preserve existing Profile details layout.

### Task 3: Verification and PR

- [ ] Review diff for schema/API changes (expected: none).
- [ ] Verify endpoints are existing location routes only.
- [ ] Inspect available CI; do not claim pass if jobs fail before execution.
- [ ] Open draft PR with behavior and verification status.
