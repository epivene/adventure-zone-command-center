import { access, readFile } from "node:fs/promises";

const advisoryLockSql =
  "SELECT pg_advisory_lock(hashtext('adventure-zone:act-review-migrations'))";
const advisoryUnlockSql =
  "SELECT pg_advisory_unlock(hashtext('adventure-zone:act-review-migrations'))";

export interface ActReviewMigration {
  name: string;
  markerSql: string;
  sql: string;
}

interface MigrationClient {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
}

interface MigrationPool {
  connect(): Promise<MigrationClient>;
}

const migrationFiles = [
  {
    name: "014_act_review_bulk_decisions.sql",
    markerSql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'act_replacement_review_decisions'
        AND column_name = 'decided_by'
    ) AS ready`,
  },
  {
    name: "015_act_bulk_review_requests.sql",
    markerSql:
      "SELECT to_regclass(current_schema() || '.act_replacement_bulk_review_requests') IS NOT NULL AS ready",
  },
  {
    name: "016_act_review_conflict_proof.sql",
    markerSql: `SELECT COUNT(*) = 4 AS ready
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'act_replacement_review_decisions'
        AND column_name IN (
          'reviewed_source_value',
          'reviewed_source_value_fingerprint',
          'reviewed_local_value',
          'reviewed_local_value_fingerprint'
        )`,
  },
  {
    name: "017_act_relationship_parent_decisions.sql",
    markerSql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'act_replacement_review_decisions'
        AND column_name = 'relationship_slot'
    ) AS ready`,
  },
  {
    name: "018_act_review_decision_integrity.sql",
    markerSql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'act_replacement_review_decisions'
        AND column_name = 'request_fingerprint'
    ) AS ready`,
  },
  {
    name: "019_act_approval_provenance.sql",
    markerSql: `SELECT COUNT(*) = 2 AS ready
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'act_replacement_approval_requests'
        AND column_name IN ('approval_mode', 'approval_mode_version')`,
  },
  {
    name: "020_act_automatic_review_recovery.sql",
    markerSql: `SELECT COUNT(*) = 5 AS ready
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'act_replacement_bulk_review_requests'
        AND column_name IN (
          'expected_manifest_digest', 'automatic_summary', 'rebuild_state',
          'rebuild_token', 'rebuild_lease_expires_at'
        )`,
  },
  {
    name: "021_act_manifest_digest_version.sql",
    markerSql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'act_replacement_runs'
        AND column_name = 'manifest_digest_version'
    ) AS ready`,
  },
  {
    name: "020_assisted_calling.sql",
    markerSql: "SELECT to_regclass(current_schema() || '.contact_phones') IS NOT NULL AS ready",
  },
  {
    name: "021_call_session_metadata.sql",
    markerSql: `SELECT COUNT(*) = 6 AS ready
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'call_sessions'
        AND column_name IN ('phone_id', 'direction', 'method', 'phone_number_snapshot', 'phone_extension_snapshot', 'script_kind')`,
  },
  {
    name: "022_contact_phone_legacy_compatibility.sql",
    markerSql: `SELECT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'contacts_sync_primary_phone'
        AND NOT tgisinternal
    ) AS ready`,
  },
  {
    name: "023_contact_phone_canonical_dnc.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.contact_phones_contact_normalized_number_unique') IS NOT NULL
      AND to_regprocedure(current_schema() || '.normalize_north_american_phone(text)') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'contacts_normalize_legacy_phone'
          AND NOT tgisinternal
      )
      AND EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'contacts_sync_primary_phone'
          AND NOT tgisinternal
      ) AS ready`,
  },
] as const;

async function resolveMigrationDirectory(): Promise<URL> {
  const candidates = [
    new URL("../migrations/", import.meta.url),
    new URL("./migrations/", import.meta.url),
  ];

  for (const candidate of candidates) {
    try {
      await access(new URL(migrationFiles[0].name, candidate));
      return candidate;
    } catch {
      // Try the bundled production location next.
    }
  }

  throw new Error("Act review migration files are unavailable");
}

export async function loadActReviewMigrations(): Promise<ActReviewMigration[]> {
  const directory = await resolveMigrationDirectory();
  return Promise.all(
    migrationFiles.map(async ({ name, markerSql }) => ({
      name,
      markerSql,
      sql: await readFile(new URL(name, directory), "utf8"),
    })),
  );
}

export async function runActReviewMigrations(options?: {
  pool?: MigrationPool;
  migrations?: ActReviewMigration[];
}): Promise<string[]> {
  const migrationPool =
    options?.pool ?? (await import("./index")).pool;
  const migrations = options?.migrations ?? (await loadActReviewMigrations());
  const client = await migrationPool.connect();
  const applied: string[] = [];
  let locked = false;

  try {
    await client.query(advisoryLockSql);
    locked = true;

    for (const migration of migrations) {
      const marker = await client.query(migration.markerSql);
      if (marker.rows[0]?.["ready"] === true) continue;
      await client.query(migration.sql);
      applied.push(migration.name);
    }

    return applied;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (locked) {
      await client.query(advisoryUnlockSql).catch(() => undefined);
    }
    client.release();
  }
}
