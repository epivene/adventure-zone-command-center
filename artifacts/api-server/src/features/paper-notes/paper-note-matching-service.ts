import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";
import { normalizePaperNoteRegion } from "./paper-note-region-normalization";
import type { PaperNoteReviewDraft } from "./paper-note-review-initializer";

export type PaperNoteMatchPhone = {
  id: string;
  organizationLocationId?: string | null;
  number: string;
  extension: string | null;
  type: "mobile" | "office" | "alternate" | "unknown";
  label: string | null;
  instructions: string | null;
  status: "active" | "questionable" | "inactive";
  primary: boolean;
};

export type PaperNoteMatchContact = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phones: PaperNoteMatchPhone[];
};

export type PaperNoteMatchDetails = {
  contacts: PaperNoteMatchContact[];
  organizationPhones: PaperNoteMatchPhone[];
};

export type PaperNoteMatchCandidate = {
  organizationId: string;
  organizationLocationId: string | null;
  name: string;
  city: string | null;
  region: string | null;
  exactPhone: boolean;
  compatibleExtension: boolean;
  exactEmail: boolean;
  exactName: boolean;
  sameCityRegion: boolean;
  venueMatch: boolean;
  contactNameMatch: boolean;
};

export type PaperNoteMatch = {
  organizationId: string;
  organizationLocationId: string | null;
  name: string;
  city: string | null;
  region: string | null;
  strength: "strong" | "possible";
  score: number;
  reasons: string[];
  contacts: PaperNoteMatchContact[];
  organizationPhones: PaperNoteMatchPhone[];
};

export interface PaperNoteMatchRepository {
  findCandidates(review: PaperNoteReviewDraft): Promise<PaperNoteMatchCandidate[]>;
  findDetails?(organizationIds: string[]): Promise<Map<string, PaperNoteMatchDetails>>;
}

function score(candidate: PaperNoteMatchCandidate) {
  let value = 0;
  const reasons: string[] = [];
  if (candidate.exactPhone) {
    value += candidate.compatibleExtension ? 110 : 100;
    reasons.push(candidate.compatibleExtension
      ? "same phone number and extension"
      : "same phone number");
  }
  if (candidate.exactEmail) {
    value += 90;
    reasons.push("same email address");
  }
  if (candidate.exactName && candidate.sameCityRegion) {
    value += 70;
    reasons.push("same event/profile name and city/state");
  } else if (candidate.exactName) {
    value += 45;
    reasons.push("same event/profile name");
  } else if (candidate.sameCityRegion) {
    value += 15;
    reasons.push("same city/state");
  }
  if (candidate.venueMatch) {
    value += 30;
    reasons.push("same venue");
  }
  if (candidate.contactNameMatch) {
    value += 25;
    reasons.push("same contact name");
  }
  return { value, reasons };
}

const emptyDetails = (): PaperNoteMatchDetails => ({ contacts: [], organizationPhones: [] });

export class PaperNoteMatchingService {
  constructor(private readonly repository: PaperNoteMatchRepository) {}

  async match(review: PaperNoteReviewDraft): Promise<PaperNoteMatch[]> {
    const candidates = await this.repository.findCandidates(review);
    const ranked = candidates
      .map((candidate) => {
        const ranking = score(candidate);
        return {
          organizationId: candidate.organizationId,
          organizationLocationId: candidate.organizationLocationId,
          name: candidate.name,
          city: candidate.city,
          region: candidate.region,
          strength: ranking.value >= 80 ? "strong" as const : "possible" as const,
          score: ranking.value,
          reasons: ranking.reasons.length ? ranking.reasons : ["similar profile/location details"],
        };
      })
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
      .slice(0, 5);
    const details = this.repository.findDetails
      ? await this.repository.findDetails([...new Set(ranked.map((candidate) => candidate.organizationId))])
      : new Map<string, PaperNoteMatchDetails>();
    return ranked.map((candidate) => ({
      ...candidate,
      ...(details.get(candidate.organizationId) ?? emptyDetails()),
    }));
  }
}

type DrizzleDatabase = typeof database;

export function paperNoteTextArraySql(values: string[]) {
  if (!values.length) return sql`array[]::text[]`;
  return sql`array[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`;
}

function paperNoteUuidArraySql(values: string[]) {
  if (!values.length) return sql`array[]::uuid[]`;
  return sql`array[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::uuid[]`;
}

function normalizedName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function firstSearchToken(value: string) {
  return normalizedName(value)
    .split(" ")
    .find((token) => token.length >= 4) ?? "";
}

function phoneType(value: unknown): PaperNoteMatchPhone["type"] {
  return ["mobile", "office", "alternate", "unknown"].includes(String(value))
    ? String(value) as PaperNoteMatchPhone["type"]
    : "unknown";
}

function phoneStatus(value: unknown): PaperNoteMatchPhone["status"] {
  return ["active", "questionable", "inactive"].includes(String(value))
    ? String(value) as PaperNoteMatchPhone["status"]
    : "active";
}

export class PostgresPaperNoteMatchRepository implements PaperNoteMatchRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async findCandidates(review: PaperNoteReviewDraft): Promise<PaperNoteMatchCandidate[]> {
    const eventName = review.event.name.trim();
    const eventNameNormalized = normalizedName(eventName);
    const city = review.event.city.trim();
    const region = normalizePaperNoteRegion(review.event.region) ?? "";
    const venue = review.event.venue.trim();
    const contactNames = review.contacts.map((contact) => normalizedName(contact.name)).filter(Boolean);
    const emails = review.contacts
      .map((contact) => contact.email?.trim().toLowerCase() ?? "")
      .filter(Boolean);
    const paperPhones = [
      ...review.organizationPhones,
      ...review.contacts.flatMap((contact) => contact.phones),
    ].flatMap((phone) => {
      const normalized = normalizeNorthAmericanPhone(phone.number);
      return normalized ? [{ normalized, extension: phone.extension?.trim() || null }] : [];
    });
    const phoneNumbers = [...new Set(paperPhones.map((phone) => phone.normalized))];
    const extensions = [...new Set(paperPhones.flatMap((phone) => phone.extension ? [phone.extension] : []))];
    const token = firstSearchToken(eventName);

    if (!eventName && !city && !region && !emails.length && !phoneNumbers.length) return [];

    const phoneNumbersSql = paperNoteTextArraySql(phoneNumbers);
    const extensionsSql = paperNoteTextArraySql(extensions);
    const emailsSql = paperNoteTextArraySql(emails);
    const contactNamesSql = paperNoteTextArraySql(contactNames);

    const result = await this.database.execute(sql`
      select distinct
        org.id as "organizationId",
        (
          select loc.id
          from organization_locations loc
          where loc.organization_id = org.id
            and (${city} = '' or lower(coalesce(loc.city, '')) = lower(${city}))
            and (${region} = '' or upper(coalesce(loc.region, '')) = ${region})
          order by loc.created_at asc
          limit 1
        ) as "organizationLocationId",
        org.name,
        coalesce(
          (select loc.city from organization_locations loc where loc.organization_id = org.id and loc.city is not null order by loc.created_at asc limit 1),
          org.city
        ) as city,
        coalesce(
          (select loc.region from organization_locations loc where loc.organization_id = org.id and loc.region is not null order by loc.created_at asc limit 1),
          org.region
        ) as region,
        (
          (${phoneNumbersSql} <> '{}'::text[])
          and (
            coalesce(org.normalized_phone, '') = any(${phoneNumbersSql})
            or exists (
              select 1 from organization_phones op
              where op.organization_id = org.id
                and op.normalized_number = any(${phoneNumbersSql})
            )
            or exists (
              select 1 from contacts c
              where c.organization_id = org.id
                and coalesce(c.normalized_phone, '') = any(${phoneNumbersSql})
            )
            or exists (
              select 1 from contacts c
              join contact_phones cp on cp.contact_id = c.id
              where c.organization_id = org.id
                and cp.normalized_number = any(${phoneNumbersSql})
            )
            or exists (
              select 1 from organization_contacts oc
              join contact_phones cp on cp.contact_id = oc.contact_id
              where oc.organization_id = org.id
                and oc.active = true
                and cp.normalized_number = any(${phoneNumbersSql})
            )
          )
        ) as "exactPhone",
        (
          ${extensionsSql} = '{}'::text[]
          or exists (
            select 1 from organization_phones op
            where op.organization_id = org.id
              and op.normalized_number = any(${phoneNumbersSql})
              and coalesce(op.extension, '') = any(${extensionsSql})
          )
          or exists (
            select 1 from contacts c
            join contact_phones cp on cp.contact_id = c.id
            where c.organization_id = org.id
              and cp.normalized_number = any(${phoneNumbersSql})
              and coalesce(cp.extension, '') = any(${extensionsSql})
          )
          or exists (
            select 1 from organization_contacts oc
            join contact_phones cp on cp.contact_id = oc.contact_id
            where oc.organization_id = org.id
              and oc.active = true
              and cp.normalized_number = any(${phoneNumbersSql})
              and coalesce(cp.extension, '') = any(${extensionsSql})
          )
        ) as "compatibleExtension",
        (
          ${emailsSql} <> '{}'::text[]
          and (
            exists (
              select 1 from contacts c
              where c.organization_id = org.id
                and lower(coalesce(c.email, '')) = any(${emailsSql})
            )
            or exists (
              select 1 from organization_contacts oc
              join contacts c on c.id = oc.contact_id
              where oc.organization_id = org.id
                and oc.active = true
                and lower(coalesce(c.email, '')) = any(${emailsSql})
            )
          )
        ) as "exactEmail",
        (${eventNameNormalized} <> '' and lower(regexp_replace(trim(org.name), '[^a-zA-Z0-9]+', ' ', 'g')) = ${eventNameNormalized}) as "exactName",
        (
          (${city} = '' or lower(coalesce(org.city, '')) = lower(${city}) or exists (
            select 1 from organization_locations loc where loc.organization_id = org.id and lower(coalesce(loc.city, '')) = lower(${city})
          ))
          and (${region} = '' or upper(coalesce(org.region, '')) = ${region} or exists (
            select 1 from organization_locations loc where loc.organization_id = org.id and upper(coalesce(loc.region, '')) = ${region}
          ))
        ) as "sameCityRegion",
        (
          ${venue} <> '' and exists (
            select 1 from organization_locations loc
            where loc.organization_id = org.id
              and lower(trim(coalesce(loc.venue_name, ''))) = lower(trim(${venue}))
          )
        ) as "venueMatch",
        (
          ${contactNamesSql} <> '{}'::text[] and (
            exists (
              select 1 from contacts c
              where c.organization_id = org.id
                and lower(trim(concat_ws(' ', c.first_name, c.last_name))) = any(${contactNamesSql})
            )
            or exists (
              select 1 from organization_contacts oc
              join contacts c on c.id = oc.contact_id
              where oc.organization_id = org.id
                and oc.active = true
                and lower(trim(concat_ws(' ', c.first_name, c.last_name))) = any(${contactNamesSql})
            )
          )
        ) as "contactNameMatch"
      from organizations org
      where org.consolidated_into_id is null
        and (
          (${eventNameNormalized} <> '' and lower(regexp_replace(trim(org.name), '[^a-zA-Z0-9]+', ' ', 'g')) = ${eventNameNormalized})
          or (${token} <> '' and lower(org.name) like ${`%${token}%`})
          or (${city} <> '' and lower(coalesce(org.city, '')) = lower(${city}))
          or (${region} <> '' and upper(coalesce(org.region, '')) = ${region})
          or (${emailsSql} <> '{}'::text[] and (
            exists (select 1 from contacts c where c.organization_id = org.id and lower(coalesce(c.email, '')) = any(${emailsSql}))
            or exists (select 1 from organization_contacts oc join contacts c on c.id = oc.contact_id where oc.organization_id = org.id and oc.active = true and lower(coalesce(c.email, '')) = any(${emailsSql}))
          ))
          or (${phoneNumbersSql} <> '{}'::text[] and (
            coalesce(org.normalized_phone, '') = any(${phoneNumbersSql})
            or exists (select 1 from organization_phones op where op.organization_id = org.id and op.normalized_number = any(${phoneNumbersSql}))
            or exists (select 1 from contacts c join contact_phones cp on cp.contact_id = c.id where c.organization_id = org.id and cp.normalized_number = any(${phoneNumbersSql}))
            or exists (select 1 from organization_contacts oc join contact_phones cp on cp.contact_id = oc.contact_id where oc.organization_id = org.id and oc.active = true and cp.normalized_number = any(${phoneNumbersSql}))
          ))
          or exists (
            select 1 from organization_locations loc
            where loc.organization_id = org.id
              and ((${city} <> '' and lower(coalesce(loc.city, '')) = lower(${city}) or (${venue} <> '' and lower(trim(coalesce(loc.venue_name, ''))) = lower(trim(${venue}))))
          )
        )
      order by org.name asc
      limit 40
    `);

    return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? []).map((row) => ({
      organizationId: String(row.organizationId),
      organizationLocationId: row.organizationLocationId ? String(row.organizationLocationId) : null,
      name: String(row.name ?? ""),
      city: row.city ? String(row.city) : null,
      region: row.region ? String(row.region) : null,
      exactPhone: Boolean(row.exactPhone),
      compatibleExtension: Boolean(row.compatibleExtension),
      exactEmail: Boolean(row.exactEmail),
      exactName: Boolean(row.exactName),
      sameCityRegion: Boolean(row.sameCityRegion),
      venueMatch: Boolean(row.venueMatch),
      contactNameMatch: Boolean(row.contactNameMatch),
    }));
  }

  async findDetails(organizationIds: string[]): Promise<Map<string, PaperNoteMatchDetails>> {
    const output = new Map<string, PaperNoteMatchDetails>();
    if (!organizationIds.length) return output;
    const organizationIdsSql = paperNoteUuidArraySql(organizationIds);

    const relationshipContactResult = await this.database.execute(sql`
      select
        oc.organization_id as "organizationId",
        c.id,
        trim(concat_ws(' ', c.first_name, c.last_name)) as name,
        oc.role,
        c.email
      from organization_contacts oc
      join contacts c on c.id = oc.contact_id
      where oc.organization_id = any(${organizationIdsSql})
        and oc.active = true
      order by oc.organization_id, oc.is_primary desc, c.last_name, c.first_name, c.id
    `);
    const directContactResult = await this.database.execute(sql`
      select
        c.organization_id as "organizationId",
        c.id,
        trim(concat_ws(' ', c.first_name, c.last_name)) as name,
        c.job_title as role,
        c.email
      from contacts c
      where c.organization_id = any(${organizationIdsSql})
      order by c.organization_id, c.last_name, c.first_name, c.id
    `);

    const contactRowsByKey = new Map<string, Record<string, unknown>>();
    const relationshipRows = (relationshipContactResult as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    const directRows = (directContactResult as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    for (const row of [...relationshipRows, ...directRows]) {
      const key = `${String(row.organizationId)}:${String(row.id)}`;
      if (!contactRowsByKey.has(key)) contactRowsByKey.set(key, row);
    }
    const contactRows = [...contactRowsByKey.values()];
    const contactIds = [...new Set(contactRows.map((row) => String(row.id)))];
    const phonesByContact = new Map<string, PaperNoteMatchPhone[]>();
    if (contactIds.length) {
      const contactIdsSql = paperNoteUuidArraySql(contactIds);
      const phoneResult = await this.database.execute(sql`
        select
          contact_id as "contactId",
          id,
          number,
          extension,
          type::text as type,
          label,
          instructions,
          status::text as status,
          "primary" as "primary"
        from contact_phones
        where contact_id = any(${contactIdsSql})
        order by contact_id, "primary" desc, created_at, id
      `);
      for (const row of (phoneResult as { rows?: Array<Record<string, unknown>> }).rows ?? []) {
        const contactId = String(row.contactId);
        const list = phonesByContact.get(contactId) ?? [];
        list.push({
          id: String(row.id),
          number: String(row.number ?? ""),
          extension: row.extension ? String(row.extension) : null,
          type: phoneType(row.type),
          label: row.label ? String(row.label) : null,
          instructions: row.instructions ? String(row.instructions) : null,
          status: phoneStatus(row.status),
          primary: Boolean(row.primary),
        });
        phonesByContact.set(contactId, list);
      }
    }

    for (const row of contactRows) {
      const organizationId = String(row.organizationId);
      const detail = output.get(organizationId) ?? emptyDetails();
      detail.contacts.push({
        id: String(row.id),
        name: String(row.name ?? ""),
        role: row.role ? String(row.role) : null,
        email: row.email ? String(row.email) : null,
        phones: phonesByContact.get(String(row.id)) ?? [],
      });
      output.set(organizationId, detail);
    }

    const organizationPhoneResult = await this.database.execute(sql`
      select
        organization_id as "organizationId",
        organization_location_id as "organizationLocationId",
        id,
        number,
        extension,
        type::text as type,
        label,
        instructions,
        status::text as status,
        "primary" as "primary"
      from organization_phones
      where organization_id = any(${organizationIdsSql})
      order by organization_id, "primary" desc, created_at, id
    `);
    for (const row of (organizationPhoneResult as { rows?: Array<Record<string, unknown>> }).rows ?? []) {
      const organizationId = String(row.organizationId);
      const detail = output.get(organizationId) ?? emptyDetails();
      detail.organizationPhones.push({
        id: String(row.id),
        organizationLocationId: row.organizationLocationId ? String(row.organizationLocationId) : null,
        number: String(row.number ?? ""),
        extension: row.extension ? String(row.extension) : null,
        type: phoneType(row.type),
        label: row.label ? String(row.label) : null,
        instructions: row.instructions ? String(row.instructions) : null,
        status: phoneStatus(row.status),
        primary: Boolean(row.primary),
      });
      output.set(organizationId, detail);
    }

    for (const id of organizationIds) {
      if (!output.has(id)) output.set(id, emptyDetails());
    }
    return output;
  }
}
