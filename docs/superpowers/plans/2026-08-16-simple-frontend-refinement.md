# Simple Frontend Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refine PR #166 so Profiles and Schedule are calmer, more human-readable, and mobile-friendly while preserving every existing tool and deep route.

**Architecture:** Keep the current slide-in/profile, organization repository, EventCalendar, SchedulePage, and menu primitives. Add deterministic history summarization, progressive-disclosure controls, and a compact mobile calendar presentation without changing backend ownership.

**Tech Stack:** React, TypeScript, Wouter, Tailwind, Radix UI, Vitest/Testing Library.

## Global Constraints

- Hide complexity, not capability.
- Preserve all routes and existing backend behavior.
- Mobile-first.
- Raw ACT/system history remains accessible, but not dominant.
- Menus/popovers must be opaque and readable.

### Task 1 — Profile identity, Open full, Notes-first timeline
- Update `profile-detail-sheet.tsx` and `responsive-detail-sheet.tsx`.
- Add deterministic history-label helper and tests.
- Replace History tab with Notes; put filtered/expandable raw History below Notes.
- Show actual profile name/location/contact/status context prominently.
- Ensure Open full performs a real navigation.

### Task 2 — Opaque menus and reduced visual clutter
- Update dropdown/menu content classes to solid white backgrounds and high z-index where used by Admin/Profile/Manager menus.
- Add visual-contract tests for opaque menu classes.

### Task 3 — Profiles search/filter progressive disclosure
- Refactor `organization-list.tsx` to one search row plus Filters/More filters.
- Hide advanced filters by default and surface active-filter chips.
- Keep all existing query names and URLs.

### Task 4 — Event Families and utilities
- Collapse Event Families by default on `OrganizationsPage.tsx`.
- Move Suggest Families + Find Duplicates into a shared utility section at the bottom.

### Task 5 — Calendar simplification and month-navigation fix
- Make mobile month view a compact 7-column grid with event indicators/counts and selected-day details.
- Keep desktop span layout.
- Add Today button and controlled month synchronization.
- Make Agenda/Upcoming default less verbose and progressively reveal more.
- Add month-cycle regression tests.

### Task 6 — Regression pass
- Verify profile deep links, filters, event family tools, duplicates, calendar month cycling, Schedule map/calendar toggle, and menu route reachability.
- Keep PR draft if CI remains externally blocked.
