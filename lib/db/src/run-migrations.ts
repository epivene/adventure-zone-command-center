/**
 * Custom-DDL migration runner.
 *
 * Applies SQL files from lib/db/migrations/ that drizzle-kit cannot express
 * (e.g. deferrable constraints, custom index options). Each file is applied
 * exactly once; applied filenames are tracked in a `_custom_migrations` table.
 *
 * Exits 0 on success or when no DATABASE_URL is configured (graceful skip for
 * code-only environments). Exits 1 on database error so CI/deploy pipelines
 * fail loudly on migration trouble.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { orderMigrations } from "./migration-order";

const raw = process.env.RENDER_DATABASE_URL ?? process.env.DATABASE_URL;

if (!raw) {
  console.log("run-migrations: skipped (no DATABASE_URL configured)");
  process.exit(0);
}

// Render requires SSL; append sslmode when not already specified.
const connectionString =
  raw.includes("sslmode=") || raw.includes("ssl=")
    ? raw
    : raw + (raw.includes("?") ? "&" : "?") + "sslmode=require";

const client = new pg.Client({ connectionString });
await client.connect();

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

try {
  // Create tracking table if it doesn't exist.
  await client.query(`
    CREATE TABLE IF NOT EXISTS _custom_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Keep filename order except where an explicit prerequisite must run first.
  const files = orderMigrations(fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql")));

  const { rows: applied } = await client.query<{ filename: string }>(
    "SELECT filename FROM _custom_migrations",
  );
  const appliedSet = new Set(applied.map((r) => r.filename));

  const pending = files.filter((f) => !appliedSet.has(f));

  if (pending.length === 0) {
    console.log("run-migrations: nothing to apply");
  } else {
    for (const file of pending) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      console.log(`run-migrations: applying ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO _custom_migrations (filename) VALUES ($1)",
          [file],
        );
        await client.query("COMMIT");
        console.log(`run-migrations: applied  ${file}`);
      } catch (err: any) {
        await client.query("ROLLBACK");
        // A migration may raise MIGRATION_DEFERRED when its prerequisite tables
        // don't exist yet (e.g. before drizzle-kit push has run). Treat this as
        // a soft skip: don't record the migration so it is retried next time.
        // The push/push-force scripts chain run-migrations, so it will be
        // applied immediately after the schema is created.
        if (typeof err.message === "string" && err.message.startsWith("MIGRATION_DEFERRED:")) {
          console.log(`run-migrations: deferred ${file} — ${err.message}`);
          continue;
        }
        throw err;
      }
    }
  }
} finally {
  await client.end();
}
