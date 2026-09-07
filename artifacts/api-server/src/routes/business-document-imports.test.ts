import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
vi.hoisted(() => { process.env.DATABASE_URL ??= "postgres://postgres:postgres@127.0.0.1:5432/test"; });
import { createBusinessDocumentImportsRouter } from "./business-document-imports";

const previewRunId = "11111111-1111-4111-8111-111111111111";
function setup() {
  const service = { preview: vi.fn(async () => ({ runId: previewRunId, discovered: 7 })), startApproved: vi.fn(async () => ({ runId: "pilot", imported: 2 })), previewGmail: vi.fn(async () => ({ runId: previewRunId, discovered: 4 })), startApprovedGmail: vi.fn(async () => ({ runId: "gmail-pilot", imported: 2 })), get: vi.fn(async () => ({ id: previewRunId })), retry: vi.fn(async () => ({ runId: "retry", imported: 1 })) };
  const app = express(); app.use(express.json()); app.use(createBusinessDocumentImportsRouter(async () => service as any));
  return { app, service };
}
describe("business document Drive imports", () => {
  it("previews without starting downloads", async () => {
    const { app, service } = setup();
    await request(app).post("/business-document-imports/drive/preview").send({ folderIds: ["contracts"] }).expect(200);
    expect(service.preview).toHaveBeenCalledWith(["contracts"], "owner");
    expect(service.startApproved).not.toHaveBeenCalled();
  });
  it("requires explicit pilot confirmation and the preview run", async () => {
    const { app, service } = setup();
    await request(app).post("/business-document-imports/drive/start").send({ previewRunId }).expect(400);
    await request(app).post("/business-document-imports/drive/start").send({ previewRunId, confirmation: "START PILOT", pilotLimit: 2 }).expect(202);
    expect(service.startApproved).toHaveBeenCalledWith(previewRunId, "owner", 2);
  });
  it("bounds Gmail discovery by dates and requires its own preview", async () => {
    const { app, service } = setup();
    await request(app).post("/business-document-imports/gmail/preview").send({ after: "2025-01-01", before: "2026-01-01" }).expect(200);
    expect(service.previewGmail).toHaveBeenCalledWith({ after: "2025-01-01", before: "2026-01-01" }, "owner");
    await request(app).post("/business-document-imports/gmail/start").send({ previewRunId, confirmation: "START PILOT" }).expect(202);
    expect(service.startApprovedGmail).toHaveBeenCalledWith(previewRunId, "owner", undefined);
  });
});
