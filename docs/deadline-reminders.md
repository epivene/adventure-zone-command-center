# Deadline reminders and automation rules

The owner workspace has a Reminders header link (including mobile), a Today section for the next 30 days, and a Dates & deadline reminders editor on each profile. Settings live at /settings/reminders. Existing cream/raspberry tokens and navigation/filter components are retained.

## Existing data reused

- Organization application_deadline.
- Verified booking public start through booking_date_endpoint; unknown imported/access dates are not promoted to event dates.
- Active confirmed/expected event_date_facts, labeled with their confidence.
- Annual festival edition startsOn, applicationDeadline, foodDeadline, performanceDeadline.
- Unpaid, non-draft invoice balance_due_date.
- Open follow_ups.due_at, including booking/contact-linked follow-ups.
- Activities and call sessions for inactivity; future calendar activities and deleted activities do not count.

New profile_deadlines rows allow nullable standalone event/vendor/balance/next-action dates without a booking or invoice. Adding a dated next action reuses follow_ups. Existing source dates are edited through their original workflow, except the existing application deadline is editable in this panel. Reminder offsets are independent metadata, nullable with 14/7 defaults; an empty list disables advance reminders. Completing a dated item suppresses reminders only for that date, not a later changed date.

Profiles without bookings, or with an open prospect booking and no definite active booking, qualify for inactivity. Profiles whose only bookings are declined/canceled/completed do not qualify. Consolidated profiles are excluded. Activity means logged activity or call records, not simply opening a profile. This does not fetch live Gmail history.

## Rules and deduplication

Three default rules are enabled: advance reminders (14/7), passed deadlines, and 21-day inactivity. The no-code editor also supports booking-status changes and actions for notification, badge, next action, and the disabled email hook. This app stores workflow status on bookings, so that is the profile status used by the status-change trigger.

Each rule/source/date/threshold has a durable receipt. Catch-up uses the closest elapsed advance threshold; it does not flood all missed thresholds. Overdue and inactivity receipts remain stable until their source changes. Dismissals persist. Disabling a rule immediately removes it from displayed counts. Next-action effects only create/update engine-owned follow-ups, never overwrite manual follow-ups; obsolete engine-owned follow-ups are completed, not deleted. No default rule creates a follow-up automatically.

Rules changing status use additive database triggers to capture booking status transitions. Only transitions since the rule's last configuration change are eligible. All routes use the existing owner middleware; no roles/scopes/permissions change.

## Render scheduling and rollout

The checked-in Render blueprint has a free Express web service and a Vite static site, not a dedicated cron/worker service. The API already runs background loops. This feature reuses that pattern: evaluate at worker start and every 15 minutes, after existing schema startup, with a PostgreSQL transaction advisory lock across replicas. An owner app-load POST also evaluates and then reads reminders; the open app refreshes every five minutes. Evaluations share a 60-second database throttle. Owner edits invalidate it.

No paid add-on or external scheduler is provisioned. If the Render API sleeps, no background checks happen during sleep; the next wake/app load catches up. This is not an exact-time delivery guarantee. To require checks while the service is asleep, hosting/scheduling would need a separately approved always-on arrangement.

The additive 20261014_deadline_rules.sql migration runs via both existing migration entry points. Deploy API and frontend together. Existing date columns and records are not backfilled, overwritten, or deleted. To roll back behavior, turn off rules and disable the worker in code; retain its tables and audit history.

## Email hook — OFF by default

DEADLINE_EMAIL_ENABLED=false is explicit in render.yaml. No SMTP/API provider is configured, no existing Gmail sending is used, and the UI never accepts or exposes secrets. Settings marks where future email setup belongs.

A future server adapter implements ReminderEmailProvider.send with an idempotency key and an owner reminder recipient. Inject it into DeadlineRulesService and enable the flag only after configuration. Its worker can call dispatchEmailHooks. Only pending receipts are claimed; uncertain sends are not blindly retried. Old disabled receipts are not retroactively mailed. A provider key alone does not wire an adapter.

No email key is needed for in-app reminders.
