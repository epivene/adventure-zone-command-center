import { beforeEach, describe, expect, it, vi } from "vitest";
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-token", () => ({ apiFetch }));
import { createDriveBackupRoot, previewDriveBackup, startDriveBackupPilot } from "./google-drive-backup-client";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

describe("Drive backup frontend client", () => {
  beforeEach(() => apiFetch.mockReset());

  it("uses explicit confirmations for root and pilot", async () => {
    apiFetch.mockResolvedValue(response({ ok: true }));
    await createDriveBackupRoot();
    await startDriveBackupPilot(25);
    expect(apiFetch).toHaveBeenNthCalledWith(1, "/google-drive-backup/root", {
      method: "POST", body: JSON.stringify({ confirmation: "CREATE BACKUP FOLDER" }),
    });
    expect(apiFetch).toHaveBeenNthCalledWith(2, "/google-drive-backup/pilot", {
      method: "POST", body: JSON.stringify({ profileLimit: 25, confirmation: "START PILOT" }),
    });
  });

  it("surfaces redacted API error codes", async () => {
    apiFetch.mockResolvedValue(response({ error: "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED" }, 409));
    await expect(previewDriveBackup()).rejects.toThrow("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
  });
});
