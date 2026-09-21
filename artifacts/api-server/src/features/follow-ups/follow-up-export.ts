import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { listOrganizationDirectoryPage } from "@/features/organizations/organization-directory-page";
import type { OrganizationListQuery } from "@/features/organizations/last-resort-input";

export type FollowUpExportRow = {
  id: string;
  kind: string;
  dueAt: Date;
  organizationName: string;
  city: string | null;
  region: string | null;
};

export async function listActiveFollowUpExportRows(
  db: typeof database,
  organizationIds: string[],
): Promise<FollowUpExportRow[]> {
  if (!organizationIds.length) return [];

  const idList = sql.join(
    organizationIds.map((id) => sql`${id}::uuid`),
    sql.raw(", "),
  );
  const result = await db.execute<FollowUpExportRow>(sql`
    with active_follow_ups as (
      select
        f.id,
        f.kind,
        f.due_at,
        f.booking_id,
        f.organization_location_id,
        case
          when f.organization_id is not null then f.organization_id
          when f.booking_id is not null then (
            select b.organization_id from bookings b where b.id = f.booking_id
          )
          when f.contact_id is not null then (
            select oc.organization_id
            from organization_contacts oc
            where oc.contact_id = f.contact_id
              and oc.active
              and oc.organization_id in (${idList})
            order by oc.is_primary desc, oc.organization_id
            limit 1
          )
          else null
        end as resolved_organization_id
      from follow_ups f
      where f.completed_at is null
    )
    select
      f.id,
      f.kind,
      f.due_at as "dueAt",
      coalesce(b.name, follow_up_location.venue_name, follow_up_location.label, o.name)
        as "organizationName",
      coalesce(follow_up_location.city, b.city, booking_location.city, o.city) as city,
      coalesce(follow_up_location.region, b.region, booking_location.region, o.region) as region
    from active_follow_ups f
    inner join organizations o on o.id = f.resolved_organization_id
    left join bookings b on b.id = f.booking_id
    left join organization_locations follow_up_location
      on follow_up_location.id = f.organization_location_id
    left join organization_locations booking_location
      on booking_location.id = b.organization_location_id
    where o.id in (${idList})
    order by f.due_at, f.id
  `);
  return result.rows ?? [];
}

export async function listFilteredFollowUpExportRows(
  db: typeof database,
  query: OrganizationListQuery,
): Promise<FollowUpExportRow[]> {
  const organizationIds: string[] = [];
  let page = 1;
  let pageCount = 1;
  do {
    const result = await listOrganizationDirectoryPage(db, {
      ...query,
      page,
      pageSize: 50,
    });
    organizationIds.push(...result.records.map((record) => record.id));
    pageCount = result.pageCount;
    page += 1;
  } while (page <= pageCount);

  return listActiveFollowUpExportRows(db, organizationIds);
}
