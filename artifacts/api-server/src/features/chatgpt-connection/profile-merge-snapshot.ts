import { ConnectionError, inputHash, type SqlQuery } from "./contracts";
import { selectedProfilesHaveConflictingCompleteLocations } from "../organizations/organization-merge-subset-safety";
import {
  extraMergeReferences,
  legacyMergeTables,
} from "./profile-merge-references";
import { organizationFamilyReviewAdvisoryLockKey } from "../organizations/organization-family-lock";

const referenceColumns = [
  "organization_id",
  "profile_id",
  "selected_organization_id",
  "imported_organization_id",
  "matched_organization_id",
  "saved_organization_id",
  "parent_organization_id",
  "consolidated_into_id",
  "consolidation_source_org_id",
  "entity_id",
  "matched_entity_id",
  "applied_entity_id",
  "linked_organization_id",
  "converted_organization_id",
  "applied_organization_id",
];
// Identifiers originate in the local catalog, never in tool arguments.
const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
export async function mergeSnapshot(
  tx: SqlQuery,
  primaryId: string,
  duplicateIds: string[],
  lock = false,
) {
  const ids = [primaryId, ...duplicateIds];
  const columns = (
    await tx.query(
      `SELECT c.table_name,c.column_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
    WHERE c.table_schema=current_schema() AND t.table_type='BASE TABLE'
      AND (c.column_name=ANY($1::text[]) OR EXISTS (
        SELECT 1 FROM pg_constraint fk JOIN pg_class rel ON rel.oid=fk.conrelid
        JOIN pg_namespace ns ON ns.oid=rel.relnamespace
        JOIN pg_attribute a ON a.attrelid=rel.oid AND a.attnum=ANY(fk.conkey)
        WHERE fk.contype='f' AND fk.confrelid='organizations'::regclass
          AND ns.nspname=c.table_schema AND rel.relname=c.table_name AND a.attname=c.column_name
      )) AND c.data_type IN ('uuid','text','character varying')
      AND c.table_name NOT IN ('chatgpt_update_proposals','chatgpt_operations')
    ORDER BY c.table_name,c.column_name`,
      [referenceColumns],
    )
  ).rows;
  const tables = new Map<string, string[]>();
  for (const c of columns)
    tables.set(c.table_name, [
      ...(tables.get(c.table_name) ?? []),
      c.column_name,
    ]);
  tables.set("organizations", ["id", ...(tables.get("organizations") ?? [])]);
  // JSON-linked drafts have no FK and must be included in both the snapshot and locks.
  tables.set("chatgpt_external_drafts", []);
  if (
    (
      await tx.query(
        "SELECT to_regclass('assistant_workspace_drafts') AS relation",
      )
    ).rows[0]?.relation
  )
    tables.set("assistant_workspace_drafts", []);
  if (lock) {
    // Hold writers out only during approval/apply. Row locks alone cannot protect
    // new related rows in legacy tables without FKs. A timeout rolls everything back.
    await tx.query("SET LOCAL lock_timeout = '5s'");
    // Match the legacy family/merge lock order before taking any CRM table locks.
    await tx.query("SELECT pg_advisory_xact_lock($1)", [
      organizationFamilyReviewAdvisoryLockKey,
    ]);
    const actTables = ["act_migration_records", "act_external_links"].filter(
      (t) => tables.has(t),
    );
    if (actTables.length)
      await tx.query(
        `LOCK TABLE ${actTables.map(quote).join(",")} IN EXCLUSIVE MODE`,
      );
    await tx.query("LOCK TABLE organizations IN EXCLUSIVE MODE");
    await tx.query(
      `LOCK TABLE ${[...tables.keys()].sort().map(quote).join(",")} IN SHARE ROW EXCLUSIVE MODE`,
    );
  }
  const profiles: Array<{
    id: string;
    name: string;
    city: string | null;
    region: string | null;
    consolidated_into_id: string | null;
    [key: string]: any;
  }> = JSON.parse(
    JSON.stringify(
      (
        await tx.query(
          "SELECT * FROM organizations WHERE id=ANY($1::uuid[]) ORDER BY id",
          [ids],
        )
      ).rows,
    ),
  );
  if (
    profiles.length !== ids.length ||
    profiles.some((p) => p.consolidated_into_id)
  )
    throw new ConnectionError(
      "CONNECTION_MERGE_PROFILE_UNAVAILABLE",
      409,
      "A selected profile is missing or retired. Read the live profiles again.",
    );
  if (JSON.stringify(profiles).length > 100000)
    throw new ConnectionError(
      "CONNECTION_MERGE_TOO_LARGE",
      409,
      "Review these profiles in the app; their saved fields exceed the preview limit.",
    );
  const references: {
    table: string;
    count: number;
    duplicateCount: number;
    digest: string;
  }[] = [];
  const blockers: string[] = [];
  for (const [table, fields] of [...tables].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const where =
      table === "chatgpt_external_drafts" ||
      table === "assistant_workspace_drafts"
        ? "content->>'organizationId'=ANY($1::text[])"
        : fields.map((c) => `${quote(c)}::text=ANY($1::text[])`).join(" OR ");
    const row = (
      await tx.query(
        `SELECT count(*)::integer AS count,
      count(*) FILTER (WHERE ${where.replaceAll("$1", "$2")})::integer AS duplicate_count,
      md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS digest
      FROM ${quote(table)} r WHERE ${where}`,
        [ids, duplicateIds],
      )
    ).rows[0];
    references.push({
      table,
      count: Number(row.count),
      duplicateCount: Number(row.duplicate_count),
      digest: row.digest,
    });
    if (
      Number(row.duplicate_count) > 0 &&
      !legacyMergeTables.has(table) &&
      !(fields.length === 1 && fields[0] === extraMergeReferences[table])
    )
      blockers.push(
        `Linked records in ${table} need a supported preservation path before these profiles can be merged.`,
      );
  }
  const primary = profiles.find((p) => p.id === primaryId)!;
  const duplicates = duplicateIds.map((id) =>
    profiles.find((p) => p.id === id)!,
  );
  const conflicts: {
    field: string;
    primaryValue: unknown;
    duplicateId: string;
    duplicateValue: unknown;
  }[] = [];
  for (const duplicate of duplicates)
    for (const field of [
      "name",
      "phone",
      "website",
      "address_1",
      "address_2",
      "city",
      "region",
      "postal_code",
      "place_type",
    ])
      if (
        duplicate[field] != null &&
        duplicate[field] !== "" &&
        duplicate[field] !== primary[field]
      )
        conflicts.push({
          field,
          primaryValue: primary[field] ?? null,
          duplicateId: duplicate.id,
          duplicateValue: duplicate[field],
        });
  if (selectedProfilesHaveConflictingCompleteLocations(profiles))
    blockers.push(
      "The profiles have different cities/regions. Resolve their identity in the app; separate events must not be merged.",
    );
  return {
    primary,
    duplicates,
    references,
    conflicts,
    blockers,
    fingerprint: inputHash({ profiles, references }),
    policy:
      "Keep the surviving profile's fields. Move supported linked records and preserve original profile fields in the merge history. Equivalent links may be consolidated. Conflicting active date facts remain for review. This does not send email or relabel Gmail remotely.",
  };
}
