import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createGoogleDriveBackupRouter } from "./google-drive-backup";

function appWith(dependencies: any) {
  const app = express();
  app.use(express.json());
  app.use(createGoogleDriveBackupRouter(dependencies));
  return app;
}

describe("Google Drive backup routes", () => {
  it("rejects an oversized pilot", async () => {
    const response = await request(appWith({})).post("/google-drive-backup/pilot")
      .send({ profileLimit: 26, confirmation: "START PILOT" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("GOOGLE_DRIVE_BACKUP_PILOT_LIMIT_INVALID");
  });

  it("previews without Drive writes", async () => {
    const preview = { profileCount: 2, followUpPdfCount: 2, documentCount: 1, needsFilingCount: 0, byYear: { "2026": 1 }, byDocumentType: { Contracts: 1 }, samplePaths: [], warnings: [] };
    const dependencies = {
      backfill: { preview: vi.fn(async () => preview) },
      now: () => new Date("2026-09-09T00:00:00Z"),
    };
    const response = await request(appWith(dependencies)).post("/google-drive-backup/preview").send({});
    expect(response.status).toBe(200);
    expect(response.body).toEqual(preview);
    expect(dependencies.backfill.preview).toHaveBeenCalledOnce();
  });

  it("requires explicit confirmation before creating the isolated root", async () => {
    const response = await request(appWith({})).post("/google-drive-backup/root").send({});
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("GOOGLE_DRIVE_BACKUP_ROOT_CONFIRMATION_INVALID");
  });
});
