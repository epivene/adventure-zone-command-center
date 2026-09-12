import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";

type SearchDatabase = Pick<typeof database, "execute">;

export type OrganizationSearchCorpusRow = {
  id: string;
  searchText: string | null;
};

export async function loadOrganizationSearchCorpus(
  database: SearchDatabase,
  organizationIds: string[],
): Promise<OrganizationSearchCorpusRow[]> {
  if (!organizationIds.length) return [];
  const idList = sql.join(
    organizationIds.map((id) => sql`${id}::uuid`),
    sql.raw(", "),
  );
  const result = await database.execute<OrganizationSearchCorpusRow>(sql`
    with eligible_organizations as (
      select id from organizations where id in (${idList})
    ),
    eligible_contacts as (
      select association.contact_id
      from organization_contacts association
      inner join eligible_organizations eligible on eligible.id = association.organization_id
      where association.active
      union
      select person.id
      from contacts person
      inner join organization_locations loc on loc.id = person.organization_location_id
      inner join eligible_organizations eligible on eligible.id = loc.organization_id
    ),
    contact_phone_text as (
      select phone.contact_id, string_agg(phone.number, ' ') as search_text
      from contact_phones phone
      inner join eligible_contacts eligible on eligible.contact_id = phone.contact_id
      group by phone.contact_id
    ),
    profile_contact_text as (
      select
        association.organization_id,
        string_agg(
          concat_ws(' ', person.first_name, person.last_name, person.phone, person.email, phones.search_text),
          ' '
        ) as search_text
      from organization_contacts association
      inner join eligible_organizations eligible on eligible.id = association.organization_id
      inner join contacts person on person.id = association.contact_id
      left join contact_phone_text phones on phones.contact_id = person.id
      where association.active
      group by association.organization_id
    ),
    location_contact_text as (
      select
        person.organization_location_id,
        string_agg(
          concat_ws(' ', person.first_name, person.last_name, person.phone, person.email, phones.search_text),
          ' '
        ) as search_text
      from contacts person
      inner join organization_locations loc on loc.id = person.organization_location_id
      inner join eligible_organizations eligible on eligible.id = loc.organization_id
      left join contact_phone_text phones on phones.contact_id = person.id
      group by person.organization_location_id
    ),
    location_text as (
      select
        loc.organization_id,
        string_agg(
          concat_ws(
            ' ', loc.label, loc.venue_name, loc.city, loc.region, loc.postal_code,
            loc.address_1, loc.website, loc.phone, loc.email, people.search_text
          ),
          ' '
        ) as search_text
      from organization_locations loc
      inner join eligible_organizations eligible on eligible.id = loc.organization_id
      left join location_contact_text people on people.organization_location_id = loc.id
      group by loc.organization_id
    )
    select
      organization.id,
      concat_ws(
        ' ', organization.name, organization.city, organization.region,
        organization.postal_code, organization.address_1, organization.website,
        organization.phone, profile_contacts.search_text, locations.search_text
      ) as "searchText"
    from organizations organization
    inner join eligible_organizations eligible on eligible.id = organization.id
    left join profile_contact_text profile_contacts on profile_contacts.organization_id = organization.id
    left join location_text locations on locations.organization_id = organization.id
    order by organization.id
  `);
  return [...result.rows];
}
