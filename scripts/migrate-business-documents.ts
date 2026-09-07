#!/usr/bin/env tsx
import { pathToFileURL } from "node:url";

type MigrationInput = { dryRun: boolean; batchSize: number; afterId: string | null };
type Runner = (input: MigrationInput) => Promise<unknown>;

export function parseMigrationArgs(argv: string[]): MigrationInput {
  const apply = argv.includes("--apply");
  const batchArgument = argv.find((argument) => argument.startsWith("--batch-size="));
  const afterArgument = argv.find((argument) => argument.startsWith("--after-id="));
  const batchSize = batchArgument ? Number(batchArgument.split("=")[1]) : 100;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("--batch-size must be an integer from 1 to 500");
  }
  return {
    dryRun: !apply,
    batchSize,
    afterId: afterArgument?.slice("--after-id=".length) || null,
  };
}

export async function runMigrationCli(
  argv = process.argv.slice(2),
  env = process.env,
  output: (value: string) => void = console.log,
  runner?: Runner,
) {
  const input = parseMigrationArgs(argv);
  if (!env.DATABASE_URL) {
    if (!input.dryRun) throw new Error("DATABASE_URL is required for --apply");
    output(JSON.stringify({ ...input, discovered: 0, imported: 0, deduplicated: 0, review: 0, skipped: 0, failed: 0, nextAfterId: null, bySource: { business_source: 0, google_profile_file: 0, design_asset: 0, design_output: 0, design_certificate: 0 }, warning: "DATABASE_URL is not configured; no records were inspected." }, null, 2));
    return 0;
  }
  const migrate = runner ?? (await import("../artifacts/api-server/src/features/business-documents/legacy-document-migration")).migrateLegacyDocuments;
  const report = await migrate(input);
  output(JSON.stringify(report, null, 2));
  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  runMigrationCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
