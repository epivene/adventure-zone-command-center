# Simplified Today Workspace Design

## Goal
Make the Booking Today page feel like a calm daily starting point instead of a dashboard that exposes every available workload at once.

## Principles
- Preserve all existing Today data, calling behavior, profile links, next-step actions, schedule access, trips, and renewals.
- Do not add backend endpoints or change booking business rules.
- The default view should answer: **What should I do next?**
- Normal workload belongs under **My Work**. Exceptional problems surface separately only when they exist.
- **Zero is invisible:** empty categories and zero-warning states should not occupy visual space.
- Lower-frequency information belongs under **Later** or a deliberate drill-down.
- Existing Assistant/profile side-sheet behavior remains available.

## Page hierarchy

### 1. Today header
Show the page title and business-local date. Remove the large aggregate `N things need attention` message and the row of status pills from the primary visual hierarchy.

### 2. Start Here
One prominent card chooses the most useful current action from data already returned by `/today`.
Priority order:
1. overdue follow-ups
2. remaining call/follow-up work
3. contracts requiring work
4. bookings that need a next-step decision
5. upcoming schedule
6. caught-up state

The card contains one primary action plus compact secondary shortcuts:
- Start/continue calling
- Work follow-ups / booking work
- Find opportunities
- View schedule

The card must never manufacture work or use AI to make irreversible decisions.

### 3. My Work
Show compact workload categories instead of several full-size dashboard sections.
- Calls & follow-ups
- Contracts (only when count > 0)
- Needs a decision (only when count > 0)

Only the work category the user opens should reveal its detailed list/workspace. Existing call queue and next-step controls are reused.

### 4. Exceptional attention
Do not repeat ordinary workload counts. Surface only exceptional conditions currently available to Today, such as visible route warnings. If there is no exceptional condition, render no section.

### 5. Coming Up
Show a quiet preview of the nearest current/upcoming event and a direct `View schedule` action. Do not render the full event list by default.

### 6. Later
A collapsed section contains lower-frequency information:
- full current/upcoming event list
- today's trips when present
- renewals

## Non-goals
- No deletion of existing Today features.
- No backend prioritization engine.
- No new AI dependency.
- No route, auth, profile, call, contract, trip, or renewal business-rule changes.
- No changes to Booking/Marketing/Operations workspace boundaries.

## Theme and device behavior
Use existing theme-aware Tailwind/token behavior. The layout must remain usable on mobile first and should not introduce a new device-specific state model.
