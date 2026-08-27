import { sql } from "drizzle-orm";

import type { ProfileSort } from "./last-resort-input";

export type ProfileSortMetadata = {
  createdAt: Date;
  lastChangedAt: Date;
};

type SortableOrganizationRecord = {
  id: string;
  name: string;
};

type SortMetadataRow = {
  id: string;
  createdAt: Date | string;
  lastChangedAt: Date | string;
};

type ExecuteQuery = (query: unknown) => Promise<{ rows?: SortMetadataRow[] }>;

export async function loadProfileSortMetadata(
  ids: string[],
  execute: ExecuteQuery,
): Promise<Map<string, ProfileSortMetadata>> {
  if (!ids.length) return new Map();

  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql.raw(", "));
  const result = await execute(sql`
    select
      o.id,
      o.created_at as "createdAt",
      greatest(
        coalesce(o.updated_at, o.created_at),
        coalesce((
          select max(c.updated_at)
          from organization_contacts oc
          inner join contacts c on c.id = oc.contact_id
          where oc.organization_id = o.id
            and oc.active = true
        ), o.created_at),
        coalesce((
          select max(b.updated_at)
          from bookings b
          where b.organization_id = o.id
        ), o.created_at),
        coalesce((
          select max(f.updated_at)
          from follow_ups f
          where f.organization_id = o.id
            or f.contact_id in (
              select oc2.contact_id
              from organization_contacts oc2
              where oc2.organization_id = o.id
                and oc2.active = true
            )
        ), o.created_at),
        coalesce((
          select max(a.updated_at)
          from activities a
          where a.organization_id = o.id
            or a.booking_id in (
              select b2.id
              from bookings b2
              where b2.organization_id = o.id
            )
            or a.contact_id in (
              select oc3.contact_id
              from organization_contacts oc3
              where oc3.organization_id = o.id
                and oc3.active = true
            )
        ), o.created_at)
      ) as "lastChangedAt"
    from organizations o
    where o.id in (${idList})
  `);

  return new Map((result.rows ?? []).map((row) => [row.id, {
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
    lastChangedAt: row.lastChangedAt instanceof Date ? row.lastChangedAt : new Date(row.lastChangedAt),
  }]));
}

function dateValue(value: Date | undefined): number {
  return value?.getTime() ?? 0;
}

export function sortOrganizationRecords<T extends SortableOrganizationRecord>(
  records: readonly T[],
  metadata: ReadonlyMap<string, ProfileSortMetadata>,
  sort: ProfileSort,
  search = "",
): T[] {
  const normalizedSearch = search.trim().toLocaleLowerCase("en-US");

  return [...records].sort((left, right) => {
    if (normalizedSearch) {
      const leftExact = left.name.toLocaleLowerCase("en-US") === normalizedSearch;
      const rightExact = right.name.toLocaleLowerCase("en-US") === normalizedSearch;
      if (leftExact !== rightExact) return leftExact ? -1 : 1;
    }

    const leftMeta = metadata.get(left.id);
    const rightMeta = metadata.get(right.id);
    let comparison = 0;

    switch (sort) {
      case "recently_updated":
        comparison = dateValue(rightMeta?.lastChangedAt) - dateValue(leftMeta?.lastChangedAt);
        break;
      case "least_recently_updated":
        comparison = dateValue(leftMeta?.lastChangedAt) - dateValue(rightMeta?.lastChangedAt);
        break;
      case "name_desc":
        comparison = right.name.localeCompare(left.name, "en-US", { sensitivity: "base" });
        break;
      case "created_desc":
        comparison = dateValue(rightMeta?.createdAt) - dateValue(leftMeta?.createdAt);
        break;
      case "created_asc":
        comparison = dateValue(leftMeta?.createdAt) - dateValue(rightMeta?.createdAt);
        break;
      case "name_asc":
      default:
        comparison = left.name.localeCompare(right.name, "en-US", { sensitivity: "base" });
        break;
    }

    return comparison
      || left.name.localeCompare(right.name, "en-US", { sensitivity: "base" })
      || left.id.localeCompare(right.id, "en-US");
  });
}
