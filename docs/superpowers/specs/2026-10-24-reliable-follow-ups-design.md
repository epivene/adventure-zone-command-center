# Reliable follow-ups and a lean owner workspace

Approved by the owner in conversation on October 24, 2026, including the refinements below.

## Intent

Make the next action visible and durable for active booking work and conversations. Today should open quickly, show missing follow-up plans prominently, and support externally personalized email drafts without internal agent loops.

## Design

Extend existing `follow_ups`, rather than creating a parallel task system. `kind` carries the next-action description and `due_at` its deadline. Add an optional `opportunity_id` association so separate event years are not conflated. Preserve unrelated reminders by default; replacement remains an explicit legacy caller option.

New snooze and completion operations compare exact PostgreSQL revision text after locking the source. Completion requires either a successor action or an explicit no-further-action reason. Reminder changes and their readable profile notes commit together. Connector mutations retain the existing scope checks, request-key idempotency and operation receipts. Changing opportunity status additionally requires `crm:update`.

Today uses four visible buckets: Needs a next step, Overdue, Due today, and Coming up. It shows a persistent missing-plan banner, full counts, per-bucket pagination, event years, and a 3/7-day horizon. The board and its date inputs use America/Denver, including DST. Existing Central-time screens are left unchanged. The older dashboard tools load only when expanded.

COM context contains five recent notes, five saved email subject/snippet pairs, booking status, and an active reviewed HTML template. Template categories map to the requested email purpose. A deterministic preview endpoint renders supplied merge fields, escapes HTML values, and refuses unresolved fields. External COM supplies personalization and uses the existing app-draft and booking-work APIs for saving and progress. No new internal drafting worker or model loop is introduced.

Confirmed app email sends append a concise note and retain an explicit next-action date. Otherwise defaults are four days for quotes/availability, seven for ordinary follow-ups, and twenty-one for post-event contact. These dates can be overridden in Today. Reconciliation retries bookkeeping for sends after activation; it never invokes Gmail sending or rewrites historical sent-email schedules.

Owner booking edits and opportunity status changes to won/lost states require a final decision. The legacy booking-completion path treats an explicit null next action plus a nonblank outcome as the final no-further-action reason. Related opportunity projections and profile notes stay synchronized.

## Execution controls

Internal owner AI endpoints, AI completion clients, and the expensive agent/scout loops are disabled unless `INTERNAL_AI_ENABLED=true`. Legacy Act! migration/recovery mutations and background extraction are frozen unless `LEGACY_ACT_MIGRATION_ENABLED=true`. Existing history, imported CRM records, schema preparation, authentication, Gmail sending/scheduling and scoped external connector services remain available.

## Decisions made during implementation

- Use the existing shared booking-work/app-draft machinery for external drafting progress, rather than introducing another drafting queue.
- Keep additive schema preparation and historical source readers; freeze execution rather than deleting imported source data or shared utilities.
- Use activation time to bound email bookkeeping recovery, avoiding bulk follow-ups on old sends.
- Keep legacy API compatibility while routing new Today work through revision-checked services.

## Verification

PGlite tests cover real SQL, revision conflicts, transactional rollback, explicit-date preservation, multi-year records, final status decisions, connector idempotency and profile notes. React tests cover prominent missing plans, stale refresh, COM context, event-year propagation and final-decision forms. CI performs the broader workspace typecheck and application builds.
