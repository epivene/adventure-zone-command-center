import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { sql } from "drizzle-orm";

import { db } from "@workspace/db";
import { attachEventFamiliesToOrganizationPage } from "@/features/event-families/event-family-list";
import { DrizzleOrganizationRepository, type OrganizationListPage } from "@/features/organizations/organization-repository";
import { organizationListQuerySchema } from "@/features/organizations/last-resort-input";
import {
  buildProfileSearchTerms,
  profileSearchScore,
} from "@/features/organizations/profile-search";
import { DrizzleTravelLegRepository } from "@/features/routes/travel-leg-repository";

const router: IRouter = Router();
const MAX_SEARCH_CANDIDATES = 5_000;

function normalizedSearchField(expression: ReturnType<typeof sql.raw>) {
  return sql`regexp_replace(lower(coalesce(${expression}::text, '')), '[^a-z0-9]+', '', 'g')`;
}

function termCondition(term: string) {
  const pattern = `%${term}%`;
  return sql`(
    ${normalizedSearchField(sql.raw("o.name"))} like ${pattern}
    or ${normalizedSearchField(sql.raw("o.city"))} like ${pattern}
    or ${normalizedSearchField(sql.raw("o.region"))} like ${pattern}
    or ${normalizedSearchField(sql.raw("o.postal_code"))} like ${pattern}
    or ${normalizedSearchField(sql.raw("o.address_1"))} like ${pattern}
    or ${normalizedSearchField(sql.raw("o.website"))} like ${pattern}
    or ${normalizedSearchField(sql.raw("o.phone"))} like ${pattern}
    or exists (
      select 1
      from organization_contacts association
      inner join contacts person on person.id = association.contact_id
      where association.organization_id = o.id
        and association.active
        and (
          ${normalizedSearchField(sql.raw("person.first_name"))} like ${pattern}
          or ${normalizedSearchField(sql.raw("person.last_name"))} like ${pattern}
          or ${normalizedSearchField(sql.raw("concat_ws(' ', person.first_name, person.last_name)"))} like ${pattern}
          or ${normalizedSearchField(sql.raw("person.phone"))} like ${pattern}
          or ${normalizedSearchField(sql.raw("person.email"))} like ${pattern}
          or exists (
            select 1
            from contact_phones person_phone
            where person_phone.contact_id = person.id
              and ${normalizedSearchField(sql.raw("person_phone.number"))} like ${pattern}
          )
        )
    )
    or exists (
      select 1
      from organization_locations loc
      where loc.organization_id = o.id
        and (
          ${normalizedSearchField(sql.raw("loc.label"))} like ${pattern}
          or ${normalizedSearchField(sql.raw("loc.venue_name"))} like ${pattern}
          or ${normalizedSearchField(sql.raw("loc.city"))} like ${pattern}
          or ${normalizedSearchField(sql.raw("loc.region"))} like ${pattern}
          or ${normalizedSearchField(sql.raw("loc.postal_code"))} like ${pattern}
          or ${normalizedSearchField(sql.raw("loc.address_1"))} like ${pattern}
          or ${normalizedSearchField(sql.raw("loc.website"))} like ${pattern}
          or ${normalizedSearchField(sql.raw("loc.phone"))} like ${pattern}
          or ${normalizedSearchField(sql.raw("loc.email"))} like ${pattern}
          or exists (
            select 1
            from contacts loc_contact
            where loc_contact.organization_location_id = loc.id
              and (
                ${normalizedSearchField(sql.raw("loc_contact.first_name"))} like ${pattern}
                or ${normalizedSearchField(sql.raw("loc_contact.last_name"))} like ${pattern}
                or ${normalizedSearchField(sql.raw("concat_ws(' ', loc_contact.first_name, loc_contact.last_name)"))} like ${pattern}
                or ${normalizedSearchField(sql.raw("loc_contact.phone"))} like ${pattern}
                or ${normalizedSearchField(sql.raw("loc_contact.email"))} like ${pattern}
                or exists (
                  select 1
                  from contact_phones location_phone
                  where location_phone.contact_id = loc_contact.id
                    and ${normalizedSearchField(sql.raw("location_phone.number"))} like ${pattern}
                )
              )
          )
        )
    )
  )`;
}

async function matchedOrganizationIds(terms: string[]): Promise<Map<string, number>> {
  const termConditions = terms.map((term) => termCondition(term));
  if (!termConditions.length) return new Map();
  const exactResult = await db.execute<{ id: string }>(sql`
    select distinct o.id
    from organizations o
    where ${sql.join(termConditions, sql.raw(" and "))}
    order by o.id
    limit ${MAX_SEARCH_CANDIDATES}
  `);
  const fuzzyResult = await db.execute<{ id: string; searchText: string | null }>(sql`
    select
      o.id,
      concat_ws(
        ' ',
        o.name,
        o.city,
        o.region,
        o.postal_code,
        o.address_1,
        o.website,
        o.phone,
        (
          select string_agg(
            concat_ws(
              ' ', person.first_name, person.last_name, person.phone, person.email,
              (select string_agg(person_phone.number, ' ') from contact_phones person_phone where person_phone.contact_id = person.id)
            ),
            ' '
          )
          from organization_contacts association
          inner join contacts person on person.id = association.contact_id
          where association.organization_id = o.id
            and association.active
        ),
        (
          select string_agg(
            concat_ws(
              ' ',
              loc.label,
              loc.venue_name,
              loc.city,
              loc.region,
              loc.postal_code,
              loc.address_1,
              loc.website,
              loc.phone,
              loc.email,
              (
                select string_agg(
                  concat_ws(
                    ' ', loc_contact.first_name, loc_contact.last_name, loc_contact.phone, loc_contact.email,
                    (select string_agg(location_phone.number, ' ') from contact_phones location_phone where location_phone.contact_id = loc_contact.id)
                  ),
                  ' '
                )
                from contacts loc_contact
                where loc_contact.organization_location_id = loc.id
              )
            ),
            ' '
          )
          from organization_locations loc
          where loc.organization_id = o.id
        )
      ) as "searchText"
    from organizations o
    order by o.id
    limit ${MAX_SEARCH_CANDIDATES}
  `);
  const matchedIds = new Map<string, number>(exactResult.rows.map((row) => [row.id, 0]));
  for (const row of fuzzyResult.rows) {
    if (matchedIds.has(row.id)) continue;
    const score = profileSearchScore(terms, [row.searchText ?? ""]);
    if (score !== null) matchedIds.set(row.id, score);
  }
  return matchedIds;
}

type ProfileCardDetails = {
  id: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  placeType: string | null;
  profileImageDataUrl: string | null;
  ratingAverage: number | null;
  ratingCount: number;
};

async function loadProfileCardDetails(ids: string[]): Promise<Map<string, ProfileCardDetails>> {
  if (!ids.length) return new Map();
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql.raw(", "));
  const [coreResult, photoResult, ratingResult] = await Promise.all([
    db.execute<any>(sql`
      select o.id, coalesce(c.phone, o.phone) as phone, c.email, o.website, o.place_type as "placeType"
      from organizations o
      left join organization_contacts oc on oc.organization_id = o.id and oc.active = true and oc.is_primary = true
      left join contacts c on c.id = oc.contact_id
      where o.id in (${idList})
    `),
    db.execute<any>(sql`
      select o.id, o.profile_image_data_url as "profileImageDataUrl"
      from organizations o
      where o.id in (${idList})
    `).catch(() => ({ rows: [] as any[] })),
    db.execute<any>(sql`
      select b.organization_id as id, avg(w.rating_stars)::float as "ratingAverage", count(w.rating_stars)::int as "ratingCount"
      from bookings b
      inner join event_wrap_ups w on w.booking_id = b.id and w.rating_stars is not null
      where b.organization_id in (${idList})
      group by b.organization_id
    `).catch(() => ({ rows: [] as any[] })),
  ]);
  const coreById = new Map(coreResult.rows.map((row: any) => [row.id, row]));
  const photoById = new Map(photoResult.rows.map((row: any) => [row.id, row.profileImageDataUrl ?? null]));
  const ratingById = new Map(ratingResult.rows.map((row: any) => [row.id, row]));
  return new Map(ids.map((id) => {
    const core: any = coreById.get(id) ?? {};
    const rating: any = ratingById.get(id) ?? {};
    return [id, {
      id,
      phone: core.phone ?? null,
      email: core.email ?? null,
      website: core.website ?? null,
      placeType: core.placeType ?? null,
      profileImageDataUrl: photoById.get(id) ?? null,
      ratingAverage: rating.ratingAverage == null ? null : Number(rating.ratingAverage),
      ratingCount: Number(rating.ratingCount ?? 0),
    }];
  }));
}

function paginate(records: OrganizationListPage["records"], page: number, pageSize: number): OrganizationListPage {
  const total = records.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const resolvedPage = Math.min(Math.max(1, page), pageCount);
  return {
    records: records.slice((resolvedPage - 1) * pageSize, resolvedPage * pageSize),
    total,
    page: resolvedPage,
    pageSize,
    pageCount,
  };
}

router.get("/organizations", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const query = organizationListQuerySchema.parse({
    q: req.query.q ?? undefined,
    lastResort: req.query.lastResort ?? undefined,
    leg: req.query.leg ?? undefined,
    type: req.query.type ?? undefined,
    region: req.query.region ?? undefined,
    hasPhone: req.query.hasPhone ?? undefined,
    hasEmail: req.query.hasEmail ?? undefined,
    hasFollowUp: req.query.hasFollowUp ?? undefined,
    hasBooking: req.query.hasBooking ?? undefined,
    hasLocations: req.query.hasLocations ?? undefined,
    showMembers: req.query.showMembers ?? undefined,
    contact: req.query.contact ?? undefined,
    activity: req.query.activity ?? undefined,
    includeRetired: req.query.includeRetired ?? undefined,
    page: req.query.page ?? undefined,
    pageSize: req.query.pageSize ?? undefined,
  });
  if (!query.search) return next();

  try {
    const terms = buildProfileSearchTerms(query.search);
    if (!terms.length) return next();
    const matchedIds = await matchedOrganizationIds(terms);
    const candidatePage = await new DrizzleOrganizationRepository(db).listOrganizations({
      ...query,
      search: "",
      showMembers: true,
      includeRetired: true,
      page: 1,
      pageSize: MAX_SEARCH_CANDIDATES,
    });
    const matchedRecords = candidatePage.records
      .filter((record) => matchedIds.has(record.id))
      .sort((left, right) => (matchedIds.get(left.id) ?? 0) - (matchedIds.get(right.id) ?? 0));
    const organizationPage = paginate(matchedRecords, query.page, query.pageSize);
    const cardDetails = await loadProfileCardDetails(organizationPage.records.map((record) => record.id));
    const enrichedPage = {
      ...organizationPage,
      records: organizationPage.records.map((record) => ({ ...record, ...(cardDetails.get(record.id) ?? {}) })),
    };
    const [{ organizations, families }, travelLegs] = await Promise.all([
      attachEventFamiliesToOrganizationPage(db, query, enrichedPage),
      new DrizzleTravelLegRepository(db).listTravelLegs(),
    ]);
    res.json({ organizations, families, travelLegs });
  } catch (err) {
    req.log.error({ err }, "Failed forgiving organization search");
    res.status(500).json({ error: "Failed to search profiles" });
  }
});

export default router;
