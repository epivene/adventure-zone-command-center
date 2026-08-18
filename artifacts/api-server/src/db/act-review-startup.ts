import { pool as defaultPool } from "@workspace/db";
import { runActReviewMigrations } from "@workspace/db/migrations";

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

export async function runActReviewMigrationsAtStartup(options?: {
  pool?: MigrationPool;
  runMigrations?: MigrationRunner;
  onLockUnavailable?: () => void;
}): Promise<string[]> {
  const pool = options?.pool ?? (defaultPool as unknown as MigrationPool);
  const runMigrations = options?.runMigrations ?? (runActReviewMigrations as MigrationRunner);
  const client = await pool.connect();
  let prelocked = false;

  try {
    const lock = await client.query(advisoryTryLockSql);
    if (lock.rows[0]?.["locked"] !== true) {
      options?.onLockUnavailable?.();
      return [];
    }
    prelocked = true;

    // The migration runner acquires the same session-level advisory lock.
    // Reusing this already-locked client makes that acquisition immediate,
    // while its no-op release lets this wrapper perform the final unlock.
    const migrationClient: MigrationClient = {
      query: (sql) => client.query(sql),
      release() {},
    };

    return await runMigrations({
      pool: {
        connect: async () => migrationClient,
      },
    });
  } finally {
    if (prelocked) {
      await client.query(advisoryUnlockSql).catch(() => undefined);
    }
    client.release();
  }
}
