import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createPaperNoteIntakeRouter } from "./paper-note-intake";

const batchId = "10000000-0000-4000-8000-000000000001";
const pageId = "20000000-0000-4000-8000-000000000001";

function appWith(service: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { userId: string }).userId = "owner";
    next();
  });
  app.use(createPaperNoteIntakeRouter(service));
  return app;
}

describe("paper note intake routes", () => {
  it("creates a trimmed batch and returns its id", async () => {
    const service = { createBatch: vi.fn(async () => batchId) };
    const response = await request(appWith(service))
      .post("/paper-notes/batches")
      .send({ name: "  Spring call sheets  " });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ batchId });
    expect(service.createBatch).toHaveBeenCalledWith(expect.objectContaining({
      createdBy: "owner",
      name: "Spring call sheets",
    }));
  });

  it("rejects unsupported page metadata before calling the service", async () => {
    const service = { createPage: vi.fn() };
    const response = await request(appWith(service))
      .post(`/paper-notes/batches/${batchId}/pages`)
      .send({ filename: "notes.pdf", mimeType: "application/pdf", sizeBytes: 100 });
    expect(response.status).toBe(400);
    expect(service.createPage).not.toHaveBeenCalled();
  });

  it("accepts raw supported image bytes only on the image endpoint", async () => {
    const service = { uploadPage: vi.fn(async () => ({ ok: true })) };
    const response = await request(appWith(service))
      .put(`/paper-notes/batches/${batchId}/pages/${pageId}/image`)
      .set("content-type", "image/png")
      .send(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(response.status).toBe(200);
    expect(service.uploadPage).toHaveBeenCalledWith(expect.objectContaining({
      createdBy: "owner",
      batchId,
      pageId,
      mimeType: "image/png",
    }));
  });
});
