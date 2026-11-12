# Correcting a conflicting At-a-glance event date

Research saves deliberately retain a conflicting date as an inactive `needs_review` fact. Appending another note does not replace the active fact. Ordinary profile updates do not contain event dates.

For an explicit owner correction, use `list_app_records` / `read_app_record` with `event_dates` to identify the exact profile, current date and sourced candidate. Read the complete source and verify the event year. Site access dates are separate from operating dates.

1. Call `preview_event_date_correction` with the profile ID and candidate fact ID. Inspect the returned old/new dates, sources and revision.
2. Call `apply_event_date_correction` with that exact revision, an evidence-based reason, a stable request key, and the actual current owner's correction instruction. The instruction must authorize the specific event/date correction; research, cleanup and background instructions are insufficient.
3. Verify the operation receipt and reread the active `event_dates` record. The old fact remains inactive with its original source and a supersession pointer. A receipt is historical; reread after uncertainty.

The preview needs `crm:read`; apply needs `crm:read` and `crm:update`. Revoked connections, consolidated/mismatched profiles, unsourced/unverified candidates and stale revisions are rejected. Retrying an identical request key returns the same committed receipt. Errors roll back dates, note, audit and receipt together.

This path only promotes an existing verified needs-review fact. It does not edit bookings, site access, calendar events, follow-ups, signatures, payment or availability. Booked dates take priority in the app's effective-date resolver: if the displayed date still differs, inspect the booking separately rather than altering it through this tool.

## Release and verification

Deploy the API change, refresh the connector's tool catalog, and verify that both tools are exposed. Test the current owner's exact authorized correction through preview/apply and reread the active fact. A merged PR alone does not establish deployment or completed correction.

The motivating Miles City correction is August 18–21 → August 25–28, 2027; site access is August 23–29. No production data is changed by deploying this code.
