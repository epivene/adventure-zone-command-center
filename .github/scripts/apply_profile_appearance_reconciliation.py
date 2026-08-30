from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, value: str) -> None:
    (ROOT / path).write_text(value, encoding="utf-8")


def replace_once(value: str, old: str, new: str, *, label: str) -> str:
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return value.replace(old, new, 1)


def regex_once(value: str, pattern: str, replacement: str, *, label: str) -> str:
    result, count = re.subn(pattern, replacement, value, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return result


def patch_migration() -> None:
    path = "lib/db/migrations/074_profile_appearance_integrity.sql"
    value = read(path)
    value = replace_once(
        value,
        "CREATE TEMP TABLE tmp_profile_contact_merge_plan ON COMMIT DROP AS",
        "CREATE TEMP TABLE tmp_profile_contact_merge_plan AS",
        label="durable temp merge plan",
    )
    value = replace_once(
        value,
        "UPDATE call_sessions session\nSET contact_id = plan.canonical_contact_id, updated_at = now()",
        "UPDATE call_sessions session\nSET contact_id = plan.canonical_contact_id",
        label="call contact schema",
    )
    value = replace_once(
        value,
        "UPDATE call_sessions session\nSET booking_id = bc.canonical_booking_id, updated_at = now()",
        "UPDATE call_sessions session\nSET booking_id = bc.canonical_booking_id",
        label="call appearance schema",
    )

    southern_block = r'''

-- Southern Ute's live profile mixed a cancelled 2013 calendar appearance with 2026
-- invoice/contract facts. Preserve 2013 exactly and create/update a separate 2026
-- appearance so the permanent profile tells the truth for both years.
INSERT INTO bookings (
  id,
  organization_id,
  name,
  city,
  region,
  address_1,
  postal_code,
  starts_at,
  ends_at,
  status,
  probability,
  notes,
  next_action_kind,
  next_action_due_at,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  o.id,
  'Southern Ute Tribal Fair - 2026',
  coalesce(nullif(o.city, ''), 'Ignacio'),
  coalesce(nullif(o.region, ''), 'CO'),
  NULL,
  NULL,
  '2026-09-11T12:00:00.000Z'::timestamptz,
  '2026-09-13T12:00:00.000Z'::timestamptz,
  'pending_contract',
  'likely',
  'Invoice sent May 13, 2026 for $15,000 with a $3,000 deposit. Contract and deposit are still pending. This is the 2026 event-year record; the cancelled 2013 appearance remains separate.',
  'contract_follow_up',
  '2026-08-31T15:00:00.000Z'::timestamptz,
  now(),
  now()
FROM organizations o
WHERE o.id = '2aea58c4-3d36-4de1-b908-7f8d6e15ad99'::uuid
  AND o.consolidated_into_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM bookings existing
    WHERE existing.organization_id = o.id
      AND existing.starts_at::date = '2026-09-11'::date
      AND NOT EXISTS (
        SELECT 1
        FROM booking_consolidations retired
        WHERE retired.source_booking_id = existing.id
      )
  );

UPDATE bookings b
SET
  status = CASE
    WHEN b.status::text IN ('contract_received', 'confirmed', 'completed') THEN b.status
    ELSE 'pending_contract'
  END,
  probability = CASE
    WHEN b.status::text IN ('contract_received', 'confirmed', 'completed') THEN b.probability
    ELSE 'likely'
  END,
  ends_at = coalesce(b.ends_at, '2026-09-13T12:00:00.000Z'::timestamptz),
  notes = CASE
    WHEN coalesce(b.notes, '') ILIKE '%Invoice sent May 13, 2026%'
      THEN b.notes
    ELSE concat_ws(
      E'\n\n',
      nullif(b.notes, ''),
      'Invoice sent May 13, 2026 for $15,000 with a $3,000 deposit. Contract and deposit are still pending.'
    )
  END,
  next_action_kind = CASE
    WHEN b.status::text IN ('contract_received', 'confirmed', 'completed') THEN b.next_action_kind
    ELSE 'contract_follow_up'
  END,
  next_action_due_at = CASE
    WHEN b.status::text IN ('contract_received', 'confirmed', 'completed') THEN b.next_action_due_at
    ELSE coalesce(b.next_action_due_at, '2026-08-31T15:00:00.000Z'::timestamptz)
  END,
  updated_at = now()
WHERE b.organization_id = '2aea58c4-3d36-4de1-b908-7f8d6e15ad99'::uuid
  AND b.starts_at::date = '2026-09-11'::date
  AND NOT EXISTS (
    SELECT 1
    FROM booking_consolidations retired
    WHERE retired.source_booking_id = b.id
  );

INSERT INTO activities (
  organization_id,
  booking_id,
  kind,
  subject,
  body,
  occurred_at,
  timeline_sort_at,
  created_at,
  updated_at
)
SELECT
  b.organization_id,
  b.id,
  'contract_update',
  'Southern Ute Tribal Fair 2026 invoice / contract pending',
  'Invoice sent May 13, 2026 for $15,000 with a $3,000 deposit. The 2026 contract and deposit are still pending. The cancelled 2013 appearance remains a separate historical record.',
  '2026-05-13T15:00:00.000Z'::timestamptz,
  '2026-05-13T15:00:00.000Z'::timestamptz,
  now(),
  now()
FROM bookings b
WHERE b.organization_id = '2aea58c4-3d36-4de1-b908-7f8d6e15ad99'::uuid
  AND b.starts_at::date = '2026-09-11'::date
  AND NOT EXISTS (
    SELECT 1
    FROM booking_consolidations retired
    WHERE retired.source_booking_id = b.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM activities existing
    WHERE existing.organization_id = b.organization_id
      AND existing.subject = 'Southern Ute Tribal Fair 2026 invoice / contract pending'
  )
ORDER BY b.updated_at DESC, b.id
LIMIT 1;
'''
    value = replace_once(
        value,
        "\n-- Moab had the same next action duplicated at profile and appearance level.",
        southern_block + "\n-- Moab had the same next action duplicated at profile and appearance level.",
        label="Southern Ute event-year repair",
    )

    marker = r'''

DROP TABLE IF EXISTS tmp_profile_contact_merge_plan;

-- This table is intentionally created last. The migration runner uses it as the
-- completion marker, so a partial repair can never be mistaken for a successful one.
CREATE TABLE IF NOT EXISTS profile_appearance_integrity_release_20260830 (
  release_key text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO profile_appearance_integrity_release_20260830 (release_key)
VALUES ('profiles-first-live-audit-repair')
ON CONFLICT (release_key) DO NOTHING;
'''
    if "profile_appearance_integrity_release_20260830" not in value:
        value = value.rstrip() + marker + "\n"
    write(path, value)


def patch_migration_registry() -> None:
    path = "lib/db/src/migrations.ts"
    value = read(path)
    if 'name: "074_profile_appearance_integrity.sql"' not in value:
        value = regex_once(
            value,
            r'(\n  \{\n    name: "073_booking_opportunity_email_controls\.sql",.*?\n  \},)(\n\] as const;)',
            r'''\1
  {
    name: "074_profile_appearance_integrity.sql",
    markerSql: `SELECT to_regclass('profile_appearance_integrity_release_20260830') IS NOT NULL AS ready`,
  },\2''',
            label="migration registry",
        )
    write(path, value)


def patch_profile_repository() -> None:
    path = "artifacts/api-server/src/features/event-profiles/event-profile-repository.ts"
    value = read(path)
    value = replace_once(
        value,
        "const [profileContacts, profileBookings] = await Promise.all([",
        "const [profileContacts, profileBookings, profileBookingOwnershipRows, profileContactOwnershipRows] = await Promise.all([",
        label="profile ownership queries",
    )
    value = replace_once(
        value,
        "}).from(bookings).where(eq(bookings.organizationId, profileId))\n        .orderBy(desc(bookings.startsAt), asc(bookings.name), asc(bookings.id)),\n    ]);\n    const bookingIds = profileBookings.map((booking) => booking.id);\n    const contactIds = profileContacts.map((contact) => contact.id);",
        """}).from(bookings).where(and(
        eq(bookings.organizationId, profileId),
        sql`not exists (
          select 1 from booking_consolidations retired
           where retired.source_booking_id = ${bookings.id}
        )`,
      ))
        .orderBy(desc(bookings.startsAt), asc(bookings.name), asc(bookings.id)),
      this.database.execute<{ id: string }>(sql`
        select b.id::text
          from bookings b
         where b.organization_id = ${profileId}::uuid
      `),
      this.database.execute<{ id: string }>(sql`
        select oc.contact_id::text as id
          from organization_contacts oc
         where oc.organization_id = ${profileId}::uuid
      `),
    ]);
    const bookingIds = [...new Set(profileBookingOwnershipRows.rows.map((row) => row.id))];
    const contactIds = [...new Set(profileContactOwnershipRows.rows.map((row) => row.id))];""",
        label="canonical appearance display and full ownership",
    )
    value = replace_once(
        value,
        """      }).from(callingListMemberships)
        .innerJoin(organizationContacts, eq(organizationContacts.contactId, callingListMemberships.contactId))
        .innerJoin(callingLists, eq(callingLists.id, callingListMemberships.callingListId))
        .leftJoin(actExternalLinks, and(
          eq(actExternalLinks.entityType, "calling_list"),
          eq(actExternalLinks.entityId, callingLists.id),
          eq(actExternalLinks.sourceEntityType, "group"),
        ))
        .where(and(activeOrganizationContactCondition(profileId), eq(callingListMemberships.active, true)))""",
        """      }).from(callingListMemberships)
        .innerJoin(callingLists, eq(callingLists.id, callingListMemberships.callingListId))
        .leftJoin(actExternalLinks, and(
          eq(actExternalLinks.entityType, "calling_list"),
          eq(actExternalLinks.entityId, callingLists.id),
          eq(actExternalLinks.sourceEntityType, "group"),
        ))
        .where(and(
          contactIds.length
            ? inArray(callingListMemberships.contactId, contactIds)
            : sql`false`,
          eq(callingListMemberships.active, true),
        ))""",
        label="consolidated contact group history",
    )
    value = replace_once(
        value,
        """    const entityIds = [
      place.id,
      ...profileContacts.map((contact) => contact.id),
      ...profileBookings.map((booking) => booking.id),
      ...groups.map((group) => group.id),
    ];""",
        """    const entityIds = [
      place.id,
      ...contactIds,
      ...bookingIds,
      ...groups.map((group) => group.id),
    ];""",
        label="ACT provenance ownership",
    )
    write(path, value)


def patch_calendar_importer() -> None:
    path = "artifacts/api-server/src/features/google-workspace/calendar/operational-calendar-import-service.ts"
    value = read(path)
    value = replace_once(
        value,
        'import { asc, eq } from "drizzle-orm";',
        'import { asc, eq, sql } from "drizzle-orm";',
        label="calendar sql import",
    )
    value = replace_once(
        value,
        """      .from(bookings)
      .leftJoin(organizations, eq(bookings.organizationId, organizations.id))
      .leftJoin(travelLegs, eq(bookings.travelLegId, travelLegs.id))
      .orderBy(asc(bookings.startsAt), asc(bookings.name));""",
        """      .from(bookings)
      .leftJoin(organizations, eq(bookings.organizationId, organizations.id))
      .leftJoin(travelLegs, eq(bookings.travelLegId, travelLegs.id))
      .where(sql`not exists (
        select 1 from booking_consolidations retired
         where retired.source_booking_id = ${bookings.id}
      )`)
      .orderBy(asc(bookings.startsAt), asc(bookings.name));""",
        label="calendar canonical appearance candidates",
    )
    write(path, value)


def patch_audit() -> None:
    path = "artifacts/api-server/src/features/profile-integrity/profile-integrity-audit.ts"
    value = read(path)
    value = replace_once(
        value,
        """profile_appearances AS (
  SELECT organization_id,
         count(*) AS appearance_count,
         count(act_record_id) AS act_appearance_count
    FROM bookings
   GROUP BY organization_id
),""",
        """profile_appearances AS (
  SELECT b.organization_id,
         count(*) AS appearance_count,
         count(b.act_record_id) AS act_appearance_count
    FROM bookings b
    LEFT JOIN booking_consolidations retired
      ON retired.source_booking_id = b.id
   WHERE retired.source_booking_id IS NULL
   GROUP BY b.organization_id
),""",
        label="audit canonical appearance counts",
    )
    value = replace_once(
        value,
        """    FROM bookings b
    JOIN organizations o ON o.id = b.organization_id
   WHERE o.consolidated_into_id IS NULL
)""",
        """    FROM bookings b
    JOIN organizations o ON o.id = b.organization_id
    LEFT JOIN booking_consolidations retired
      ON retired.source_booking_id = b.id
   WHERE o.consolidated_into_id IS NULL
     AND retired.source_booking_id IS NULL
)""",
        label="audit duplicate appearance candidates",
    )
    value = replace_once(
        value,
        'message: "This dated appearance is linked to the operational calendar but its status is not booked/confirmed.",',
        'message: "The stored Google event snapshot says booked/confirmed but this event year still has a pre-contract status.",',
        label="calendar audit explanation",
    )
    value = replace_once(
        value,
        """ WHERE b.status::text NOT IN ('contract_received', 'confirmed', 'completed')
 ORDER BY o.name NULLS LAST, b.starts_at NULLS LAST, b.id`;""",
        """ WHERE b.status::text IN (
         'new_lead', 'researching', 'contact_due', 'contacted', 'interested',
         'possible', 'unlikely', 'quote_sent', 'pending_decision',
         'pending_contract', 'renewal_due'
       )
   AND lower(concat_ws(
         ' ',
         l.last_app_snapshot ->> 'summary',
         l.last_app_snapshot ->> 'description'
       )) ~ '(confirmed|booked|signed[[:space:]]+contract)'
 ORDER BY o.name NULLS LAST, b.starts_at NULLS LAST, b.id`;""",
        label="evidence-based calendar status audit",
    )
    write(path, value)


def patch_ui() -> None:
    replacements = {
        "artifacts/adventure-zone/src/components/profiles/simple-full-profile.tsx": [
            ('label="Bookings"', 'label="Event years"'),
            ('>Yearly booking records</p>', '>Dated appearances</p>'),
            ('>Bookings & opportunities</h2>', '>Event years & assignments</h2>'),
            ('No bookings have been added yet.', 'No event years have been added yet.'),
        ],
        "artifacts/adventure-zone/src/components/profiles/profile-bookings-primary.test.ts": [
            ('label="Bookings"', 'label="Event years"'),
            ('>Bookings & opportunities</h2>', '>Event years & assignments</h2>'),
            ('label="Upcoming events"', 'label="Upcoming events"'),
        ],
        "artifacts/adventure-zone/src/pages/BookingDetailPage.tsx": [
            ('data?.booking?.name ?? "Booking"', 'data?.booking?.name ?? "Event year"'),
            ('Loading booking…', 'Loading event year…'),
            ('booking.name ?? "Booking"', 'booking.name ?? "Event year"'),
            ('Edit booking', 'Edit event year'),
        ],
        "artifacts/adventure-zone/src/pages/BookingEditPage.tsx": [
            ('Edit booking', 'Edit event year'),
            ('unavailable for this booking.', 'unavailable for this event year.'),
        ],
        "artifacts/adventure-zone/src/pages/TodayPage.tsx": [
            ('>Booking work</Link>', '>Profile work</Link>'),
            ('Booking and contract work that needs your attention.', 'Event-year and contract work that needs your attention.'),
            ('>Open booking work</Link>', '>Open profiles</Link>'),
        ],
        "artifacts/adventure-zone/src/features/today/today-focus.ts": [
            ('Booking or contract work needs your attention', 'Event-year or contract work needs your attention'),
        ],
    }
    for path, pairs in replacements.items():
        value = read(path)
        for old, new in pairs:
            if old == new:
                continue
            if old not in value:
                raise RuntimeError(f"{path}: missing UI text {old!r}")
            value = value.replace(old, new)
        write(path, value)


def remove_temporary_exports() -> None:
    for relative in [
        ".github/workflows/export-live-reconciliation-targets.yml",
        ".github/workflows/export-live-calendar-evidence.yml",
    ]:
        path = ROOT / relative
        if path.exists():
            path.unlink()


def main() -> None:
    patch_migration()
    patch_migration_registry()
    patch_profile_repository()
    patch_calendar_importer()
    patch_audit()
    patch_ui()
    remove_temporary_exports()


if __name__ == "__main__":
    main()
