import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPaperNoteImportRouter } from "./paper-note-import";

const batchId = "10000000-0000-4000-8000-000000000001";
const requestKey = "40000000-0000-4000-8000-000000000001";

function appWith(input: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { userId: string }).userId = "owner";
    next();
  });
  app.use(createPaperNoteImportRouter(input));
  return app;
}

describe("paper-note import routes", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the server preflight summary before any import", async () => {
    const preflight = vi.fn(async () => ({
      ready: true,
      batchId,
      approvedCount: 2,
      skippedCount: 1,
      blocking: [],
      preview: { profilesCreated: 1, profilesUpdated: 1, locationsCreated: 0, contactsCreated: 1, contactsLinked: 0, phonesCreatedOrUpdated: 2, historicalNotesCreated: 2, followUpsCreated: 0, entriesSkipped: 1 },
    }));
    const response = await request(appWith({ preflight, importBatch: vi.fn(), archiveBatch: vi.fn() }))
      .post(`/paper-notes/batches/${batchId}/preflight`)
      .send({});
    expect(response.status).toBe(200);
    expect(response.body.preflight.ready).toBe(true);
    expect(preflight).toHaveBeenCalledWith({ actorId: "owner", batchId, now: expect.any(Date) });
  });

  it("requires a UUID request key for final import", async () => {
    const importBatch = vi.fn();
    const response = await request(appWith({ preflight: vi.fn(), importBatch, archiveBatch: vi.fn() }))
      .post(`/paper-notes/batches/${batchId}/import`)
      .send({ requestKey: "not-a-uuid" });
    expect(response.status).toBe(400);
    expect(importBatch).not.toHaveBeenCalled();
  });

  it("returns the stored import summary from the service", async () => {
    const importBatch = vi.fn(async () => ({
      profilesCreated: 1, profilesUpdated: 0, locationsCreated: 0, contactsCreated: 0,
      contactsLinked: 0, phonesCreatedOrUpdated: 0, historicalNotesCreated: 1,
      followUpsCreated: 0, entriesSkipped: 0,
    }));
    const response = await request(appWith({ preflight: vi.fn(), importBatch, archiveBatch: vi.fn() }))
      .post(`/paper-notes/batches/${batchId}/import`)
      .send({ requestKey });
    expect(response.status).toBe(200);
    expect(importBatch).toHaveBeenCalledWith({ actorId: "owner", batchId, requestKey, now: expect.any(Date) });
    expect(response.body.summary.profilesCreated).toBe(1);
  });

  it("logs nested postgres details before forwarding an unexpected import failure", async () => {
    const postgresError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "contact_phones_contact_normalized_number_unique",
      detail: "Key (contact_id, normalized_number) already exists.",
      table: "contact_phones",
      column: null,
    });
    const drizzleError = Object.assign(new Error("Failed query"), { cause: postgresError });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const importBatch = vi.fn(async () => { throw drizzleError; });

    const response = await request(appWith({ preflight: vi.fn(), importBatch, archiveBatch: vi.fn() }))
      .post(`/paper-notes/batches/${batchId}/import`)
      .send({ requestKey });

    expect(response.status).toBe(500);
    expect(errorLog).toHaveBeenCalledWith(
      "Paper Notes import database error",
      expect.objectContaining({
        batchId,
        code: "23505",
        constraint: "contact_phones_contact_normalized_number_unique",
        detail: "Key (contact_id, normalized_number) already exists.",
        table: "contact_phones",
        column: null,
        causeMessage: "duplicate key value violates unique constraint",
      }),
    );
  });

  it("archives only through the explicit archive action", async () => {
    const archiveBatch = vi.fn(async () => undefined);
    const response = await request(appWith({ preflight: vi.fn(), importBatch: vi.fn(), archiveBatch }))
      .post(`/paper-notes/batches/${batchId}/archive`)
      .send({});
    expect(response.status).toBe(200);
    expect(archiveBatch).toHaveBeenCalledWith("owner", batchId, expect.any(Date));
  });
});
