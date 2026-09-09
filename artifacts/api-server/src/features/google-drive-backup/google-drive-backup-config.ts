export interface GoogleDriveBackupRuntimeConfig {
  enabled: boolean;
  idlePollMs: number;
  batchLowWaterMark: number;
  maxAutomaticAttempts: number;
}

function positiveInteger(value: string | undefined, fallback: number, key: string): number {
  if (value === undefined || !value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${key}_INVALID`);
  return parsed;
}

export function readGoogleDriveBackupRuntimeConfig(
  env: NodeJS.ProcessEnv,
): GoogleDriveBackupRuntimeConfig {
  const flag = env.GOOGLE_DRIVE_BACKUP_ENABLED?.trim().toLowerCase();
  if (flag !== undefined && flag !== "" && flag !== "true" && flag !== "false") {
    throw new Error("GOOGLE_DRIVE_BACKUP_ENABLED_INVALID");
  }
  return {
    enabled: flag === "true",
    idlePollMs: positiveInteger(env.GOOGLE_DRIVE_BACKUP_IDLE_POLL_MS, 2_000, "GOOGLE_DRIVE_BACKUP_IDLE_POLL_MS"),
    batchLowWaterMark: positiveInteger(env.GOOGLE_DRIVE_BACKUP_BATCH_LOW_WATER_MARK, 100, "GOOGLE_DRIVE_BACKUP_BATCH_LOW_WATER_MARK"),
    maxAutomaticAttempts: positiveInteger(env.GOOGLE_DRIVE_BACKUP_MAX_AUTOMATIC_ATTEMPTS, 10, "GOOGLE_DRIVE_BACKUP_MAX_AUTOMATIC_ATTEMPTS"),
  };
}
