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
        coalesce(max(a.updated_at), o.updated_at, o.created_at)
      ) as "lastChangedAt"
    from organizations o
    left join activities a on a.organization_id = o.id
    where o.id in (${idList})
    group by o.id, o.created_at, o.updated_at
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
