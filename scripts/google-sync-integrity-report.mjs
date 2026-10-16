// Run on the API host with its existing DATABASE_URL. Never prints credentials
// or customer content. No mutation or migration is performed by this report.
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../artifacts/api-server/package.json", import.meta.url),
);
const { Client } = require("pg");
const connectionString =
  process.env.RENDER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw Error("Database connection is not configured");
const databaseUrl = new URL(connectionString);
if (
  process.env.RENDER_DATABASE_URL &&
  (!databaseUrl.searchParams.has("sslmode") ||
    ["prefer", "require", "verify-ca"].includes(
      databaseUrl.searchParams.get("sslmode"),
    ))
)
  databaseUrl.searchParams.set("sslmode", "verify-full");
const client = new Client({
  connectionString: databaseUrl.toString(),
  connectionTimeoutMillis: 10000,
});
const tables = [
  "organizations",
  "contacts",
  "organization_contacts",
  "activities",
  "notes",
  "profile_notes",
  "follow_ups",
  "bookings",
  "invoices",
  "invoice_payments",
  "documents",
  "business_documents",
  "business_document_files",
  "google_workspace_validation_mappings",
  "google_workspace_profile_files",
  "google_workspace_profile_email_threads",
  "google_workspace_profile_email_thread_sources",
  "google_workspace_profile_email_messages",
  "google_pilot_sync",
  "google_pilot_sync_history",
  "email_thread_attention",
];
try {
  await client.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout='30s'");
  const report = {
    capturedAt: new Date().toISOString(),
    tables: {},
    references: {},
  };
  for (const table of tables) {
    const present = (
      await client.query("SELECT to_regclass($1) AS name", ["public." + table])
    ).rows[0].name;
    if (!present) {
      report.tables[table] = { present: false };
      continue;
    }
    // Order-independent aggregate fingerprints; all values remain inside Postgres.
    const counts = await client.query(`SELECT count(*)::text AS rows,
   COALESCE(sum(('x'||substr(md5(row_to_json(t)::text),1,15))::bit(60)::bigint::numeric),0)::text AS checksumA,
   COALESCE(sum(('x'||substr(md5(row_to_json(t)::text),16,15))::bit(60)::bigint::numeric),0)::text AS checksumB
   FROM public."${table}" t`);
    report.tables[table] = { present: true, ...counts.rows[0] };
  }
  if (
    report.tables.organizations?.present &&
    report.tables.google_workspace_validation_mappings?.present
  ) {
    report.references.orphanMappingProfiles = (
      await client.query(
        `SELECT count(*)::text n FROM google_workspace_validation_mappings m WHERE m.organization_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organizations o WHERE o.id=m.organization_id)`,
      )
    ).rows[0].n;
  }
  if (report.tables.google_workspace_profile_files?.present) {
    report.references.availableFilesWithoutStorage = (
      await client.query(
        `SELECT count(*)::text n FROM google_workspace_profile_files WHERE availability='available' AND (storage_object_key IS NULL OR storage_object_key='')`,
      )
    ).rows[0].n;
  }
  await client.query("COMMIT");
  console.log(JSON.stringify(report, null, 2));
} catch {
  console.error(
    "Integrity report failed. No changes were made; inspect database connectivity and table schema privately.",
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
