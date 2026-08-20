import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createPaperNoteExtractionRouter } from "./paper-note-extraction";

const batchId = "10000000-0000-4000-8000-000000000001";
const pageId = "20000000-0000-4000-8000-000000000001";

function appWith(repository: {
  retryPage?: (...args: any[]) => Promise<void>;
  addManualEntry?: (...args: any[]) => Promise<string>;
  markReviewedEmpty?: (...args: any[]) => Promise<void>;
}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { userId: string }).userId = "owner";
    next();
  });
  app.use(createPaperNoteExtractionRouter(repository as any));
  return app;
}

describe("paper-note extraction recovery routes", () => {
  it("queues only an explicitly retried page", async () => {
    const retryPage = vi.fn(async () => undefined);
    const response = await request(appWith({ retryPage }))
      .post(`/paper-notes/batches/${batchId}/pages/${pageId}/retry`)
      .send({});

    expect(response.status).toBe(200);
    expect(retryPage).toHaveBeenCalledWith("owner", batchId, pageId, expect.any(Date));
  });

  it("creates a manual entry from transcription only", async () => {
    const addManualEntry = vi.fn(async () => "30000000-0000-4000-8000-000000000001");
    const response = await request(appWith({ addManualEntry }))
      .post(`/paper-notes/batches/${batchId}/pages/${pageId}/manual-entry`)
      .send({ transcription: "County fair — ask for Tina at ext 3115" });

    expect(response.status).toBe(201);
    expect(addManualEntry).toHaveBeenCalledWith(
      "owner",
      batchId,
      pageId,
      "County fair — ask for Tina at ext 3115",
      expect.any(Date),
    );
    expect(response.body.entryId).toBe("30000000-0000-4000-8000-000000000001");
  });

  it("rejects blank or overlong manual transcription", async () => {
    const addManualEntry = vi.fn();
    expect((await request(appWith({ addManualEntry }))
      .post(`/paper-notes/batches/${batchId}/pages/${pageId}/manual-entry`)
      .send({ transcription: "   " })).status).toBe(400);
    expect((await request(appWith({ addManualEntry }))
      .post(`/paper-notes/batches/${batchId}/pages/${pageId}/manual-entry`)
      .send({ transcription: "x".repeat(12_001) })).status).toBe(400);
    expect(addManualEntry).not.toHaveBeenCalled();
  });

  it("marks a page reviewed empty without creating entries", async () => {
    const markReviewedEmpty = vi.fn(async () => undefined);
    const response = await request(appWith({ markReviewedEmpty }))
      .post(`/paper-notes/batches/${batchId}/pages/${pageId}/reviewed-empty`)
      .send({});

    expect(response.status).toBe(200);
    expect(markReviewedEmpty).toHaveBeenCalledWith("owner", batchId, pageId, expect.any(Date));
  });
});
