import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createPaperNoteSourceRouter } from "./paper-note-source";

const batchId = "10000000-0000-4000-8000-000000000001";
const pageId = "20000000-0000-4000-8000-000000000001";
const entryId = "30000000-0000-4000-8000-000000000001";

function appWith(service: any) {
  const app = express();
  app.use((req, _res, next) => {
    (req as express.Request & { userId: string }).userId = "owner";
    next();
  });
  app.use(createPaperNoteSourceRouter(service));
  return app;
}

describe("paper-note source routes", () => {
  it("returns only the signed URL for an owned page", async () => {
    const pageUrl = vi.fn(async () => ({ url: "https://signed.example/page", kind: "original" }));
    const response = await request(appWith({ pageUrl, entryUrl: vi.fn() }))
      .get(`/paper-notes/batches/${batchId}/pages/${pageId}/source-url?kind=original`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ url: "https://signed.example/page", kind: "original" });
    expect(pageUrl).toHaveBeenCalledWith("owner", batchId, pageId, "original");
  });

  it("supports entry provenance for later profile timeline links", async () => {
    const entryUrl = vi.fn(async () => ({ url: "https://signed.example/entry", kind: "original" }));
    const response = await request(appWith({ pageUrl: vi.fn(), entryUrl }))
      .get(`/paper-notes/entries/${entryId}/source-url`);
    expect(response.status).toBe(200);
    expect(entryUrl).toHaveBeenCalledWith("owner", entryId, "original");
  });
});
