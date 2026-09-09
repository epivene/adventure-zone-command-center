import { describe, expect, it, vi } from "vitest";
import { GoogleDriveBackupBackfillService } from "./google-drive-backup-backfill-service";

describe("GoogleDriveBackupBackfillService", () => {
  it("previews counts and paths without making writes", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM organizations")) return { rows: [{ id: "11111111-1111-4111-8111-111111111111", name: "County Fair" }] };
      return { rows: [{
        id: "22222222-2222-4222-8222-222222222222",
        display_name: "Signed Contract", original_filename: "signed.pdf",
        category: "contract", effective_date: "2026-01-01",
        organization_id: "11111111-1111-4111-8111-111111111111", organization_name: "County Fair",
      }] };
    });
    const service = new GoogleDriveBackupBackfillService({ query });
    await expect(service.preview(new Date("2026-09-09T00:00:00Z"))).resolves.toMatchObject({
      profileCount: 1, followUpPdfCount: 1, documentCount: 1,
      needsFilingCount: 0, byYear: { "2026": 1 }, byDocumentType: { Contracts: 1 },
    });
    expect(query.mock.calls.every(([sql]) => /^\s*SELECT/.test(sql))).toBe(true);
  });

  it("rejects pilot sizes outside 1 through 25", async () => {
    const service = new GoogleDriveBackupBackfillService({ query: vi.fn() as any });
    await expect(service.startPilot({ profileLimit: 26, now: new Date(), createdBy: "owner" }))
      .rejects.toThrow("GOOGLE_DRIVE_BACKUP_PILOT_LIMIT_INVALID");
  });
});
