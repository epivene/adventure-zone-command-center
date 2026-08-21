import { sql, type SQL } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";
import { normalizePaperNoteRegion } from "./paper-note-region-normalization";
import type { PaperNoteReviewDraft } from "./paper-note-review-initializer";
import {
  PostgresPaperNoteMatchRepository,
  type PaperNoteMatchCandidate,
  type PaperNoteMatchDetails,
  type PaperNoteMatchRepository,
} from "./paper-note-matching-service";

type DrizzleDatabase = typeof database;

type CandidateQueryInput = {
  eventName: string;
  eventNameNormalized: string;
  city: string;
  region: string;
  venue: string;
  token: string;
  phoneNumbers: string[];
  extensions: string[];
  emails: string[];
  contactNames: string[];
};

function textArray(values: string[]) {
  return sql`array[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`;
}

function normalizedName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function firstSearchToken(value: string) {
  return normalizedName(value).split(" ").find((token) => token.length >= 4) ?? "";
}

export function buildPaperNoteCandidateQuery(input: CandidateQueryInput): SQL {
  const phoneSql = input.phoneNumbers.length ? textArray(input.phoneNumbers) : null;
  const extensionSql = input.extensions.length ? textArray(input.extensions) : null;
  const emailSql = input.emails.length ? textArray(input.emails) : null;
  const contactNameSql = input.contactNames.length ? textArray(input.contactNames) : null;

  const exactPhone = phoneSql ? sql`(
    coalesce(org.normalized_phone, '') = any(${phoneSql})
    or exists (select 1 from organization_phones op where op.organization_id = org.id and op.normalized_number = any(${phoneSql}))
    or exists (select 1 from contacts c where c.organization_id = org.id and coalesce(c.normalized_phone, '') = any(${phoneSql}))
    or exists (select 1 from contacts c join contact_phones cp on cp.contact_id = c.id where c.organization_id = org.id and cp.normalized_number = any(${phoneSql}))
    or exists (select 1 from organization_contacts oc join contact_phones cp on cp.contact_id = oc.contact_id where oc.organization_id = org.id and oc.active = true and cp.normalized_number = any(${phoneSql}))
  ) as "exactPhone"` : sql`false as "exactPhone"`;

  const compatibleExtension = extensionSql && phoneSql ? sql`(
    exists (select 1 from organization_phones op where op.organization_id = org.id and op.normalized_number = any(${phoneSql}) and coalesce(op.extension, '') = any(${extensionSql}))
    or exists (select 1 from contacts c join contact_phones cp on cp.contact_id = c.id where c.organization_id = org.id and cp.normalized_number = any(${phoneSql}) and coalesce(cp.extension, '') = any(${extensionSql}))
    or exists (select 1 from organization_contacts oc join contact_phones cp on cp.contact_id = oc.contact_id where oc.organization_id = org.id and oc.active = true and cp.normalized_number = any(${phoneSql}) and coalesce(cp.extension, '') = any(${extensionSql}))
  ) as "compatibleExtension"` : sql`true as "compatibleExtension"`;

  const exactEmail = emailSql ? sql`(
    exists (select 1 from contacts c where c.organization_id = org.id and lower(coalesce(c.email, '')) = any(${emailSql}))
    or exists (select 1 from organization_contacts oc join contacts c on c.id = oc.contact_id where oc.organization_id = org.id and oc.active = true and lower(coalesce(c.email, '')) = any(${emailSql}))
  ) as "exactEmail"` : sql`false as "exactEmail"`;

  const contactNameMatch = contactNameSql ? sql`(
    exists (select 1 from contacts c where c.organization_id = org.id and lower(trim(concat_ws(' ', c.first_name, c.last_name))) = any(${contactNameSql}))
    or exists (select 1 from organization_contacts oc join contacts c on c.id = oc.contact_id where oc.organization_id = org.id and oc.active = true and lower(trim(concat_ws(' ', c.first_name, c.last_name))) = any(${contactNameSql}))
  ) as "contactNameMatch"` : sql`false as "contactNameMatch"`;

  const searchClauses: SQL[] = [];
  if (input.eventNameNormalized) searchClauses.push(sql`lower(regexp_replace(trim(org.name), '[^a-zA-Z0-9]+', ' ', 'g')) = ${input.eventNameNormalized}`);
  if (input.token) searchClauses.push(sql`lower(org.name) like ${`%${input.token}%`}`);
  if (input.city) searchClauses.push(sql`lower(coalesce(org.city, '')) = lower(${input.city})`);
  if (input.region) searchClauses.push(sql`upper(coalesce(org.region, '')) = ${input.region}`);
  if (emailSql) searchClauses.push(sql`(
    exists (select 1 from contacts c where c.organization_id = org.id and lower(coalesce(c.email, '')) = any(${emailSql}))
    or exists (select 1 from organization_contacts oc join contacts c on c.id = oc.contact_id where oc.organization_id = org.id and oc.active = true and lower(coalesce(c.email, '')) = any(${emailSql}))
  )`);
  if (phoneSql) searchClauses.push(sql`(
    coalesce(org.normalized_phone, '') = any(${phoneSql})
    or exists (select 1 from organization_phones op where op.organization_id = org.id and op.normalized_number = any(${phoneSql}))
    or exists (select 1 from contacts c join contact_phones cp on cp.contact_id = c.id where c.organization_id = org.id and cp.normalized_number = any(${phoneSql}))
    or exists (select 1 from organization_contacts oc join contact_phones cp on cp.contact_id = oc.contact_id where oc.organization_id = org.id and oc.active = true and cp.normalized_number = any(${phoneSql}))
  )`);
  if (input.city || input.venue) searchClauses.push(sql`exists (
    select 1 from organization_locations loc
    where loc.organization_id = org.id
      and (${input.city ? sql`lower(coalesce(loc.city, '')) = lower(${input.city})` : sql`false`}
        or ${input.venue ? sql`lower(trim(coalesce(loc.venue_name, ''))) = lower(trim(${input.venue}))` : sql`false`})
  )`);

  const whereMatches = searchClauses.length ? sql.join(searchClauses, sql` or `) : sql`false`;

  return sql`
    select distinct
      org.id as "organizationId",
      (
        select loc.id from organization_locations loc
        where loc.organization_id = org.id
          and (${input.city} = '' or lower(coalesce(loc.city, '')) = lower(${input.city}))
          and (${input.region} = '' or upper(coalesce(loc.region, '')) = ${input.region})
        order by loc.created_at asc limit 1
      ) as "organizationLocationId",
      org.name,
      coalesce((select loc.city from organization_locations loc where loc.organization_id = org.id and loc.city is not null order by loc.created_at asc limit 1), org.city) as city,
      coalesce((select loc.region from organization_locations loc where loc.organization_id = org.id and loc.region is not null order by loc.created_at asc limit 1), org.region) as region,
      ${exactPhone},
      ${compatibleExtension},
      ${exactEmail},
      (${input.eventNameNormalized} <> '' and lower(regexp_replace(trim(org.name), '[^a-zA-Z0-9]+', ' ', 'g')) = ${input.eventNameNormalized}) as "exactName",
      (
        (${input.city} = '' or lower(coalesce(org.city, '')) = lower(${input.city}) or exists (select 1 from organization_locations loc where loc.organization_id = org.id and lower(coalesce(loc.city, '')) = lower(${input.city})))
        and (${input.region} = '' or upper(coalesce(org.region, '')) = ${input.region} or exists (select 1 from organization_locations loc where loc.organization_id = org.id and upper(coalesce(loc.region, '')) = ${input.region}))
      ) as "sameCityRegion",
      (${input.venue} <> '' and exists (select 1 from organization_locations loc where loc.organization_id = org.id and lower(trim(coalesce(loc.venue_name, ''))) = lower(trim(${input.venue})))) as "venueMatch",
      ${contactNameMatch}
    from organizations org
    where org.consolidated_into_id is null
      and (${whereMatches})
    order by org.name asc
    limit 40
  `;
}

export class SafePostgresPaperNoteMatchRepository implements PaperNoteMatchRepository {
  private readonly detailsRepository: PostgresPaperNoteMatchRepository;

  constructor(private readonly database: DrizzleDatabase) {
    this.detailsRepository = new PostgresPaperNoteMatchRepository(database);
  }

  async findCandidates(review: PaperNoteReviewDraft): Promise<PaperNoteMatchCandidate[]> {
    const eventName = review.event.name.trim();
    const city = review.event.city.trim();
    const region = normalizePaperNoteRegion(review.event.region) ?? "";
    const venue = review.event.venue.trim();
    const contactNames = review.contacts.map((contact) => normalizedName(contact.name)).filter(Boolean);
    const emails = review.contacts.map((contact) => contact.email?.trim().toLowerCase() ?? "").filter(Boolean);
    const paperPhones = [...review.organizationPhones, ...review.contacts.flatMap((contact) => contact.phones)].flatMap((phone) => {
      const normalized = normalizeNorthAmericanPhone(phone.number);
      return normalized ? [{ normalized, extension: phone.extension?.trim() || null }] : [];
    });
    const phoneNumbers = [...new Set(paperPhones.map((phone) => phone.normalized))];
    const extensions = [...new Set(paperPhones.flatMap((phone) => phone.extension ? [phone.extension] : []))];
    const eventNameNormalized = normalizedName(eventName);
    const token = firstSearchToken(eventName);

    if (!eventName && !city && !region && !emails.length && !phoneNumbers.length) return [];

    const result = await this.database.execute(buildPaperNoteCandidateQuery({
      eventName,
      eventNameNormalized,
      city,
      region,
      venue,
      token,
      phoneNumbers,
      extensions,
      emails,
      contactNames,
    }));

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

  findDetails(organizationIds: string[]): Promise<Map<string, PaperNoteMatchDetails>> {
    return this.detailsRepository.findDetails(organizationIds);
  }
}
