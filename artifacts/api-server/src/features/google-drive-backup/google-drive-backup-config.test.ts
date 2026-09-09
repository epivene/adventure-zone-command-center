import { describe, expect, it } from "vitest";
import { readGoogleDriveBackupRuntimeConfig } from "./google-drive-backup-config";

describe("readGoogleDriveBackupRuntimeConfig", () => {
  it("is safely disabled by default", () => {
    expect(readGoogleDriveBackupRuntimeConfig({})).toEqual({
      enabled: false, idlePollMs: 2000, batchLowWaterMark: 100, maxAutomaticAttempts: 10,
    });
  });
  it("accepts explicit bounded runtime settings", () => {
    expect(readGoogleDriveBackupRuntimeConfig({
      GOOGLE_DRIVE_BACKUP_ENABLED: "true",
      GOOGLE_DRIVE_BACKUP_IDLE_POLL_MS: "3000",
      GOOGLE_DRIVE_BACKUP_BATCH_LOW_WATER_MARK: "50",
      GOOGLE_DRIVE_BACKUP_MAX_AUTOMATIC_ATTEMPTS: "8",
    })).toMatchObject({ enabled: true, idlePollMs: 3000, batchLowWaterMark: 50, maxAutomaticAttempts: 8 });
  });
  it("rejects invalid values", () => {
    expect(() => readGoogleDriveBackupRuntimeConfig({ GOOGLE_DRIVE_BACKUP_IDLE_POLL_MS: "0" })).toThrow();
    expect(() => readGoogleDriveBackupRuntimeConfig({ GOOGLE_DRIVE_BACKUP_ENABLED: "yes" })).toThrow();
  });
});
