export const APPROVED_PROFILE_STARTUP_TIMEOUT_MS = 15 * 60_000;
export const APPROVED_PROFILE_STARTUP_IMPORT_ENV =
  "RUN_APPROVED_PROFILE_STARTUP_IMPORT";

export function isApprovedProfileStartupImportEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment[APPROVED_PROFILE_STARTUP_IMPORT_ENV]?.trim().toLowerCase() === "true";
}
