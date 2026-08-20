import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";
import type { PaperNoteReviewDraft } from "./paper-note-review-initializer";

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
};

export interface PaperNoteMatchRepository {
  findCandidates(review: PaperNoteReviewDraft): Promise<PaperNoteMatchCandidate[]>;
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

export class PaperNoteMatchingService {
  constructor(private readonly repository: PaperNoteMatchRepository) {}

  async match(review: PaperNoteReviewDraft): Promise<PaperNoteMatch[]> {
    const candidates = await this.repository.findCandidates(review);
    return candidates
      .map((candidate) => {
        const ranked = score(candidate);
        return {
          organizationId: candidate.organizationId,
          organizationLocationId: candidate.organizationLocationId,
          name: candidate.name,
          city: candidate.city,
          region: candidate.region,
          strength: ranked.value >= 80 ? "strong" as const : "possible" as const,
          score: ranked.value,
          reasons: ranked.reasons.length ? ranked.reasons : ["similar profile/location details"],
        };
      })
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
      .slice(0, 5);
  }
}

type DrizzleDatabase = typeof database;

function normalizedName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function firstSearchToken(value: string) {
  return normalizedName(value)
    .split(" ")
    .find((token) => token.length >= 4) ?? "";
}

export class PostgresPaperNoteMatchRepository implements PaperNoteMatchRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async findCandidates(review: PaperNoteReviewDraft): Promise<PaperNoteMatchCandidate[]> {
    const eventName = review.event.name.trim();
    const eventNameNormalized = normalizedName(eventName);
    const city = review.event.city.trim();
    const region = review.event.region.trim().toUpperCase();
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
          (${phoneNumbers}::text[] <> '{}'::text[])
          and (
            coalesce(org.normalized_phone, '') = any(${phoneNumbers}::text[])
            or exists (
              select 1 from organization_phones op
              where op.organization_id = org.id
                and op.normalized_number = any(${phoneNumbers}::text[])
            )
            or exists (
              select 1 from contacts c
              where c.organization_id = org.id
                and coalesce(c.normalized_phone, '') = any(${phoneNumbers}::text[])
            )
            or exists (
              select 1 from contacts c
              join contact_phones cp on cp.contact_id = c.id
              where c.organization_id = org.id
                and cp.normalized_number = any(${phoneNumbers}::text[])
            )
          )
        ) as "exactPhone",
        (
          ${extensions}::text[] = '{}'::text[]
          or exists (
            select 1 from organization_phones op
            where op.organization_id = org.id
              and op.normalized_number = any(${phoneNumbers}::text[])
              and coalesce(op.extension, '') = any(${extensions}::text[])
          )
          or exists (
            select 1 from contacts c
            join contact_phones cp on cp.contact_id = c.id
            where c.organization_id = org.id
              and cp.normalized_number = any(${phoneNumbers}::text[])
              and coalesce(cp.extension, '') = any(${extensions}::text[])
          )
        ) as "compatibleExtension",
        (
          ${emails}::text[] <> '{}'::text[]
          and exists (
            select 1 from contacts c
            where c.organization_id = org.id
              and lower(coalesce(c.email, '')) = any(${emails}::text[])
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
          ${contactNames}::text[] <> '{}'::text[] and exists (
            select 1 from contacts c
            where c.organization_id = org.id
              and lower(trim(concat_ws(' ', c.first_name, c.last_name))) = any(${contactNames}::text[])
          )
        ) as "contactNameMatch"
      from organizations org
      where org.consolidated_into_id is null
        and (
          (${eventNameNormalized} <> '' and lower(regexp_replace(trim(org.name), '[^a-zA-Z0-9]+', ' ', 'g')) = ${eventNameNormalized})
          or (${token} <> '' and lower(org.name) like ${`%${token}%`})
          or (${city} <> '' and lower(coalesce(org.city, '')) = lower(${city}))
          or (${region} <> '' and upper(coalesce(org.region, '')) = ${region})
          or (${emails}::text[] <> '{}'::text[] and exists (
            select 1 from contacts c where c.organization_id = org.id and lower(coalesce(c.email, '')) = any(${emails}::text[])
          ))
          or (${phoneNumbers}::text[] <> '{}'::text[] and (
            coalesce(org.normalized_phone, '') = any(${phoneNumbers}::text[])
            or exists (select 1 from organization_phones op where op.organization_id = org.id and op.normalized_number = any(${phoneNumbers}::text[]))
            or exists (select 1 from contacts c join contact_phones cp on cp.contact_id = c.id where c.organization_id = org.id and cp.normalized_number = any(${phoneNumbers}::text[]))
          ))
          or exists (
            select 1 from organization_locations loc
            where loc.organization_id = org.id
              and ((${city} <> '' and lower(coalesce(loc.city, '')) = lower(${city})) or (${venue} <> '' and lower(trim(coalesce(loc.venue_name, ''))) = lower(trim(${venue}))))
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
}
