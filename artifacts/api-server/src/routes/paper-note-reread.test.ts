import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createPaperNoteRereadRouter } from "./paper-note-reread";

const batchId = "10000000-0000-4000-8000-000000000001";
const pageId = "20000000-0000-4000-8000-000000000001";

describe("paper-note reread route", () => {
  it("requires explicit discard confirmation", async () => {
    const reread = vi.fn(async () => ({ ok: true as const }));
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as typeof req & { userId?: string }).userId = "owner"; next(); });
    app.use(createPaperNoteRereadRouter({ reread }));

    const response = await request(app)
      .post(`/paper-notes/batches/${batchId}/pages/${pageId}/re-read`)
      .send({ rotationDegrees: 90, confirmDiscardReview: true });

    expect(response.status).toBe(200);
    expect(reread).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "owner",
      batchId,
      pageId,
      rotationDegrees: 90,
      confirmDiscardReview: true,
    }));
  });

  it("rejects a reread without confirmation", async () => {
    const app = express();
    app.use(express.json());
    app.use(createPaperNoteRereadRouter({ reread: vi.fn() }));
    const response = await request(app)
      .post(`/paper-notes/batches/${batchId}/pages/${pageId}/re-read`)
      .send({ rotationDegrees: 90, confirmDiscardReview: false });
    expect(response.status).toBe(400);
  });
});
