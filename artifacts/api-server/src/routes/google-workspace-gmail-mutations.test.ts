import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createGoogleWorkspaceGmailMutationsRouter } from "./google-workspace-gmail-mutations";

const mutationId = "11111111-1111-4111-8111-111111111111";

describe("Gmail mutation retry route", () => {
  it("retries a persisted Gmail mutation and returns its visible state", async () => {
    const retry = vi.fn(async () => ({
      mutationId,
      state: "completed" as const,
      gmailLabelId: "Label_1",
      gmailLabelName: "Z - AdventureZone/Profiles/Elko County Fair",
      errorCode: null,
    }));
    const app = express();
    app.use(createGoogleWorkspaceGmailMutationsRouter({ retry }));

    const response = await request(app)
      .post(`/google-workspace/gmail-mutations/${mutationId}/retry`)
      .send({});

    expect(response.status).toBe(200);
    expect(retry).toHaveBeenCalledWith(mutationId);
    expect(response.body.gmailSync).toMatchObject({
      state: "completed",
      gmailLabelId: "Label_1",
    });
  });

  it("rejects malformed mutation IDs before touching Gmail", async () => {
    const retry = vi.fn();
    const app = express();
    app.use(createGoogleWorkspaceGmailMutationsRouter({ retry }));

    const response = await request(app)
      .post("/google-workspace/gmail-mutations/not-a-uuid/retry")
      .send({});

    expect(response.status).toBe(400);
    expect(retry).not.toHaveBeenCalled();
  });
});
