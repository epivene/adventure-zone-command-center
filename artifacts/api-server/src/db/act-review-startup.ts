import { pool as defaultPool } from "@workspace/db";
import { runActReviewMigrations } from "@workspace/db/migrations";
import { ensureAssistantCommandJobsSchema } from "./assistant-command-jobs-startup-migration";
import { ensureProfileResearchSchema } from "./profile-research-startup-migration";
import { ensureLeadScoutRelease2Schema } from "./lead-scout-release2-startup-migration";
import { ensureLeadScoutRelease3Schema } from "./lead-scout-release3-startup-migration";
import { ensurePaperNotesSchema } from "./paper-notes-startup-migration";
import { ensureScoutAlertsSchema } from "./scout-alerts-startup-migration";

const advisoryTryLockSql =
  "SELECT pg_try_advisory_lock(hashtext('adventure-zone:act-review-migrations')) AS locked";
const advisoryUnlockSql =
  "SELECT pg_advisory_unlock(hashtext('adventure-zone:act-review-migrations'))";

interface MigrationClient {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
}

interface MigrationPool {
  connect(): Promise<MigrationClient>;
}

type MigrationRunner = (options: { pool: MigrationPool }) => Promise<string[]>;

function isLockTimeout(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "55P03",
  );
}

export async function runActReviewMigrationsAtStartup(options?: {
  pool?: MigrationPool;
  runMigrations?: MigrationRunner;
  onLockUnavailable?: () => void;
  onLockTimeout?: () => void;
}): Promise<string[]> {
  const pool = options?.pool ?? (defaultPool as unknown as MigrationPool);
  const runMigrations = options?.runMigrations ?? (runActReviewMigrations as MigrationRunner);
  const client = await pool.connect();
  let prelocked = false;
  let timeoutsApplied = false;

  try {
    const lock = await client.query(advisoryTryLockSql);
    if (lock.rows[0]?.["locked"] !== true) {
      options?.onLockUnavailable?.();
      return [];
    }
    prelocked = true;

    await client.query("SET lock_timeout = '5s'");
    await client.query("SET statement_timeout = '20s'");
    timeoutsApplied = true;

    try {
      const researchApplied = await ensureProfileResearchSchema(client);
      const leadScoutRelease2Applied = await ensureLeadScoutRelease2Schema(client);
      const leadScoutRelease3Applied = await ensureLeadScoutRelease3Schema(client);
      const paperNotesApplied = await ensurePaperNotesSchema(client);
      const assistantJobsApplied = await ensureAssistantCommandJobsSchema(client);
      const scoutAlertsApplied = await ensureScoutAlertsSchema(client);

      const migrationClient: MigrationClient = {
        query: (sql) => client.query(sql),
        release() {},
      };

      const applied = await runMigrations({
        pool: {
          connect: async () => migrationClient,
        },
      });
      return [
        ...(researchApplied ? ["061_profile_research_runs.sql", "063_lead_scout_runs.sql"] : []),
        ...(leadScoutRelease2Applied ? ["064_lead_scout_candidate_key.sql"] : []),
        ...(leadScoutRelease3Applied ? ["065_lead_scout_enrichment.sql"] : []),
        ...(paperNotesApplied ? ["066_paper_notes_importer.sql"] : []),
        ...(assistantJobsApplied ? ["067_assistant_command_jobs.sql"] : []),
        ...(scoutAlertsApplied ? ["068_scout_alerts.sql"] : []),
        ...applied,
      ];
    } catch (error) {
      if (!isLockTimeout(error)) throw error;
      options?.onLockTimeout?.();
      return [];
    }
  } finally {
    if (timeoutsApplied) {
      await client.query("RESET statement_timeout").catch(() => undefined);
      await client.query("RESET lock_timeout").catch(() => undefined);
    }
    if (prelocked) {
      await client.query(advisoryUnlockSql).catch(() => undefined);
    }
    client.release();
  }
}
