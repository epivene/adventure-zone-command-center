import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createGoogleWorkspaceMatchedCorrectionsRouter } from "./google-workspace-matched-corrections";

const body = {
  threadId: "t1",
  subject: "Paint order",
  from: "store@example.com",
  to: "theadventurezone12@gmail.com",
  internalDateMs: 1,
  hasAttachments: false,
};

describe("matched Gmail correction routes", () => {
  it("persists a manual profile override", async () => {
    const assign = vi.fn(async () => undefined);
    const app = express();
    app.use(express.json());
    app.use(createGoogleWorkspaceMatchedCorrectionsRouter({
      service: { assign, ignore: vi.fn() } as never,
      now: () => new Date("2026-08-25T12:00:00Z"),
    }));

    const response = await request(app)
      .put("/google-workspace/validation/matched/m1")
      .send({ ...body, organizationId: "11111111-1111-4111-8111-111111111111" });

    expect(response.status).toBe(200);
    expect(assign).toHaveBeenCalledWith(expect.objectContaining({
      messageId: "m1",
      threadId: "t1",
      organizationId: "11111111-1111-4111-8111-111111111111",
    }));
  });

  it("persists a manual ignore", async () => {
    const ignore = vi.fn(async () => undefined);
    const app = express();
    app.use(express.json());
    app.use(createGoogleWorkspaceMatchedCorrectionsRouter({
      service: { assign: vi.fn(), ignore } as never,
    }));

    const response = await request(app)
      .post("/google-workspace/validation/matched/m1/ignore")
      .send(body);

    expect(response.status).toBe(200);
    expect(ignore).toHaveBeenCalledWith(expect.objectContaining({ messageId: "m1", threadId: "t1" }));
  });
});
