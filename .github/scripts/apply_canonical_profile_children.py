from __future__ import annotations

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
    updated, count = re.subn(pattern, replacement, value, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected one regex match, found {count}")
    return updated


def patch_event_profile_repository() -> None:
    path = "artifacts/api-server/src/features/event-profiles/event-profile-repository.ts"
    value = read(path)

    helper = r'''

type CanonicalProfileContact = EventProfileContact & {
  sourceContactIds: string[];
};

function normalizedIdentityPart(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "") ?? "";
}

function canonicalContactIdentity(contact: EventProfileContact) {
  const name = normalizedIdentityPart(contact.name);
  const email = contact.email?.trim().toLocaleLowerCase("en-US") ?? "";
  const phone = contact.phone?.replace(/\D/g, "") ?? "";
  if (name && email) return `${name}\u0000email:${email}`;
  if (name && phone) return `${name}\u0000phone:${phone}`;
  return `contact:${contact.id}`;
}

function canonicalProfileContacts(records: EventProfileContactRecord[]) {
  const grouped = new Map<string, CanonicalProfileContact>();
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
    const key = canonicalContactIdentity(contact);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...contact, sourceContactIds: [contact.id] });
      continue;
    }
    existing.sourceContactIds.push(contact.id);
    existing.isPrimary ||= contact.isPrimary;
    existing.role ||= contact.role;
    existing.phone ||= contact.phone;
    existing.email ||= contact.email;
    existing.actRecordId ||= contact.actRecordId;
    existing.locationName ||= contact.locationName;
    existing.locationCity ||= contact.locationCity;
    existing.locationRegion ||= contact.locationRegion;
  }
  return [...grouped.values()];
}

const mergedBookingNotePattern = /^\s*\[Merged duplicate\]\s*Canonical booking:\s*([0-9a-f-]{36})/i;

function appearanceYear(booking: EventProfileBookingRecord) {
  const dated = booking.startsAt ?? booking.endsAt;
  if (dated) return dated.getUTCFullYear();
  const match = booking.name.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
  return match?.[1] ? Number(match[1]) : null;
}

function appearanceScore(booking: EventProfileBookingRecord, namedCanonicalIds: Set<string>) {
  return (namedCanonicalIds.has(booking.id) ? 1_000 : 0)
    + (booking.startsAt ? 100 : 0)
    + (booking.endsAt ? 20 : 0)
    + (booking.actRecordId ? 5 : 0);
}

function canonicalProfileBookings(records: EventProfileBookingRecord[]) {
  const namedCanonicalIds = new Set<string>();
  for (const booking of records) {
    const canonicalId = booking.notes?.match(mergedBookingNotePattern)?.[1];
    if (canonicalId) namedCanonicalIds.add(canonicalId.toLowerCase());
  }

  const selected = new Map<string, EventProfileBookingRecord>();
  for (const booking of records) {
    if (mergedBookingNotePattern.test(booking.notes ?? "")) continue;
    const year = appearanceYear(booking);
    const key = year == null
      ? `undated:${normalizedIdentityPart(booking.name) || booking.id}`
      : `year:${year}`;
    const existing = selected.get(key);
    if (!existing) {
      selected.set(key, booking);
      continue;
    }
    const candidateScore = appearanceScore(booking, namedCanonicalIds);
    const existingScore = appearanceScore(existing, namedCanonicalIds);
    if (candidateScore > existingScore || (candidateScore === existingScore && booking.id < existing.id)) {
      selected.set(key, booking);
    }
  }

  return [...selected.values()].toSorted((left, right) =>
    Number(right.startsAt ?? 0) - Number(left.startsAt ?? 0)
    || (appearanceYear(right) ?? 0) - (appearanceYear(left) ?? 0)
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id),
  );
}
'''
    value = replace_once(
        value,
        "\nfunction sourceReference(\n",
        helper + "\nfunction sourceReference(\n",
        "event profile helper insertion",
    )

    old_contacts = '''  const contacts = records.contacts.toSorted(contactOrder).map((contact) => ({
    id: contact.id,
    name: `${contact.firstName} ${contact.lastName}`.trim(),
    role: contact.role,
    isPrimary: contact.isPrimary,
    phone: contact.phone,
    email: contact.email,
    source: contact.source,
    actRecordId: contact.actRecordId,
    locationName: contact.locationName,
    locationCity: contact.locationCity,
    locationRegion: contact.locationRegion,
  }));
  const selectedContactId = contacts.some(({ id }) => id === requestedContactId)
    ? requestedContactId!
    : contacts[0]?.id ?? null;
'''
    new_contacts = '''  const contactGroups = canonicalProfileContacts(records.contacts);
  const requestedContactGroup = contactGroups.find((contact) =>
    requestedContactId ? contact.sourceContactIds.includes(requestedContactId) : false,
  );
  const contacts = contactGroups.map(({ sourceContactIds: _sourceContactIds, ...contact }) => contact);
  const selectedContactId = requestedContactGroup?.id ?? contacts[0]?.id ?? null;
'''
    value = replace_once(value, old_contacts, new_contacts, "event profile contact canonicalization")

    old_bookings = '''    bookings: records.bookings.toSorted((left, right) =>
      Number(right.startsAt ?? 0) - Number(left.startsAt ?? 0)
      || left.name.localeCompare(right.name)
      || left.id.localeCompare(right.id),
    ),'''
    value = replace_once(
        value,
        old_bookings,
        "    bookings: canonicalProfileBookings(records.bookings),",
        "event profile booking canonicalization",
    )
    write(path, value)


def patch_assistant_import() -> None:
    path = "artifacts/api-server/src/routes/assistant-import.ts"
    value = read(path)
    value = replace_once(
        value,
        'import { and, eq, sql } from "drizzle-orm";',
        'import { and, asc, desc, eq, sql } from "drizzle-orm";',
        "assistant import drizzle imports",
    )
    value = replace_once(
        value,
        "const router: IRouter = Router();\n",
        "const router: IRouter = Router();\nconst uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;\n",
        "assistant import uuid helper",
    )

    pattern = r'''  const name = String\(event\.name\)\.trim\(\);\n  const city = String\(event\.city \?\? ""\)\.trim\(\);\n  const region = String\(event\.region \?\? ""\)\.trim\(\)\.toUpperCase\(\);\n\n  try \{\n    const matches = await db\.execute<\{ id: string \}>\(sql`\n      select id\n      from organizations\n      where lower\(trim\(name\)\) = lower\(trim\(\$\{name\}\)\)\n        and lower\(trim\(coalesce\(city, ''\)\)\) = lower\(trim\(\$\{city\}\)\)\n        and upper\(trim\(coalesce\(region, ''\)\)\) = upper\(trim\(\$\{region\}\)\)\n        and consolidated_into_id is null\n      limit 2\n    `\);\n\n    if \(matches\.rows\.length === 0\) \{\n      next\(\);\n      return;\n    \}\n\n    if \(matches\.rows\.length > 1\) \{\n      res\.status\(409\)\.json\(\{\n        ok: false,\n        error: "More than one existing profile matches this event name and location\.",\n      \}\);\n      return;\n    \}\n\n    const organizationId = matches\.rows\[0\]!\.id;'''
    replacement = '''  const name = String(event.name).trim();
  const city = String(event.city ?? "").trim();
  const region = String(event.region ?? "").trim().toUpperCase();
  const requestedProfileId = typeof event.id === "string" && uuidPattern.test(event.id.trim())
    ? event.id.trim()
    : null;

  try {
    type ExistingProfileRow = { id: string; name: string; city: string | null; region: string | null };
    const matches = requestedProfileId
      ? await db.execute<ExistingProfileRow>(sql`
          select id, name, city, region
          from organizations
          where id = ${requestedProfileId}::uuid
            and consolidated_into_id is null
          limit 1
        `)
      : await db.execute<ExistingProfileRow>(sql`
          select id, name, city, region
          from organizations
          where lower(trim(name)) = lower(trim(${name}))
            and lower(trim(coalesce(city, ''))) = lower(trim(${city}))
            and upper(trim(coalesce(region, ''))) = upper(trim(${region}))
            and consolidated_into_id is null
          limit 2
        `);

    if (matches.rows.length === 0) {
      if (requestedProfileId) {
        res.status(404).json({ ok: false, error: "The resolved event profile no longer exists." });
        return;
      }
      next();
      return;
    }

    if (matches.rows.length > 1) {
      res.status(409).json({
        ok: false,
        error: "More than one existing profile matches this event name and location.",
      });
      return;
    }

    const existingProfile = matches.rows[0]!;
    const organizationId = existingProfile.id;'''
    value = regex_once(value, pattern, replacement, "assistant import profile resolution")

    value = replace_once(
        value,
        '''      const organizationValues: Record<string, unknown> = {
        name,
        city: city || null,
        region: region || null,
        updatedAt: now,
      };''',
        '''      const organizationValues: Record<string, unknown> = {
        ...(requestedProfileId ? {} : { name }),
        city: city || existingProfile.city || null,
        region: region || existingProfile.region || null,
        updatedAt: now,
      };''',
        "assistant import preserve canonical profile name",
    )

    value = replace_once(
        value,
        '''          .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
          .where(and(eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.active, true)));''',
        '''          .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
          .where(and(eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.active, true)))
          .orderBy(desc(organizationContacts.isPrimary), asc(contacts.createdAt), asc(contacts.id));''',
        "assistant import contact ordering",
    )

    value = replace_once(
        value,
        '''        const [existingBooking] = await transaction
          .select({ id: bookings.id })
          .from(bookings)
          .where(and(eq(bookings.organizationId, organizationId), eq(bookings.name, bookingName)))
          .limit(1);''',
        '''        const [existingBooking] = await transaction
          .select({ id: bookings.id })
          .from(bookings)
          .where(and(eq(bookings.organizationId, organizationId), eq(bookings.name, bookingName)))
          .orderBy(
            sql`case when coalesce(${bookings.notes}, '') like '[Merged duplicate] Canonical booking:%' then 1 else 0 end`,
            desc(sql`case when ${bookings.startsAt} is not null then 1 else 0 end`),
            asc(bookings.createdAt),
            asc(bookings.id),
          )
          .limit(1);''',
        "assistant import canonical booking selection",
    )
    write(path, value)


def patch_profile_touch_schema() -> None:
    path = "artifacts/api-server/src/features/organizations/profile-touch-schema.ts"
    value = read(path)
    anchor = '''    await client.query(`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS filler boolean DEFAULT false NOT NULL;
'''
    replacement = '''    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_consolidations (
        source_contact_id uuid PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
        canonical_contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
        consolidated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT contact_consolidations_distinct_ids
          CHECK (source_contact_id <> canonical_contact_id)
      );

      CREATE INDEX IF NOT EXISTS contact_consolidations_canonical_idx
        ON contact_consolidations (canonical_contact_id);

      DELETE FROM contact_consolidations;

      WITH contact_candidates AS (
        SELECT
          c.id AS contact_id,
          CASE
            WHEN nullif(lower(btrim(c.email)), '') IS NOT NULL THEN
              'email:'
              || lower(regexp_replace(btrim(concat_ws(' ', c.first_name, c.last_name)), '[^a-z0-9]+', '', 'g'))
              || ':' || lower(btrim(c.email))
            WHEN nullif(btrim(c.normalized_phone), '') IS NOT NULL THEN
              'phone:'
              || lower(regexp_replace(btrim(concat_ws(' ', c.first_name, c.last_name)), '[^a-z0-9]+', '', 'g'))
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
        WHERE identity_key IS NOT NULL
          AND identity_key NOT IN ('email::', 'phone::')
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

      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS filler boolean DEFAULT false NOT NULL;
'''
    value = replace_once(value, anchor, replacement, "profile touch contact consolidation")
    write(path, value)


def patch_contact_repository() -> None:
    path = "artifacts/api-server/src/features/contacts/contact-repository.ts"
    value = read(path)
    value = replace_once(
        value,
        '''function normalizedText(value: string | null) {
  return value?.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ") ?? "";
}
''',
        '''function normalizedText(value: string | null) {
  return value?.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ") ?? "";
}

export function canonicalContactCondition() {
  return sql<boolean>`not exists (
    select 1 from contact_consolidations cc
    where cc.source_contact_id = ${contacts.id}
  )`;
}
''',
        "contact repository canonical condition",
    )
    value = replace_once(
        value,
        '''    .from(contacts)
    .where(or(phoneMatch, emailMatch))
    .limit(1);''',
        '''    .from(contacts)
    .where(and(canonicalContactCondition(), or(phoneMatch, emailMatch)))
    .limit(1);''',
        "quick caller exact canonical filter",
    )
    value = replace_once(
        value,
        '''    .where(
      or(
        phoneMatch,
        emailMatch,
        sql`${nameMatch} and ${organizationMatch}`,
        sql`${nameMatch} and ${locationMatch}`,
      ),
    )''',
        '''    .where(
      and(
        canonicalContactCondition(),
        or(
          phoneMatch,
          emailMatch,
          sql`${nameMatch} and ${organizationMatch}`,
          sql`${nameMatch} and ${locationMatch}`,
        ),
      ),
    )''',
        "quick caller duplicate canonical filter",
    )
    value = replace_once(
        value,
        '''    const condition =
      and(
        buildContactSearchCondition(query.search) ?? undefined,
        syncStateCondition(query.state) ?? undefined,
      ) ?? undefined;''',
        '''    const condition =
      and(
        canonicalContactCondition(),
        buildContactSearchCondition(query.search) ?? undefined,
        syncStateCondition(query.state) ?? undefined,
      ) ?? undefined;''',
        "contact directory canonical filter",
    )
    write(path, value)


def patch_organization_directory() -> None:
    path = "artifacts/api-server/src/features/organizations/organization-directory-page.ts"
    value = read(path)
    value = replace_once(
        value,
        '''  const bookingCondition = query.hasBooking
    ? sql`exists (select 1 from ${bookings} b where b.organization_id = ${organizations.id})`
    : undefined;''',
        '''  const bookingCondition = query.hasBooking
    ? sql`exists (
        select 1 from ${bookings} b
        where b.organization_id = ${organizations.id}
          and coalesce(b.notes, '') not like '[Merged duplicate] Canonical booking:%'
      )`
    : undefined;''',
        "organization has booking canonical filter",
    )
    value = replace_once(
        value,
        '''      .where(and(inArray(organizationContacts.organizationId, organizationIds), eq(organizationContacts.active, true)))
      .groupBy(organizationContacts.organizationId),''',
        '''      .where(and(
        inArray(organizationContacts.organizationId, organizationIds),
        eq(organizationContacts.active, true),
        sql`not exists (
          select 1 from contact_consolidations cc
          where cc.source_contact_id = ${organizationContacts.contactId}
        )`,
      ))
      .groupBy(organizationContacts.organizationId),''',
        "organization contact count canonical filter",
    )
    value = replace_once(
        value,
        '''      .where(inArray(bookings.organizationId, organizationIds))
      .groupBy(bookings.organizationId),''',
        '''      .where(and(
        inArray(bookings.organizationId, organizationIds),
        sql`coalesce(${bookings.notes}, '') not like '[Merged duplicate] Canonical booking:%'`,
      ))
      .groupBy(bookings.organizationId),''',
        "organization booking count canonical filter",
    )
    value = replace_once(
        value,
        '''        eq(organizationContacts.active, true),
        eq(organizationContacts.isPrimary, true),
      )),''',
        '''        eq(organizationContacts.active, true),
        eq(organizationContacts.isPrimary, true),
        sql`not exists (
          select 1 from contact_consolidations cc
          where cc.source_contact_id = ${organizationContacts.contactId}
        )`,
      )),''',
        "organization primary contact canonical filter",
    )
    write(path, value)


if __name__ == "__main__":
    patch_event_profile_repository()
    patch_assistant_import()
    patch_profile_touch_schema()
    patch_contact_repository()
    patch_organization_directory()
    print("Applied canonical profile child repair.")
