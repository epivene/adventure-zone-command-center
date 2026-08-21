import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { OrganizationConflictError } from "@/features/organizations/organization-conflict";
import { selectedProfilesHaveConflictingCompleteLocations } from "./organization-merge-subset-safety";

type OrganizationMergeTransaction = Parameters<
  Parameters<typeof database["transaction"]>[0]
>[0];

type MergeCandidateRow = {
  id: string;
  city: string | null;
  region: string | null;
  consolidatedIntoId: string | null;
};

export async function assertSelectedProfileSubsetMergeable(
  transaction: OrganizationMergeTransaction,
  ids: string[],
): Promise<void> {
  const selectedIds = [...new Set(ids)].sort((left, right) =>
    left.localeCompare(right, "en-US"),
  );
  const idList = sql.join(
    selectedIds.map((id) => sql`${id}::uuid`),
    sql.raw(", "),
  );

  const result = await transaction.execute(sql`
    select
      id,
      city,
      region,
      consolidated_into_id as "consolidatedIntoId"
    from organizations
    where id in (${idList})
    order by id
    for update
  `);
  const rows = ((result as { rows?: MergeCandidateRow[] }).rows ?? []);

  if (rows.length !== selectedIds.length) {
    throw new OrganizationConflictError(
      "One or more selected profiles no longer exist. Refresh and try again.",
    );
  }

  if (rows.some((row) => row.consolidatedIntoId !== null)) {
    throw new OrganizationConflictError(
      "A retired profile cannot be merged. Use the live profile instead.",
    );
  }

  if (selectedProfilesHaveConflictingCompleteLocations(rows)) {
    throw new OrganizationConflictError(
      "These selected profiles have different recorded locations. Keep them separate and group them as an Event Family instead of merging them.",
    );
  }
}
