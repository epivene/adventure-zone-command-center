import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createLeadGmailDraftHandler, createLeadGmailDraftStateHandler } from "./gmail-draft-handler";

describe("Create Gmail Draft route handler", () => {
  it("loads the existing per-row state after a page reload", async () => {
    const get = vi.fn(async () => ({ id: "link-1", rowId: "11111111-1111-4111-8111-111111111111", state: "created" }));
    const app = express();
    app.get("/lead-intake/rows/:rowId/gmail-draft", createLeadGmailDraftStateHandler({ get } as any));

    await request(app)
      .get("/lead-intake/rows/11111111-1111-4111-8111-111111111111/gmail-draft")
      .expect(200)
      .expect(({ body }) => expect(body.link).toMatchObject({ id: "link-1", state: "created" }));
    expect(get).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("exposes one individual action with a required expected review version", async () => {
    const create = vi.fn(async (input) => ({
      reused: false,
      link: { id: "link-1", rowId: input.rowId, state: "created", gmailDraftId: "draft-1", gmailMessageId: "message-1" },
    }));
    const app = express();
    app.use(express.json());
    app.post("/lead-intake/rows/:rowId/gmail-draft", (req, _res, next) => {
      (req as any).userId = "owner-1";
      next();
    }, createLeadGmailDraftHandler({ create } as any));

    await request(app)
      .post("/lead-intake/rows/11111111-1111-4111-8111-111111111111/gmail-draft")
      .send({ expectedVersion: 7 })
      .expect(201)
      .expect(({ body }) => expect(body.link).toMatchObject({ state: "created", gmailDraftId: "draft-1" }));

    expect(create).toHaveBeenCalledWith({
      rowId: "11111111-1111-4111-8111-111111111111",
      expectedVersion: 7,
      actorId: "owner-1",
    });

    await request(app)
      .post("/lead-intake/rows/11111111-1111-4111-8111-111111111111/gmail-draft")
      .send({ expectedVersion: 7, rowIds: ["bulk-is-forbidden"] })
      .expect(400);
  });
});
