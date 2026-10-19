import { ConnectionError, type SqlQuery } from "./contracts";

const references: Record<string, string> = {
  // Reparent only the live association. The before/after audit below retains
  // the original append-only review snapshot and its source organization ID.
  deadline_attention_reviews: "organization_id",
  deadline_notifications: "organization_id",
  google_sync_snapshots: "profile_id",
  google_sync_history: "profile_id",
  google_sync_archive_jobs: "profile_id",
  google_sync_enrollments: "profile_id",
};

// Called inside the merge's pinned transaction and reference-table locks.
// Preserve source payloads, fingerprints, timestamps, notification decisions and
// retry metadata verbatim. Audit evidence retains the original associations.
export async function preserveSyncMergeReferences(
  tx: SqlQuery,
  primaryId: string,
  duplicateIds: string[],
  tables: string[],
): Promise<Set<string>> {
  const selected = Object.keys(references).filter((t) => tables.includes(t));
  const tooLarge = () =>
    new ConnectionError(
      "CONNECTION_MERGE_BLOCKED",
      409,
      "Sync preservation evidence exceeds the safe merge size. Keep these profiles separate pending recovery review.",
    );
  const read = async () => {
    const result: Record<string, unknown[]> = {};
    // Bound in PostgreSQL before materializing bodies in the API process. The
    // caller's table locks keep this preflight and the subsequent reads stable.
    let bytes = 0;
    for (const table of selected) {
      const size = await tx.query(
        `SELECT coalesce(sum(octet_length(to_jsonb(r)::text)),0) AS bytes FROM "${table}" r WHERE "${references[table]}"=ANY($1::uuid[])`,
        [[primaryId, ...duplicateIds]],
      );
      bytes += Number(size.rows[0].bytes);
      if (bytes > 4 * 1024 * 1024) throw tooLarge();
    }
    for (const table of selected)
      result[table] = (
        await tx.query(
          `SELECT * FROM "${table}" WHERE "${references[table]}"=ANY($1::uuid[]) ORDER BY to_jsonb("${table}")::text`,
          [[primaryId, ...duplicateIds]],
        )
      ).rows;
    if (Buffer.byteLength(JSON.stringify(result)) > 4 * 1024 * 1024)
      throw tooLarge();
    return result;
  };
  if (!selected.length) return new Set();
  const before = await read();
  if (
    !selected.some((t) =>
      before[t].some((r: any) => duplicateIds.includes(r[references[t]])),
    )
  )
    return new Set(selected);
  for (const table of selected) {
    if (table === "google_sync_enrollments") {
      await tx.query(
        `INSERT INTO google_sync_enrollments(connection_id,profile_id)
        SELECT DISTINCT connection_id,$1::uuid FROM google_sync_enrollments WHERE profile_id=ANY($2::uuid[])
        ON CONFLICT DO NOTHING`,
        [primaryId, duplicateIds],
      );
    } else
      await tx.query(
        `UPDATE "${table}" SET "${references[table]}"=$1 WHERE "${references[table]}"=ANY($2::uuid[])`,
        [primaryId, duplicateIds],
      );
  }
  const after = await read();
  await tx.query(
    `INSERT INTO audit_entries(entity_type,entity_id,action,"before","after") VALUES('profile_merge',$1,'merge_sync_references',$2::jsonb,$3::jsonb)`,
    [
      primaryId,
      JSON.stringify({ primaryId, duplicateIds, tables: before }),
      JSON.stringify({ primaryId, duplicateIds, tables: after }),
    ],
  );
  return new Set(selected);
}

