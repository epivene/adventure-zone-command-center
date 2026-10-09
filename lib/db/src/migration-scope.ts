// These are one-time business imports with fixed record/prerequisite guards,
// not routine schema upgrades. Automatic merge setup must not import contacts
// or leads from their embedded source datasets.
const manualBusinessImports = new Set([
  "20260910_public_directory_leads.sql",
  "20260910_rmaf_online_directory.sql",
]);

export function shouldApplyMigration(filename: string, automatic: boolean): boolean {
  return !automatic || !manualBusinessImports.has(filename);
}
