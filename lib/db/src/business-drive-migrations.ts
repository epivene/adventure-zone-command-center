import { access, readFile } from "node:fs/promises";

export interface BusinessDriveMigration {
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

const advisoryLockSql =
  "SELECT pg_advisory_lock(hashtext('adventure-zone:business-drive-migrations'))";
const advisoryUnlockSql =
  "SELECT pg_advisory_unlock(hashtext('adventure-zone:business-drive-migrations'))";

const migrationFiles = [
  {
    name: "20260822_business_source_copy.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.business_source_documents') IS NOT NULL
      AND to_regclass(current_schema() || '.business_source_fact_reviews') IS NOT NULL
      AND to_regclass(current_schema() || '.communication_templates') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'office_email_drafts'
          AND column_name = 'communication_template_id'
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'office_email_drafts_communication_template_fk'
      ) AS ready`,
  },
  {
    name: "20260822_package_reviewed_defaults.sql",
    markerSql: `SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'package_templates'
          AND column_name = 'knowledge_review_note'
      )
      AND EXISTS (
        SELECT 1 FROM package_templates WHERE code = 'mini_zone'
      )
      AND NOT EXISTS (
        SELECT 1 FROM package_templates
        WHERE (code = 'adventure_zone' AND base_price_cents = 800000)
           OR (code IN ('pirates_rebellion','pirate_rebellion') AND base_price_cents = 700000)
           OR (code IN ('weekend_warriors','warriors_playground') AND base_price_cents IS NULL)
      ) AS ready`,
  },
  {
    name: "20260822_commercial_offer_rules.sql",
    markerSql:
      "SELECT to_regclass(current_schema() || '.commercial_offer_rules') IS NOT NULL AS ready",
  },
  {
    name: "20260822_event_checklists.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.event_checklist_templates') IS NOT NULL
      AND to_regclass(current_schema() || '.event_checklist_template_items') IS NOT NULL
      AND to_regclass(current_schema() || '.event_checklist_runs') IS NOT NULL
      AND to_regclass(current_schema() || '.event_checklist_item_results') IS NOT NULL
      AND to_regclass(current_schema() || '.event_checklist_attachments') IS NOT NULL
      AND to_regclass(current_schema() || '.resource_condition_issues') IS NOT NULL
      AND to_regclass(current_schema() || '.event_checklist_overrides') IS NOT NULL
      AS ready`,
  },
  {
    name: "20260822_resource_checklist_tags.sql",
    markerSql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'resources'
        AND column_name = 'checklist_tags'
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
  throw new Error("Business drive migration files are unavailable");
}

export async function loadBusinessDriveMigrations(): Promise<BusinessDriveMigration[]> {
  const directory = await resolveMigrationDirectory();
  return Promise.all(
    migrationFiles.map(async ({ name, markerSql }) => ({
      name,
      markerSql,
      sql: await readFile(new URL(name, directory), "utf8"),
    })),
  );
}

export async function runBusinessDriveMigrations(options?: {
  pool?: MigrationPool;
  migrations?: BusinessDriveMigration[];
}): Promise<string[]> {
  const migrationPool = options?.pool ?? (await import("./index")).pool;
  const migrations = options?.migrations ?? (await loadBusinessDriveMigrations());
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
