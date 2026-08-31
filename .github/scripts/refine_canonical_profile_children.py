from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, value: str) -> None:
    (ROOT / path).write_text(value, encoding="utf-8")


def replace_once(value: str, old: str, new: str, label: str) -> str:
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one exact match, found {count}")
    return value.replace(old, new, 1)


def regex_once(value: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, lambda _match: replacement, value, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected one regex match, found {count}")
    return updated


def patch_event_profile_repository() -> None:
    path = "artifacts/api-server/src/features/event-profiles/event-profile-repository.ts"
    value = read(path)

    helper = r'''type CanonicalProfileContact = EventProfileContact & {
  sourceContactIds: string[];
};

type CanonicalProfileBookingSelection = {
  bookings: EventProfileBookingRecord[];
  canonicalBookingIds: Map<string, string>;
};

function normalizedIdentityPart(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "") ?? "";
}

function normalizedContactEmail(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("en-US") ?? "";
}

function normalizedContactPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function contactsShareIdentity(left: EventProfileContact, right: EventProfileContact) {
  const leftName = normalizedIdentityPart(left.name);
  const rightName = normalizedIdentityPart(right.name);
  if (!leftName || leftName !== rightName) return false;

  const leftEmail = normalizedContactEmail(left.email);
  const rightEmail = normalizedContactEmail(right.email);
  if (leftEmail && rightEmail && leftEmail === rightEmail) return true;

  const leftPhone = normalizedContactPhone(left.phone);
  const rightPhone = normalizedContactPhone(right.phone);
  return Boolean(leftPhone && rightPhone && leftPhone === rightPhone);
}

function mergeCanonicalContact(
  canonical: CanonicalProfileContact,
  contact: EventProfileContact,
  sourceContactIds: readonly string[] = [contact.id],
) {
  for (const sourceContactId of sourceContactIds) {
    if (!canonical.sourceContactIds.includes(sourceContactId)) canonical.sourceContactIds.push(sourceContactId);
  }
  canonical.isPrimary ||= contact.isPrimary;
  canonical.role ||= contact.role;
  canonical.phone ||= contact.phone;
  canonical.email ||= contact.email;
  canonical.actRecordId ||= contact.actRecordId;
  canonical.locationName ||= contact.locationName;
  canonical.locationCity ||= contact.locationCity;
  canonical.locationRegion ||= contact.locationRegion;
}

function canonicalProfileContacts(records: EventProfileContactRecord[]) {
  const groups: CanonicalProfileContact[] = [];

  for (const record of records.toSorted(contactOrder)) {
    const contact: EventProfileContact = {
      id: record.id,
      name: `${record.firstName} ${record.lastName}`.trim(),
      role: record.role,
      isPrimary: record.isPrimary,
      phone: record.phone,
      email: record.email,
      source: record.source,
      actRecordId: record.actRecordId,
      locationName: record.locationName,
      locationCity: record.locationCity,
      locationRegion: record.locationRegion,
    };

    const matchingIndexes = groups
      .map((group, index) => contactsShareIdentity(group, contact) ? index : -1)
      .filter((index) => index >= 0);

    if (matchingIndexes.length === 0) {
      groups.push({ ...contact, sourceContactIds: [contact.id] });
      continue;
    }

    const canonical = groups[matchingIndexes[0]!]!;
    mergeCanonicalContact(canonical, contact);
    for (const index of matchingIndexes.slice(1).toSorted((left, right) => right - left)) {
      const merged = groups[index]!;
      mergeCanonicalContact(canonical, merged, merged.sourceContactIds);
      groups.splice(index, 1);
    }
  }

  return groups;
}

const mergedBookingNotePattern = /^\s*\[Merged duplicate\]\s*Canonical booking:\s*([0-9a-f-]{36})/i;

function exactBookingKey(booking: EventProfileBookingRecord) {
  if (!booking.startsAt) return `booking:${booking.id}`;
  return [
    normalizedIdentityPart(booking.name),
    normalizedIdentityPart(booking.city),
    normalizedIdentityPart(booking.region),
    booking.startsAt.toISOString(),
    booking.endsAt?.toISOString() ?? "",
  ].join("\u0000");
}

function appearanceScore(booking: EventProfileBookingRecord, namedCanonicalIds: Set<string>) {
  return (namedCanonicalIds.has(booking.id.toLowerCase()) ? 1_000 : 0)
    + (booking.startsAt ? 100 : 0)
    + (booking.endsAt ? 20 : 0)
    + (booking.actRecordId ? 5 : 0);
}

function canonicalProfileBookings(records: EventProfileBookingRecord[]): CanonicalProfileBookingSelection {
  const namedCanonicalIds = new Set<string>();
  const canonicalBookingIds = new Map<string, string>();
  for (const booking of records) {
    const canonicalId = booking.notes?.match(mergedBookingNotePattern)?.[1];
    if (!canonicalId) continue;
    namedCanonicalIds.add(canonicalId.toLowerCase());
    canonicalBookingIds.set(booking.id, canonicalId.toLowerCase());
  }

  const selected = new Map<string, EventProfileBookingRecord>();
  for (const booking of records) {
    if (mergedBookingNotePattern.test(booking.notes ?? "")) continue;
    const key = exactBookingKey(booking);
    const existing = selected.get(key);
    if (!existing) {
      selected.set(key, booking);
      continue;
    }

    const candidateScore = appearanceScore(booking, namedCanonicalIds);
    const existingScore = appearanceScore(existing, namedCanonicalIds);
    if (candidateScore > existingScore || (candidateScore === existingScore && booking.id < existing.id)) {
      canonicalBookingIds.set(existing.id, booking.id);
      selected.set(key, booking);
    } else {
      canonicalBookingIds.set(booking.id, existing.id);
    }
  }

  return {
    bookings: [...selected.values()].toSorted((left, right) =>
      Number(right.startsAt ?? 0) - Number(left.startsAt ?? 0)
      || left.name.localeCompare(right.name)
      || left.id.localeCompare(right.id),
    ),
    canonicalBookingIds,
  };
}

function canonicalRecordId(mapping: ReadonlyMap<string, string>, id: string | null) {
  if (!id) return null;
  let current = id;
  const seen = new Set<string>();
  while (mapping.has(current) && !seen.has(current)) {
    seen.add(current);
    current = mapping.get(current)!;
  }
  return current;
}
'''

    value = regex_once(
        value,
        r"\ntype CanonicalProfileContact = EventProfileContact & \{.*?\nfunction sourceReference\(",
        "\n" + helper + "\nfunction sourceReference(",
        "event profile helper refinement",
    )

    build_profile = r'''export function buildEventProfile(
  records: EventProfileRecordSet,
  requestedContactId?: string,
  migrationHistory: EventProfile["migrationHistory"] = {
    contactSourceIds: [], phones: [], notes: [], bookingSourceIds: [], groupSourceIds: [],
  },
): EventProfile {
  const contactGroups = canonicalProfileContacts(records.contacts);
  const contactIdMap = new Map<string, string>();
  for (const contact of contactGroups) {
    for (const sourceContactId of contact.sourceContactIds) contactIdMap.set(sourceContactId, contact.id);
  }
  const requestedContactGroup = contactGroups.find((contact) =>
    requestedContactId ? contact.sourceContactIds.includes(requestedContactId) : false,
  );
  const contacts = contactGroups.map(({ sourceContactIds: _sourceContactIds, ...contact }) => contact);
  const selectedContactId = requestedContactGroup?.id ?? contacts[0]?.id ?? null;

  const bookingSelection = canonicalProfileBookings(records.bookings);
  const timeline = splitProfileActivities(records.activities.map((activity) => ({
    ...activity,
    contactId: canonicalRecordId(contactIdMap, activity.contactId),
    bookingId: canonicalRecordId(bookingSelection.canonicalBookingIds, activity.bookingId),
  })));

  return {
    id: records.place.id,
    place: records.place,
    contacts,
    selectedContactId,
    bookings: bookingSelection.bookings.map((booking) => ({
      ...booking,
      primaryContactId: canonicalRecordId(contactIdMap, booking.primaryContactId),
    })),
    notes: timeline.notes,
    scoutNotes: timeline.scoutNotes,
    history: timeline.history,
    followUps: records.followUps
      .map((followUp) => ({
        ...followUp,
        contactId: canonicalRecordId(contactIdMap, followUp.contactId),
        bookingId: canonicalRecordId(bookingSelection.canonicalBookingIds, followUp.bookingId),
      }))
      .toSorted((left, right) =>
        Number(left.completedAt !== null) - Number(right.completedAt !== null)
        || Number(left.dueAt) - Number(right.dueAt)
        || left.id.localeCompare(right.id),
      ),
    groups: records.groups.toSorted((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
    sourceProvenance: stableSourceProvenance(records),
    migrationHistory,
  };
}
'''

    value = regex_once(
        value,
        r'''export function buildEventProfile\(.*?\n\}\n\ntype DrizzleDatabase''',
        build_profile + "\ntype DrizzleDatabase",
        "event profile builder refinement",
    )
    value = replace_once(
        value,
        "        importedFromAct: activity.importedFromAct,",
        "        importedFromAct: Boolean(activity.importedFromAct),",
        "event profile imported flag type",
    )
    write(path, value)


def patch_assistant_import() -> None:
    path = "artifacts/api-server/src/routes/assistant-import.ts"
    value = read(path)

    old = r'''        const email = String(contactInput.email ?? "").trim().toLowerCase();
        const inputName = splitName(String(contactInput.name));
        const linkedContacts = await transaction
          .select({
            contactId: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            email: contacts.email,
            isPrimary: organizationContacts.isPrimary,
          })
          .from(organizationContacts)
          .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
          .where(and(eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.active, true)))
          .orderBy(desc(organizationContacts.isPrimary), asc(contacts.createdAt), asc(contacts.id));

        const matchingContact =
          linkedContacts.find((row) => email && row.email?.trim().toLowerCase() === email) ??
          linkedContacts.find((row) =>
            `${row.firstName} ${row.lastName}`.trim().toLowerCase() === String(contactInput.name).trim().toLowerCase(),
          ) ??
          linkedContacts.find((row) => row.isPrimary) ??
          null;'''

    new = r'''        const email = String(contactInput.email ?? "").trim().toLowerCase();
        const inputPhone = normalizedPhone(String(contactInput.phone ?? ""));
        const inputName = splitName(String(contactInput.name));
        const linkedContacts = await transaction
          .select({
            contactId: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            email: contacts.email,
            normalizedPhone: contacts.normalizedPhone,
            isPrimary: organizationContacts.isPrimary,
          })
          .from(organizationContacts)
          .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
          .where(and(
            eq(organizationContacts.organizationId, organizationId),
            eq(organizationContacts.active, true),
            sql`not exists (
              select 1 from contact_consolidations cc
              where cc.source_contact_id = ${contacts.id}
            )`,
          ))
          .orderBy(desc(organizationContacts.isPrimary), asc(contacts.createdAt), asc(contacts.id));

        const matchingContact =
          linkedContacts.find((row) => email && row.email?.trim().toLowerCase() === email) ??
          linkedContacts.find((row) => inputPhone && normalizedPhone(row.normalizedPhone) === inputPhone) ??
          linkedContacts.find((row) =>
            `${row.firstName} ${row.lastName}`.trim().toLowerCase() === String(contactInput.name).trim().toLowerCase(),
          ) ??
          linkedContacts.find((row) => row.isPrimary) ??
          null;'''

    value = replace_once(value, old, new, "assistant import canonical contact matching")
    write(path, value)


def patch_profile_touch_schema() -> None:
    path = "artifacts/api-server/src/features/organizations/profile-touch-schema.ts"
    value = read(path)

    safe_mapping = r'''      DELETE FROM contact_consolidations;

      WITH contact_identity AS (
        SELECT
          c.id AS contact_id,
          CASE
            WHEN nullif(lower(btrim(c.email)), '') IS NOT NULL THEN
              'email:'
              || regexp_replace(lower(btrim(concat_ws(' ', c.first_name, c.last_name))), '[^a-z0-9]+', '', 'g')
              || ':' || lower(btrim(c.email))
            WHEN nullif(btrim(c.normalized_phone), '') IS NOT NULL THEN
              'phone:'
              || regexp_replace(lower(btrim(concat_ws(' ', c.first_name, c.last_name))), '[^a-z0-9]+', '', 'g')
              || ':' || btrim(c.normalized_phone)
            ELSE NULL
          END AS identity_key,
          EXISTS (
            SELECT 1 FROM organization_contacts oc
            WHERE oc.contact_id = c.id AND oc.active = true AND oc.is_primary = true
          ) AS is_primary,
          EXISTS (
            SELECT 1 FROM organization_contacts oc
            WHERE oc.contact_id = c.id AND oc.active = true AND oc.source = 'local'
          ) AS has_local_relationship,
          c.normalized_phone IS NOT NULL AS has_phone,
          c.updated_at
        FROM contacts c
      ), duplicate_identity_keys AS (
        SELECT DISTINCT candidate.identity_key
        FROM contact_identity candidate
        JOIN organization_contacts relationship
          ON relationship.contact_id = candidate.contact_id
         AND relationship.active = true
        WHERE candidate.identity_key IS NOT NULL
          AND candidate.identity_key NOT IN ('email::', 'phone::')
        GROUP BY relationship.organization_id, candidate.identity_key
        HAVING count(DISTINCT candidate.contact_id) > 1
      ), contact_candidates AS (
        SELECT identity.*
        FROM contact_identity identity
        JOIN duplicate_identity_keys duplicate
          ON duplicate.identity_key = identity.identity_key
      ), ranked_contact_candidates AS (
        SELECT
          contact_id,
          identity_key,
          first_value(contact_id) OVER (
            PARTITION BY identity_key
            ORDER BY is_primary DESC, has_local_relationship DESC, has_phone DESC, updated_at DESC, contact_id
          ) AS canonical_contact_id,
          row_number() OVER (
            PARTITION BY identity_key
            ORDER BY is_primary DESC, has_local_relationship DESC, has_phone DESC, updated_at DESC, contact_id
          ) AS duplicate_rank
        FROM contact_candidates
      )
      INSERT INTO contact_consolidations (
        source_contact_id,
        canonical_contact_id,
        consolidated_at
      )
      SELECT contact_id, canonical_contact_id, now()
      FROM ranked_contact_candidates
      WHERE duplicate_rank > 1
        AND contact_id <> canonical_contact_id;

      WITH preferred_relationships AS (
        SELECT DISTINCT ON (relationship.organization_id, mapping.canonical_contact_id)
          relationship.organization_id,
          mapping.canonical_contact_id AS contact_id,
          relationship.role,
          relationship.source
        FROM contact_consolidations mapping
        JOIN organization_contacts relationship
          ON relationship.contact_id = mapping.source_contact_id
         AND relationship.active = true
        ORDER BY
          relationship.organization_id,
          mapping.canonical_contact_id,
          relationship.is_primary DESC,
          CASE WHEN relationship.source = 'local' THEN 0 ELSE 1 END,
          relationship.updated_at DESC,
          relationship.id
      )
      INSERT INTO organization_contacts (
        organization_id,
        contact_id,
        role,
        is_primary,
        active,
        source,
        created_at,
        updated_at
      )
      SELECT
        organization_id,
        contact_id,
        role,
        false,
        true,
        source,
        now(),
        now()
      FROM preferred_relationships
      ON CONFLICT (organization_id, contact_id) DO UPDATE
      SET
        role = coalesce(organization_contacts.role, excluded.role),
        active = true,
        source = CASE
          WHEN organization_contacts.source = 'local' OR excluded.source = 'local' THEN 'local'
          ELSE organization_contacts.source
        END,
        updated_at = now();

      INSERT INTO audit_entries (
        entity_type,
        entity_id,
        action,
        before,
        after,
        created_at
      )
      SELECT
        'contact',
        mapping.source_contact_id,
        'consolidate_duplicate',
        jsonb_build_object('sourceContactId', mapping.source_contact_id),
        jsonb_build_object('canonicalContactId', mapping.canonical_contact_id),
        mapping.consolidated_at
      FROM contact_consolidations mapping
      WHERE NOT EXISTS (
        SELECT 1
        FROM audit_entries audit
        WHERE audit.entity_type = 'contact'
          AND audit.entity_id = mapping.source_contact_id
          AND audit.action = 'consolidate_duplicate'
          AND audit.after ->> 'canonicalContactId' = mapping.canonical_contact_id::text
      );

      ALTER TABLE organizations'''

    value = regex_once(
        value,
        r'''      DELETE FROM contact_consolidations;.*?\n\n      ALTER TABLE organizations''',
        safe_mapping,
        "scoped contact consolidation mapping",
    )
    write(path, value)


def patch_profile_integrity_audit() -> None:
    path = "artifacts/api-server/src/features/profile-integrity/profile-integrity-audit.ts"
    value = read(path)

    value = replace_once(
        value,
        r'''WITH profile_contacts AS (
  SELECT organization_id, count(DISTINCT contact_id) FILTER (WHERE active) AS contact_count
    FROM organization_contacts
   GROUP BY organization_id
), profile_appearances AS (
  SELECT organization_id,
         count(*) AS appearance_count,
         count(act_record_id) AS act_appearance_count
    FROM bookings
   GROUP BY organization_id
), profile_timeline AS (''',
        r'''WITH profile_contacts AS (
  SELECT relationship.organization_id,
         count(DISTINCT relationship.contact_id) FILTER (
           WHERE relationship.active
             AND NOT EXISTS (
               SELECT 1 FROM contact_consolidations mapping
               WHERE mapping.source_contact_id = relationship.contact_id
             )
         ) AS contact_count
    FROM organization_contacts relationship
   GROUP BY relationship.organization_id
), profile_appearances AS (
  SELECT booking.organization_id,
         count(*) AS appearance_count,
         count(booking.act_record_id) AS act_appearance_count
    FROM bookings booking
   WHERE NOT EXISTS (
           SELECT 1 FROM booking_consolidations mapping
           WHERE mapping.source_booking_id = booking.id
         )
     AND coalesce(booking.notes, '') NOT LIKE '[Merged duplicate] Canonical booking:%'
   GROUP BY booking.organization_id
), profile_timeline AS (''',
        "profile integrity canonical summary",
    )

    value = replace_once(
        value,
        "         lower(regexp_replace(coalesce(b.name, ''), '[^a-z0-9]+', '', 'g')) AS normalized_name,",
        "         regexp_replace(lower(coalesce(b.name, '')), '[^a-z0-9]+', '', 'g') AS normalized_name,",
        "profile integrity booking normalization",
    )
    value = replace_once(
        value,
        r'''   WHERE o.consolidated_into_id IS NULL
)
SELECT organization_id::text,''',
        r'''   WHERE o.consolidated_into_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM booking_consolidations mapping
       WHERE mapping.source_booking_id = b.id
     )
     AND coalesce(b.notes, '') NOT LIKE '[Merged duplicate] Canonical booking:%'
)
SELECT organization_id::text,''',
        "profile integrity duplicate appearance filter",
    )
    value = replace_once(
        value,
        r'''   WHERE oc.active = true
     AND o.consolidated_into_id IS NULL
), grouped AS (''',
        r'''   WHERE oc.active = true
     AND o.consolidated_into_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM contact_consolidations mapping
       WHERE mapping.source_contact_id = c.id
     )
), grouped AS (''',
        "profile integrity duplicate contact filter",
    )
    value = replace_once(
        value,
        "            lower(regexp_replace(contact_name, '[^a-z0-9]+', '', 'g')),",
        "            regexp_replace(lower(contact_name), '[^a-z0-9]+', '', 'g'),",
        "profile integrity contact normalization",
    )
    write(path, value)


def patch_event_profile_tests() -> None:
    path = "artifacts/api-server/src/features/event-profiles/event-profile-canonical-children.test.ts"
    value = read(path)
    insertion = r'''

  it("preserves distinct appearances that happen in the same year", () => {
    const input = records();
    input.bookings.push({
      id: "30000000-0000-4000-8000-000000000001",
      name: "Northglenn July 4 Celebration - 2026",
      primaryContactId: canonicalContactId,
      city: "Northglenn",
      region: "CO",
      startsAt: new Date("2026-07-04T17:00:00.000Z"),
      endsAt: new Date("2026-07-04T23:00:00.000Z"),
      status: "interested",
      probability: "possible",
      notes: null,
      actRecordId: null,
    });

    const profile = buildEventProfile(input);

    expect(profile.bookings.map((booking) => booking.id)).toEqual([
      canonicalBookingId,
      "30000000-0000-4000-8000-000000000001",
    ]);
  });

  it("rewrites child references to their canonical contact and appearance", () => {
    const input = records();
    const duplicateContactId = input.contacts[2]!.id;
    const duplicateBookingId = input.bookings[1]!.id;
    input.activities.push({
      id: "40000000-0000-4000-8000-000000000001",
      contactId: duplicateContactId,
      bookingId: duplicateBookingId,
      kind: "note",
      subject: "Duplicate-linked note",
      body: "Preserve this history on the canonical profile children.",
      occurredAt: new Date("2026-08-29T12:00:00.000Z"),
      createdAt: new Date("2026-08-29T12:00:00.000Z"),
      updatedAt: new Date("2026-08-29T12:00:00.000Z"),
      importedFromAct: false,
      actSourceType: null,
    });
    input.followUps.push({
      id: "50000000-0000-4000-8000-000000000001",
      contactId: duplicateContactId,
      bookingId: duplicateBookingId,
      kind: "Follow up in 2027",
      dueAt: new Date("2027-01-15T15:00:00.000Z"),
      completedAt: null,
    });

    const profile = buildEventProfile(input);

    expect(profile.notes[0]).toMatchObject({
      contactId: canonicalContactId,
      bookingId: canonicalBookingId,
    });
    expect(profile.followUps[0]).toMatchObject({
      contactId: canonicalContactId,
      bookingId: canonicalBookingId,
    });
    expect(profile.bookings[0]!.primaryContactId).toBe(canonicalContactId);
  });'''

    value = replace_once(value, "\n});\n", insertion + "\n});\n", "canonical profile child regression additions")
    write(path, value)


def patch_profile_integrity_tests() -> None:
    path = "artifacts/api-server/src/features/profile-integrity/profile-integrity-audit.test.ts"
    value = read(path)
    value = replace_once(
        value,
        r'''class FakePool {
  constructor(private readonly responses: Array<{ marker: string; rows: Row[] }>) {}

  async query(sql: string): Promise<{ rows: Row[] }> {
    const match = this.responses.find((response) => sql.includes(response.marker));
    return { rows: match?.rows ?? [] };
  }
}''',
        r'''class FakePool {
  readonly queries: string[] = [];

  constructor(private readonly responses: Array<{ marker: string; rows: Row[] }>) {}

  async query(sql: string): Promise<{ rows: Row[] }> {
    this.queries.push(sql);
    const match = this.responses.find((response) => sql.includes(response.marker));
    return { rows: match?.rows ?? [] };
  }
}''',
        "profile integrity fake pool query capture",
    )
    test = r'''

  it("does not count non-destructively consolidated profile children as active duplicates", async () => {
    const pool = new FakePool([]);

    const report = await new ProfileIntegrityAuditService(pool).run(
      new Date("2026-08-30T18:00:00.000Z"),
    );

    expect(report.summary.duplicateAppearanceGroupCount).toBe(0);
    expect(report.summary.duplicateContactGroupCount).toBe(0);
    const sql = pool.queries.join("\n");
    expect(sql).toContain("contact_consolidations");
    expect(sql).toContain("booking_consolidations");
    expect(sql).toContain("[Merged duplicate] Canonical booking:%");
  });'''
    value = replace_once(value, "\n});\n", test + "\n});\n", "profile integrity consolidation regression")
    write(path, value)


def patch_pirate_fixture() -> None:
    path = "imports/approved-profiles/pirate-fest-northglenn-co-2026.json"
    payload = json.loads(read(path))
    payload["event"]["id"] = "f24033e1-801b-43ff-9a7e-a9d6d7b426c3"
    write(path, json.dumps(payload, indent=2) + "\n")

    test_path = "artifacts/api-server/src/features/approved-profile-import/pirate-fest-confirmed.test.ts"
    value = read(test_path)
    value = replace_once(
        value,
        '''  it("records 2026 as declined rather than a signed booking", () => {
    expect(payload.booking.status).toBe("declined");''',
        '''  it("records 2026 as declined rather than a signed booking", () => {
    expect(payload.event.id).toBe("f24033e1-801b-43ff-9a7e-a9d6d7b426c3");
    expect(payload.booking.status).toBe("declined");''',
        "Pirate Fest permanent profile regression",
    )
    write(test_path, value)


if __name__ == "__main__":
    patch_event_profile_repository()
    patch_assistant_import()
    patch_profile_touch_schema()
    patch_profile_integrity_audit()
    patch_event_profile_tests()
    patch_profile_integrity_tests()
    patch_pirate_fixture()
    print("Refined canonical profile child repair.")
