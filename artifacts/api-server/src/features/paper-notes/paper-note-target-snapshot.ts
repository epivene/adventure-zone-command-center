import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";
import type { PaperNoteReviewDraft } from "./paper-note-review-initializer";
import type { PaperNoteConflictDecision } from "./paper-note-review-schema";

type DrizzleDatabase = typeof database;

export type PaperNoteTargetSnapshotValue = {
  destination: null | {
    organization: Record<string, unknown>;
    location: Record<string, unknown> | null;
  };
  contacts: Array<Record<string, unknown>>;
  phones: Array<Record<string, unknown>>;
};

export type PaperNoteStoredTargetSnapshot = {
  version: 1;
  fingerprint: string;
  value: PaperNoteTargetSnapshotValue | Record<string, unknown>;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function fingerprintPaperNoteTarget(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function paperNoteTargetChanged(
  stored: PaperNoteStoredTargetSnapshot,
  currentValue: unknown,
): boolean {
  return stored.fingerprint !== fingerprintPaperNoteTarget(currentValue);
}

export function paperNoteTargetSnapshotHasMissing(value: PaperNoteTargetSnapshotValue): boolean {
  const missingRecord = (record: Record<string, unknown> | null) => record?.missing === true;
  return Boolean(
    value.destination && (
      missingRecord(value.destination.organization)
      || missingRecord(value.destination.location)
    )
    || value.contacts.some(missingRecord)
    || value.phones.some((phone) =>
      missingRecord((phone.referenced as Record<string, unknown> | null) ?? null)),
  );
}

function phoneConflict(
  review: PaperNoteReviewDraft,
  path: string,
): Extract<PaperNoteConflictDecision, { kind: "phone" }> | null {
  const value = review.conflicts[path] as PaperNoteConflictDecision | undefined;
  return value?.kind === "phone" ? value : null;
}

async function rows<T>(promise: Promise<unknown>): Promise<T[]> {
  const result = await promise as { rows?: T[] };
  return result.rows ?? [];
}

async function loadContactPhone(
  database: DrizzleDatabase,
  input: { contactId: string; id?: string | null; normalized?: string | null; extension?: string | null },
) {
  if (!input.id && !input.normalized) return null;
  const records = await rows<Record<string, unknown>>(database.execute(sql`
    select
      id,
      contact_id as "contactId",
      number,
      normalized_number as "normalizedNumber",
      extension,
      type::text as type,
      label,
      instructions,
      status::text as status,
      primary,
      do_not_call_at as "doNotCallAt",
      do_not_call_reason as "doNotCallReason"
    from contact_phones
    where contact_id = ${input.contactId}::uuid
      and (
        (${input.id ?? null}::uuid is not null and id = ${input.id ?? null}::uuid)
        or (
          ${input.normalized ?? null}::text is not null
          and normalized_number = ${input.normalized ?? null}
          and coalesce(extension, '') = coalesce(${input.extension ?? null}, '')
        )
      )
    order by case when id = ${input.id ?? null}::uuid then 0 else 1 end, id
    limit 1
  `));
  if (records[0]) return records[0];
  return input.id ? { missing: true, id: input.id, contactId: input.contactId } : null;
}

async function loadOrganizationPhone(
  database: DrizzleDatabase,
  input: {
    organizationId: string;
    organizationLocationId: string | null;
    id?: string | null;
    normalized?: string | null;
    extension?: string | null;
  },
) {
  if (!input.id && !input.normalized) return null;
  const records = await rows<Record<string, unknown>>(database.execute(sql`
    select
      id,
      organization_id as "organizationId",
      organization_location_id as "organizationLocationId",
      number,
      normalized_number as "normalizedNumber",
      extension,
      type::text as type,
      label,
      instructions,
      status::text as status,
      primary
    from organization_phones
    where organization_id = ${input.organizationId}::uuid
      and organization_location_id is not distinct from ${input.organizationLocationId}::uuid
      and (
        (${input.id ?? null}::uuid is not null and id = ${input.id ?? null}::uuid)
        or (
          ${input.normalized ?? null}::text is not null
          and normalized_number = ${input.normalized ?? null}
          and coalesce(extension, '') = coalesce(${input.extension ?? null}, '')
        )
      )
    order by case when id = ${input.id ?? null}::uuid then 0 else 1 end, id
    limit 1
  `));
  if (records[0]) return records[0];
  return input.id ? {
    missing: true,
    id: input.id,
    organizationId: input.organizationId,
    organizationLocationId: input.organizationLocationId,
  } : null;
}

export async function loadPaperNoteTargetSnapshotValue(
  database: DrizzleDatabase,
  review: PaperNoteReviewDraft,
): Promise<PaperNoteTargetSnapshotValue | null> {
  const destination = review.destination;
  if (!destination || destination.mode === "new_profile" || destination.mode === "skip") return null;

  const organizationRows = await rows<Record<string, unknown>>(database.execute(sql`
    select
      id,
      name,
      city,
      region,
      consolidated_into_id as "consolidatedIntoId"
    from organizations
    where id = ${destination.organizationId}::uuid
    limit 1
  `));
  const organization = organizationRows[0] ?? { missing: true, id: destination.organizationId };

  let location: Record<string, unknown> | null = null;
  const organizationLocationId = destination.mode === "existing_profile"
    ? destination.organizationLocationId
    : null;
  if (organizationLocationId) {
    const locationRows = await rows<Record<string, unknown>>(database.execute(sql`
      select
        id,
        organization_id as "organizationId",
        label,
        venue_name as "venueName",
        city,
        region
      from organization_locations
      where id = ${organizationLocationId}::uuid
        and organization_id = ${destination.organizationId}::uuid
      limit 1
    `));
    location = locationRows[0] ?? { missing: true, id: organizationLocationId };
  }

  const contacts: Array<Record<string, unknown>> = [];
  const phones: Array<Record<string, unknown>> = [];

  for (let contactIndex = 0; contactIndex < review.contacts.length; contactIndex += 1) {
    const contact = review.contacts[contactIndex]!;
    if (contact.mode !== "existing_contact" || !contact.selectedContactId) continue;
    const contactRows = await rows<Record<string, unknown>>(database.execute(sql`
      select
        id,
        first_name as "firstName",
        last_name as "lastName",
        email,
        organization_id as "organizationId",
        organization_location_id as "organizationLocationId"
      from contacts
      where id = ${contact.selectedContactId}::uuid
      limit 1
    `));
    contacts.push({
      key: contact.key,
      ...(contactRows[0] ?? { missing: true, id: contact.selectedContactId }),
    });

    for (let phoneIndex = 0; phoneIndex < contact.phones.length; phoneIndex += 1) {
      const paperPhone = contact.phones[phoneIndex]!;
      if (!paperPhone.importAsStructuredValue) continue;
      const path = `contacts.${contactIndex}.phones.${phoneIndex}`;
      const normalized = normalizeNorthAmericanPhone(paperPhone.number);
      const extension = paperPhone.extension?.trim() || null;
      const conflict = phoneConflict(review, path);
      const paperExact = normalized
        ? await loadContactPhone(database, {
            contactId: contact.selectedContactId,
            normalized,
            extension,
          })
        : null;
      const referenced = conflict?.existingPhoneId
        ? await loadContactPhone(database, {
            contactId: contact.selectedContactId,
            id: conflict.existingPhoneId,
          })
        : null;
      phones.push({ path, owner: "contact", paperExact, referenced });
    }
  }

  for (let phoneIndex = 0; phoneIndex < review.organizationPhones.length; phoneIndex += 1) {
    const paperPhone = review.organizationPhones[phoneIndex]!;
    if (!paperPhone.importAsStructuredValue) continue;
    const path = `organizationPhones.${phoneIndex}`;
    const normalized = normalizeNorthAmericanPhone(paperPhone.number);
    const extension = paperPhone.extension?.trim() || null;
    const conflict = phoneConflict(review, path);
    const phoneOwnerLocationId = destination.mode === "existing_profile"
      ? destination.organizationLocationId
      : null;
    const paperExact = normalized
      ? await loadOrganizationPhone(database, {
          organizationId: destination.organizationId,
          organizationLocationId: phoneOwnerLocationId,
          normalized,
          extension,
        })
      : null;
    const referenced = conflict?.existingPhoneId
      ? await loadOrganizationPhone(database, {
          organizationId: destination.organizationId,
          organizationLocationId: phoneOwnerLocationId,
          id: conflict.existingPhoneId,
        })
      : null;
    phones.push({ path, owner: "organization", paperExact, referenced });
  }

  return {
    destination: { organization, location },
    contacts,
    phones,
  };
}

export async function capturePaperNoteTargetSnapshot(
  database: DrizzleDatabase,
  review: PaperNoteReviewDraft,
): Promise<PaperNoteStoredTargetSnapshot | null> {
  const value = await loadPaperNoteTargetSnapshotValue(database, review);
  if (!value) return null;
  return {
    version: 1,
    fingerprint: fingerprintPaperNoteTarget(value),
    value,
  };
}
